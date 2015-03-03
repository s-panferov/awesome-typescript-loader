/// <reference path="../node_modules/typescript/bin/typescriptServices.d.ts" />
/// <reference path="../typings/tsd.d.ts" />


import Promise = require("bluebird");
import path = require('path');
import fs = require('fs');

var loaderUtils = require('loader-utils');

import host = require('./host');
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
    resolveSync: () => void;
    addDependency: (dep: string) => void;
    clearDependencies: () => void;
    callback: any;
}

var lastTimes = {};
var lastDeps: host.DependencyManager;
var showRecompileReason = false;
var sync = false;

/**
 * Creates compiler instance
 */
function ensureInit(webpack: WebPack) {
    if (typeof webpack._compiler._tsState !== "undefined") {
        return;
    }

    var options = loaderUtils.parseQuery(webpack.query);
    var tsImpl: typeof ts;

    if (options.compiler) {
        tsImpl = require(options.compiler);
    } else {
        tsImpl = require('typescript');
    }

    showRecompileReason = !!options.showRecompileReason;
    sync = !!options.sync;

    if (options.target) {
        options.target = helpers.parseOptionTarget(options.target, tsImpl);
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

    var callback = <any>function(){};//webpack.async();

    var resolver;
    var syncResolver;

    if (!sync) {
        resolver = <host.AsyncResolver>Promise.promisify(webpack.resolve);
    } else {
        syncResolver = webpack.resolveSync;
    }

    var filename = webpack.resourcePath;

    var deps = {
        add: webpack.addDependency.bind(webpack),
        clear: webpack.clearDependencies.bind(webpack)
    };

    // Here we receive information about what files were changed.
    // The way is hacky, maybe we can find something better.
    var currentTimes = (<any>webpack)._compiler.watchFileSystem.watcher.mtimes;
    var changedFiles = Object.keys(currentTimes);

    // `mtimes` object doesn't change during compilation, so we will not
    // do the same thing on the next changed file.
    if (currentTimes !== lastTimes) {
        if (showRecompileReason) {
            lastDeps = webpack._compiler._tsState.dependencies.clone();
        }
        for (var changedFile in currentTimes) {
            console.log("Update", changedFile, "in the TS compiler service");
            webpack._compiler._tsState.readFileAndUpdateSync(changedFile);
            webpack._compiler._tsState.validFiles.markFileInvalid(changedFile);
        }
    }

    lastTimes = currentTimes;

    if (showRecompileReason && changedFiles.length) {
        console.log("Recompile reason:\n    " + filename + "\n        " +
            lastDeps.recompileReason(filename, changedFiles).join("\n        "));
    }

    if (!sync) {
        webpack._compiler._tsState
            .emitAsync(resolver, filename, text, deps)
            .then(output => {
                var result = prepareResult(output, filename, text, webpack);
                callback(null, result[0], result[1]);
            })
            .catch(host.ResolutionError, err => {
                callback(err, helpers.codegenErrorReport([err]));
            })
            .catch(host.TypeScriptCompilationError, err => {
                var errors = emitError(err, webpack);
                callback(null, helpers.codegenErrorReport(errors));
            })
            .catch(callback)
    } else {
        try {
            var output = webpack._compiler._tsState.emitSync(syncResolver, filename, text, deps);
            var result = prepareResult(output, filename, text, webpack);
            webpack.callback(null, result[0], result[1]);
        } catch (err) {
            if (err instanceof host.ResolutionError) {
                webpack.callback(err, helpers.codegenErrorReport([err]));
            } else if (err instanceof host.TypeScriptCompilationError) {
                var errors = emitError(err, webpack);
                webpack.callback(null, helpers.codegenErrorReport(errors));
            } else {
                webpack.callback(err)
            }
        }
    }
}

function emitError(err: host.TypeScriptCompilationError, webpack: WebPack): string[] {
    var errors = helpers.formatErrors(err.diagnostics);
    errors.forEach((<any>webpack).emitError, webpack);

    //for (var depDiag in err.depsDiagnostics) {
    //    var errors = helpers.formatErrors(err.depsDiagnostics[depDiag]);
    //    errors.forEach((<any>webpack).emitError, webpack);
    //}

    return errors;
}

function prepareResult(output: ts.EmitOutput, fileName: string, text: string, webpack: WebPack): [string, any] {
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

    return [result.text, sourceMap];
}

export = loader;
