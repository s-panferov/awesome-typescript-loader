/// <reference path="../node_modules/typescript/bin/typescriptServices.d.ts" />
/// <reference path="../typings/tsd.d.ts" />


import Promise = require("bluebird");
import path = require('path');
import fs = require('fs');

var loaderUtils = require('loader-utils');

import host = require('./host');
import deps = require('./deps');
import helpers = require('./helpers');

import CompilerOptions = host.CompilerOptions;

interface WebPack {
    _compiler: {
        inputFileSystem: typeof fs;
        _tsInstances: {[key:string]: CompilerInstance};
    };
    cacheable: () => void;
    query: string;
    async: () => (err: Error, source?: string, map?: string) => void;
    resourcePath: string;
    resolve: () => void;
    addDependency: (dep: string) => void;
    clearDependencies: () => void;
}

interface CompilerInstance {
    tsFlow: Promise<any>;
    tsState: host.State;
    lastTimes: {};
    lastDeps: deps.DependencyManager;
    showRecompileReason: boolean;
}

/**
 * Creates compiler instance
 */
function ensureInstance(webpack: WebPack, options: CompilerOptions, instanceName: string): CompilerInstance {
    if (typeof webpack._compiler._tsInstances === 'undefined') {
        webpack._compiler._tsInstances = {};
    }

    if (typeof webpack._compiler._tsInstances[instanceName] !== "undefined") {
        return webpack._compiler._tsInstances[instanceName];
    }

    var tsFlow = Promise.resolve();
    var tsImpl: typeof ts;

    if (options.compiler) {
        tsImpl = require(options.compiler);
    } else {
        tsImpl = require('typescript');
    }

    var showRecompileReason = !!options.showRecompileReason;

    if (typeof options.emitRequireType === 'undefined') {
        options.emitRequireType = true;
    } else {
        options.emitRequireType = (<any>options.emitRequireType == 'true' ? true : false);
    }

    if (options.target) {
        options.target = helpers.parseOptionTarget(<any>options.target, tsImpl);
    }

    var tsState = new host.State(options, webpack._compiler.inputFileSystem, tsImpl);

    return webpack._compiler._tsInstances[instanceName] = {
        tsFlow,
        tsState,
        showRecompileReason,
        lastTimes: {},
        lastDeps: null
    }
}

function loader(text) {
    compiler.call(undefined, this, text)
}

function compiler(webpack: WebPack, text: string): void {
    if (webpack.cacheable) {
        webpack.cacheable();
    }

    var options = <CompilerOptions>loaderUtils.parseQuery(webpack.query);
    var instanceName = options.instanceName || 'default';

    var instance = ensureInstance(webpack, options, instanceName);

    var state = instance.tsState;

    var callback = webpack.async();
    var fileName = webpack.resourcePath;
    var resolver = <host.Resolver>Promise.promisify(webpack.resolve);

    var deps = {
        add: (depFileName) => {webpack.addDependency(depFileName)},
        clear: webpack.clearDependencies.bind(webpack)
    };


    // Here we receive information about what files were changed.
    // The way is hacky, maybe we can find something better.
    var currentTimes = (<any>webpack)._compiler.watchFileSystem.watcher.mtimes;
    var changedFiles = Object.keys(currentTimes);

    instance.tsFlow = instance.tsFlow
        .then(() => {
            var depsFlow = Promise.resolve();

            // `mtimes` object doesn't change during compilation, so we will not
            // do the same thing on the next changed file.
            if (currentTimes !== instance.lastTimes) {
                if (instance.showRecompileReason) {
                    instance.lastDeps = state.dependencies.clone();
                }

                for (var changedFile in currentTimes) {
                    state.validFiles.markFileInvalid(changedFile);
                }

                depsFlow = Promise.all(Object.keys(currentTimes).map((changedFile) => {
                    if (/\.ts$|\.d\.ts$/.test(changedFile)) {
                        return state.readFileAndUpdate(changedFile).then(() => {
                            return state.checkDependencies(resolver, changedFile);
                        });
                    } else {
                        return Promise.resolve()
                    }
                }))
                    .then(_ => state.resetProgram())
            }

            instance.lastTimes = currentTimes;

            if (instance.showRecompileReason && changedFiles.length) {
                console.log("Recompile reason:\n    " + fileName + "\n        " +
                instance.lastDeps.recompileReason(fileName, changedFiles).join("\n        "));
            }

            return depsFlow;
        })
        .then(() => state.checkDependencies(resolver, fileName))
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

            if (output.diagnostics.length) {
                helpers.formatErrors(output.diagnostics).forEach((<any>webpack).emitWarning, webpack);
            }

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
