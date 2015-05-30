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
    compiledFiles: {[key:string]: boolean};
    options: CompilerOptions;
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

    var configFileName = tsImpl.findConfigFile(options.tsconfig || process.cwd());
    var configFile = null;
    if (configFileName) {
        configFile = tsImpl.readConfigFile(configFileName);
        if (configFile.error) {
            throw configFile.error;
        }

        _.extend(options, configFile.config.compilerOptions);
        _.extend(options, configFile.config.awesomeTypescriptLoaderOptions);
    }

    if (typeof options.emitRequireType === 'undefined') {
        options.emitRequireType = true;
    } else {
        if (typeof options.emitRequireType === 'string') {
            options.emitRequireType = (<any>options.emitRequireType) === 'true'
        }
    }

    if (typeof options.reEmitDependentFiles === 'undefined') {
        options.reEmitDependentFiles = false;
    } else {
        if (typeof options.reEmitDependentFiles === 'string') {
            options.reEmitDependentFiles = (<any>options.reEmitDependentFiles) === 'true'
        }
    }

    if (typeof options.useWebpackText === 'undefined') {
        options.useWebpackText = false;
    } else {
        if (typeof options.useWebpackText === 'string') {
            options.useWebpackText = (<any>options.useWebpackText) === 'true'
        }
    }

    if (options.target) {
        options.target = helpers.parseOptionTarget(<any>options.target, tsImpl);
    }

    var tsState = new host.State(options, webpack._compiler.inputFileSystem, tsImpl);

    var compiler = (<any>webpack._compiler);

    compiler.plugin("watch-run", (watching, callback) => {
        var resolver = <deps.Resolver>Promise.promisify(watching.compiler.resolvers.normal.resolve);
        var instance: CompilerInstance = watching.compiler._tsInstances[instanceName];
        var state = instance.tsState;
        var mtimes = watching.compiler.watchFileSystem.watcher.mtimes;
        var changedFiles = Object.keys(mtimes);

        changedFiles.forEach((changedFile) => {
            state.fileAnalyzer.validFiles.markFileInvalid(changedFile);
        });

        Promise.all(changedFiles.map((changedFile) => {
            if (/\.ts$|\.d\.ts$/.test(changedFile)) {
                return state.readFileAndUpdate(changedFile).then(() => {
                    return state.fileAnalyzer.checkDependencies(resolver, changedFile);
                });
            } else {
                return Promise.resolve()
            }
        }))
            .then(_ => { state.updateProgram(); callback(); })
            .catch((err) => console.error(err))
    });

    compiler.plugin("after-compile", function(compilation, callback) {
        var instance: CompilerInstance = compilation.compiler._tsInstances[instanceName];
        var state = instance.tsState;
        var diagnostics = state.ts.getPreEmitDiagnostics(state.program);
        var emitError = (err) => {
            compilation.errors.push(new Error(err))
        };

        var phantomImports = [];
        Object.keys(state.files).forEach((fileName) => {
            if (!instance.compiledFiles[fileName]) {
                phantomImports.push(fileName)
            }
        });

        instance.compiledFiles = {};
        compilation.fileDependencies.push.apply(compilation.fileDependencies, phantomImports);
        compilation.fileDependencies = _.uniq(compilation.fileDependencies);

        var errors = helpers.formatErrors(diagnostics);
        errors.forEach(emitError);
        callback();
    });

    return webpack._compiler._tsInstances[instanceName] = {
        tsFlow,
        tsState,
        compiledFiles: {},
        options
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
    var resolver = <deps.Resolver>Promise.promisify(webpack.resolve);

    var depsInjector = {
        add: (depFileName) => {webpack.addDependency(depFileName)},
        clear: webpack.clearDependencies.bind(webpack)
    };

    var applyDeps = _.once(() => {
        depsInjector.clear();
        depsInjector.add(fileName);
        if (state.options.reEmitDependentFiles) {
            state.fileAnalyzer.dependencies.applyChain(fileName, depsInjector);
        }
    });

    instance.tsFlow = instance.tsFlow
        .then(() => state.fileAnalyzer.checkDependencies(resolver, fileName))
        .then(() => {
            instance.compiledFiles[fileName] = true;
            if (instance.options.useWebpackText) {
                if(state.updateFile(fileName, text, true)) {
                    state.updateProgram();
                }
            }
            return state.emit(fileName)
        })
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
        .catch(deps.ResolutionError, err => {
            console.error(err);
            callback(err, helpers.codegenErrorReport([err]));
        })
        .catch((err) => { console.error(err); callback(err) })
}

export = loader;
