/// <reference path="../node_modules/typescript/bin/typescriptServices.d.ts" />
/// <reference path="../typings/tsd.d.ts" />


import Promise = require("bluebird");
import path = require('path');
import fs = require('fs');

var loaderUtils = require('loader-utils');

import host = require('./host');
import deps = require('./deps');
import helpers = require('./helpers');

interface WebPack {
    _compiler: {
        inputFileSystem: typeof fs;
        _tsState: host.State
    };
    cacheable: () => void;
    query: string;
    async: () => (err: Error, source?: string, map?: string) => void;
    resourcePath: string;
    resolve: () => void;
    addDependency: (dep: string) => void;
    clearDependencies: () => void;
}

var lastTimes = {};
var lastDeps: deps.DependencyManager;
var showRecompileReason = false;

interface Options extends ts.CompilerOptions {
    showRecompileReason: boolean;
    compiler: string;
}

/**
 * Creates compiler instance
 */
function ensureInit(webpack: WebPack) {
    if (typeof webpack._compiler._tsState !== "undefined") {
        return;
    }

    var options = <Options>loaderUtils.parseQuery(webpack.query);
    var tsImpl: typeof ts;

    if (options.compiler) {
        tsImpl = require(options.compiler);
    } else {
        tsImpl = require('typescript');
    }

    showRecompileReason = !!options.showRecompileReason;

    if (options.target) {
        options.target = helpers.parseOptionTarget(<any>options.target, tsImpl);
    }

    webpack._compiler._tsState = new host.State(options, webpack._compiler.inputFileSystem, tsImpl);
}

function loader(text) {
    compiler.call(undefined, this, text)
}

function compiler(webpack: WebPack, text: string): void {
    if (webpack.cacheable) {
        webpack.cacheable();
    }

    ensureInit.call(undefined, webpack);

    var callback = webpack.async();
    var fileName = webpack.resourcePath;
    var resolver = <host.Resolver>Promise.promisify(webpack.resolve);

    var deps = {
        add: (depFileName) => {webpack.addDependency(depFileName)},
        clear: webpack.clearDependencies.bind(webpack)
    };

    var state = webpack._compiler._tsState;

    // Here we receive information about what files were changed.
    // The way is hacky, maybe we can find something better.
    var currentTimes = (<any>webpack)._compiler.watchFileSystem.watcher.mtimes;
    var changedFiles = Object.keys(currentTimes);

    var flow = Promise.resolve();

    // `mtimes` object doesn't change during compilation, so we will not
    // do the same thing on the next changed file.
    if (currentTimes !== lastTimes) {
        if (showRecompileReason) {
            lastDeps = state.dependencies.clone();
        }

        for (var changedFile in currentTimes) {
            state.validFiles.markFileInvalid(changedFile);
        }

        flow = Promise.all(Object.keys(currentTimes).map((changedFile) => {
            return state.readFileAndUpdate(changedFile).then(() => {
                return state.checkDependencies(resolver, changedFile);
            });
        })).then(_ => {});

        flow = flow.then(() => {
            state.resetProgram();
        })
    }

    lastTimes = currentTimes;

    if (showRecompileReason && changedFiles.length) {
        console.log("Recompile reason:\n    " + fileName + "\n        " +
            lastDeps.recompileReason(fileName, changedFiles).join("\n        "));
    }

    flow.then(() => state.checkDependencies(resolver, fileName))
        .then(() => state.emit(fileName))
        .then(output => {
            var result = helpers.findResultFor(output, fileName);

            if (result.text === undefined) {
                throw new Error('no output found for ' + fileName);
            }

            var sourceFilename = loaderUtils.getRemainingRequest(webpack);
            var current = loaderUtils.getCurrentRequest(webpack);
            var sourceMap = JSON.parse(result.sourceMap);
            sourceMap.sources = [sourceFilename];
            sourceMap.file = current;
            sourceMap.sourcesContent = [text];

            callback(null, result.text, sourceMap);
        })
        .finally(() => {
            deps.clear();
            deps.add(fileName);
            state.dependencies.applyChain(fileName, deps);
        })
        .catch(host.ResolutionError, err => {
            callback(err, helpers.codegenErrorReport([err]));
        })
        .catch(host.TypeScriptCompilationError, err => {
            var errors = helpers.formatErrors(err.diagnostics);
            errors.forEach((<any>webpack).emitError, webpack);

            for (var depDiag in err.depsDiagnostics) {
                var errors = helpers.formatErrors(err.depsDiagnostics[depDiag]);
                errors.forEach((<any>webpack).emitError, webpack);
            }

            callback(null, helpers.codegenErrorReport(errors));
        })
        .catch(callback)
}

export = loader;
