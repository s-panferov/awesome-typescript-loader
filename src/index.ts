/// <reference path='../node_modules/typescript/bin/typescriptServices.d.ts' />
/// <reference path='../typings/tsd.d.ts' />

import * as Promise from 'bluebird';
import * as path from 'path';
import * as fs from 'fs';
import * as _ from 'lodash';

import { CompilerOptions, TypeScriptCompilationError, State } from './host';
import { Resolver, ResolutionError } from './deps';
import * as helpers from './helpers';

var loaderUtils = require('loader-utils');

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
    tsState: State;
    compiledFiles: {[key:string]: boolean};
    options: CompilerOptions;
    externalsInvoked: boolean;
}

function getRootCompiler(compiler) {
    if (compiler.parentCompilation) {
        return getRootCompiler(compiler.parentCompilation.compiler)
    } else {
        return compiler;
    }
}

function getInstanceStore(compiler): {[key:string]: CompilerInstance} {
    var store = getRootCompiler(compiler)._tsInstances;
    if (store) {
        return store
    } else {
        throw new Error('Can not resolve instance store')
    }
}

function ensureInstanceStore(compiler) {
    var rootCompiler = getRootCompiler(compiler);
    if (!rootCompiler._tsInstances) {
        rootCompiler._tsInstances = {};
    }
}

function resolveInstance(compiler, instanceName) {
    return getInstanceStore(compiler)[instanceName];
}

/**
 * Creates compiler instance
 */
function ensureInstance(webpack: WebPack, options: CompilerOptions, instanceName: string): CompilerInstance {
    ensureInstanceStore(webpack._compiler);

    var exInstance = resolveInstance(webpack._compiler, instanceName);
    if (exInstance) {
        return exInstance
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

        _.extend(options, configFile.compilerOptions);
        _.extend(options, configFile.awesomeTypescriptLoaderOptions);
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

    if (typeof options.rewriteImports == 'undefined') {
        options.rewriteImports = '';
    }

    if (options.target) {
        options.target = helpers.parseOptionTarget(<any>options.target, tsImpl);
    }

    var tsState = new State(options, webpack._compiler.inputFileSystem, tsImpl);

    var compiler = (<any>webpack._compiler);

    compiler.plugin('watch-run', (watching, callback) => {
        var resolver = <Resolver>Promise.promisify(watching.compiler.resolvers.normal.resolve);
        var instance: CompilerInstance = resolveInstance(watching.compiler, instanceName);
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

    compiler.plugin('after-compile', function(compilation, callback) {

        var instance: CompilerInstance = resolveInstance(compilation.compiler, instanceName);
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

    return getInstanceStore(webpack._compiler)[instanceName] = {
        tsFlow,
        tsState,
        compiledFiles: {},
        options,
        externalsInvoked: false
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
    var resolver = <Resolver>Promise.promisify(webpack.resolve);
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

    if (options.externals && !instance.externalsInvoked) {
        instance.externalsInvoked = true;
        instance.tsFlow = instance.tsFlow.then(
            <any>Promise.all(options.externals.split(',').map(external => {
                return state.fileAnalyzer.checkDependencies(resolver, external);
            }))
        );
    }

    instance.tsFlow = instance.tsFlow
        .then(() => {
            instance.compiledFiles[fileName] = true;
            let doUpdate = false;
            if (instance.options.useWebpackText) {
                if(state.updateFile(fileName, text, true)) {
                    doUpdate = true;
                }
            }

            return state.fileAnalyzer.checkDependencies(resolver, fileName).then((wasChanged) => {
                if (doUpdate || wasChanged) {
                    state.updateProgram();
                }
            });
        })
        .then(() => {
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
        .catch(ResolutionError, err => {
            console.error(err);
            callback(err, helpers.codegenErrorReport([err]));
        })
        .catch((err) => { console.error(err); callback(err) })
}

export = loader;
