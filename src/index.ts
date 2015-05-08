/// <reference path="../node_modules/typescript/bin/typescriptServices.d.ts" />
/// <reference path="../typings/tsd.d.ts" />


import Promise = require("bluebird");
import path = require('path');
import fs = require('fs');
import _ = require('lodash');

var loaderUtils = require('loader-utils');

import host = require('./host');
import deps = require('./deps');
import helpers = require('./helpers');

import CompilerOptions = host.CompilerOptions;
import TypeScriptCompilationError = host.TypeScriptCompilationError;

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

    var compiler = (<any>webpack._compiler);

    compiler.plugin("watch-run", (watching, callback) => {
        var resolver = <host.Resolver>Promise.promisify(watching.compiler.resolvers.normal.resolve);
        var state = watching.compiler._tsInstances[instanceName].tsState;
        var mtimes = watching.compiler.watchFileSystem.watcher.mtimes;
        Promise.all(Object.keys(mtimes).map((changedFile) => {
            if (/\.d\.ts$/.test(changedFile)) {
                return state.readFileAndUpdate(changedFile).then(() => {
                    return state.checkDeclarations(resolver, changedFile);
                });
            } else {
                return Promise.resolve()
            }
        }))
            .then(_ => { state.updateProgram(); callback(); })
            .catch((err) => console.error(err))
    });

    compiler.plugin("after-compile", function(compilation, callback) {
        var state = compilation.compiler._tsInstances[instanceName].tsState;
        state.clearIndirectImportCache();
        var diagnostics = state.ts.getPreEmitDiagnostics(state.program);
        var emitError = (err) => {
            compilation.errors.push(new Error(err))
        }

        var errors = helpers.formatErrors(diagnostics);
        errors.forEach(emitError);
        callback();
    });

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

    var applyDeps = _.once(() => {
        deps.clear();
        deps.add(fileName);
        state.dependencies.applyChain(fileName, deps);
    })

    instance.tsFlow = instance.tsFlow
        .then(() => {
            state.updateFile(fileName, text, false);
        })
        .then(() => state.checkDeclarations(resolver, fileName))
        .then(() => state.updateProgram())
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

            applyDeps();

            callback(null, result.text, sourceMap);
        })
        .finally(() => {
            applyDeps();
        })
        .catch(host.ResolutionError, err => {
            console.error(err)
            callback(err, helpers.codegenErrorReport([err]));
        })
        .catch((err) => { console.error(err); callback(err) })
}

export = loader;
