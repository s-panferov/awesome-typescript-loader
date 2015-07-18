/// <reference path='../node_modules/ntypescript/bin/typescriptServices.d.ts' />
/// <reference path='../typings/tsd.d.ts' />

import * as Promise from 'bluebird';
import * as path from 'path';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as childProcess from 'child_process';

import { CompilerOptions, TypeScriptCompilationError, State, CompilerInfo } from './host';
import { Resolver, ResolutionError } from './deps';
import * as helpers from './helpers';
import { loadLib } from './helpers';

var loaderUtils = require('loader-utils');

interface ICompiler {
    inputFileSystem: typeof fs;
    _tsInstances: {[key:string]: CompilerInstance};
    options: {
        externals: {
            [ key: string ]: string
        }
    }
}

interface WebPack {
    _compiler: ICompiler;
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
    checker: any;
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

function createResolver(compiler: ICompiler, webpackResolver: any): Resolver {
    let externals = compiler.options.externals;
    let resolver = <Resolver>Promise.promisify(webpackResolver);

    function resolve(base: string, dep: string): Promise<string> {
        if (externals && externals.hasOwnProperty(dep)) {
            return Promise.resolve<string>('%%ignore')
        } else {
            return resolver(base, dep)
        }
    }

    return resolve;
}

function createChecker(compilerInfo: CompilerInfo, compilerOptions: CompilerOptions) {
    var checker = childProcess.fork(path.join(__dirname, 'checker.js'));

    checker.send({
        messageType: 'init',
        payload: {
            compilerInfo: _.omit(compilerInfo, 'tsImpl'),
            compilerOptions
        }
    }, null)

    return checker;
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

    let compilerName = options.compiler || 'typescript';
    let compilerPath = path.dirname(compilerName);
    if (compilerPath == '.') {
        compilerPath = compilerName
    }

    let tsImpl: typeof ts = require(compilerName);

    let compilerInfo: CompilerInfo = {
        compilerName,
        compilerPath,
        tsImpl,
        lib5: loadLib(path.join(compilerPath, 'bin', 'lib.d.ts')),
        lib6: loadLib(path.join(compilerPath, 'bin', 'lib.es6.d.ts'))
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

    if (typeof options.doTypeCheck === 'undefined') {
        options.doTypeCheck = true;
    } else {
        if (typeof options.doTypeCheck === 'string') {
            options.doTypeCheck = (<any>options.doTypeCheck) === 'true'
        }
    }

    if (typeof options.forkChecker === 'undefined') {
        options.forkChecker = false;
    } else {
        if (typeof options.forkChecker === 'string') {
            options.forkChecker = (<any>options.forkChecker) === 'true'
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

    var tsState = new State(options, webpack._compiler.inputFileSystem, compilerInfo);
    var compiler = (<any>webpack._compiler);

    compiler.plugin('watch-run', (watching, callback) => {
        var resolver = createResolver(watching.compiler, watching.compiler.resolvers.normal.resolve);
        var instance: CompilerInstance = resolveInstance(watching.compiler, instanceName);
        var state = instance.tsState;
        var mtimes = watching.compiler.watchFileSystem.watcher.mtimes;
        var changedFiles = Object.keys(mtimes);

        changedFiles.forEach((changedFile) => {
            state.fileAnalyzer.validFiles.markFileInvalid(changedFile);
        });

        Promise.all(changedFiles.map((changedFile) => {
            if (/\.ts$|\.d\.ts|\.tsx$/.test(changedFile)) {
                return state.readFileAndUpdate(changedFile).then(() => {
                    return state.fileAnalyzer.checkDependencies(resolver, changedFile);
                });
            } else {
                return Promise.resolve()
            }
        }))
            .then(_ => { state.updateProgram(); callback(); })
            .catch(ResolutionError, err => {
                console.error(err.message);
                callback();
            })
            .catch((err) => { console.log(err); callback() })
    });

    if (options.doTypeCheck) {
        compiler.plugin('after-compile', function(compilation, callback) {
            let instance: CompilerInstance = resolveInstance(compilation.compiler, instanceName);
            let state = instance.tsState;

            if (options.forkChecker) {
                let payload = {
                    files: state.files
                };

                console.time('\nSending files to the checker');
                instance.checker.send({
                    messageType: 'compile',
                    payload
                })
                console.timeEnd('\nSending files to the checker');
            } else {
                let diagnostics = state.ts.getPreEmitDiagnostics(state.program);
                let emitError = (err) => {
                    if (compilation.bail) {
                        console.error('Error in bail mode:', err);
                        process.exit(1);
                    }
                    compilation.errors.push(new Error(err))
                };

                var errors = helpers.formatErrors(diagnostics);
                errors.forEach(emitError);
                callback();
            }

            let phantomImports = [];
            Object.keys(state.files).forEach((fileName) => {
                if (!instance.compiledFiles[fileName]) {
                    phantomImports.push(fileName)
                }
            });

            instance.compiledFiles = {};
            compilation.fileDependencies.push.apply(compilation.fileDependencies, phantomImports);
            compilation.fileDependencies = _.uniq(compilation.fileDependencies);
            callback();
        });
    }

    return getInstanceStore(webpack._compiler)[instanceName] = {
        tsFlow,
        tsState,
        compiledFiles: {},
        options,
        externalsInvoked: false,
        checker: options.forkChecker
            ? createChecker(compilerInfo, options)
            : null
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

    var resolver = createResolver(webpack._compiler, webpack.resolve);

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

            var sourceMap = JSON.parse(result.sourceMap);
            sourceMap.sources = [ fileName ];
            sourceMap.file = fileName;
            sourceMap.sourcesContent = [ text ];

            applyDeps();

            try {
                callback(null, result.text, sourceMap);
            } catch (e) {
                console.error('Error in bail mode:', e);
                process.exit(1);
            }
        })
        .finally(() => {
            applyDeps();
        })
        .catch(ResolutionError, err => {
            callback(err, helpers.codegenErrorReport([err]));
        })
        .catch((err) => { callback(err) })
}

export = loader;
