/// <reference path='../node_modules/typescript/lib/typescriptServices.d.ts' />
/// <reference path='../typings/tsd.d.ts' />

import * as Promise from 'bluebird';
import * as path from 'path';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as childProcess from 'child_process';
import * as colors from 'colors';

import { ICompilerOptions, TypeScriptCompilationError, State, ICompilerInfo } from './host';
import { IResolver, ResolutionError } from './deps';
import { findCompiledModule, cache } from './cache';
import * as helpers from './helpers';
import { loadLib } from './helpers';

let loaderUtils = require('loader-utils');

let pkg = require('../package.json');
let cachePromise = Promise.promisify(cache);

interface ICompiler {
    inputFileSystem: typeof fs;
    _tsInstances: {[key:string]: ICompilerInstance};
    options: {
        externals: {
            [ key: string ]: string
        }
    }
}

interface IWebPack {
    _compiler: ICompiler;
    cacheable: () => void;
    query: string;
    async: () => (err: Error, source?: string, map?: string) => void;
    resourcePath: string;
    resolve: () => void;
    addDependency: (dep: string) => void;
    clearDependencies: () => void;
}

interface ICompilerInstance {
    tsFlow: Promise<any>;
    tsState: State;
    babelImpl?: any;
    compiledFiles: {[key:string]: boolean};
    options: ICompilerOptions;
    externalsInvoked: boolean;
    checker: any;
    cacheIdentifier: any;
}

function getRootCompiler(compiler) {
    if (compiler.parentCompilation) {
        return getRootCompiler(compiler.parentCompilation.compiler)
    } else {
        return compiler;
    }
}

function getInstanceStore(compiler): {[key:string]: ICompilerInstance} {
    let store = getRootCompiler(compiler)._tsInstances;
    if (store) {
        return store
    } else {
        throw new Error('Can not resolve instance store')
    }
}

function ensureInstanceStore(compiler) {
    let rootCompiler = getRootCompiler(compiler);
    if (!rootCompiler._tsInstances) {
        rootCompiler._tsInstances = {};
    }
}

function resolveInstance(compiler, instanceName) {
    return getInstanceStore(compiler)[instanceName];
}

function createResolver(compiler: ICompiler, webpackResolver: any): IResolver {
    let externals = compiler.options.externals;
    let resolver = <IResolver>Promise.promisify(webpackResolver);

    function resolve(base: string, dep: string): Promise<string> {
        if (externals && externals.hasOwnProperty(dep)) {
            return Promise.resolve<string>('%%ignore')
        } else {
            return resolver(base, dep)
        }
    }

    return resolve;
}

function createChecker(compilerInfo: ICompilerInfo, compilerOptions: ICompilerOptions) {
    let checker = childProcess.fork(path.join(__dirname, 'checker.js'));

    checker.send({
        messageType: 'init',
        payload: {
            compilerInfo: _.omit(compilerInfo, 'tsImpl'),
            compilerOptions
        }
    }, null);

    return checker;
}

const COMPILER_ERROR = colors.red(`\n\nTypescript compiler cannot be found, please add it to your package.json file:
    npm install --save-dev typescript
`);

const BABEL_ERROR = colors.red(`\n\nBabel compiler cannot be found, please add it to your package.json file:
    npm install --save-dev babel
`);

/**
 * Creates compiler instance
 */
function ensureInstance(webpack: IWebPack, options: ICompilerOptions, instanceName: string): ICompilerInstance {
    ensureInstanceStore(webpack._compiler);

    let exInstance = resolveInstance(webpack._compiler, instanceName);
    if (exInstance) {
        return exInstance
    }

    let tsFlow = Promise.resolve();

    let compilerName = options.compiler || 'typescript';
    let compilerPath = path.dirname(compilerName);
    if (compilerPath == '.') {
        compilerPath = compilerName
    }

    let tsImpl: typeof ts;
    try {
        tsImpl = require(compilerName);
    } catch (e) {
        console.error(COMPILER_ERROR);
        process.exit(1);
    }

    let libPath = path.join(compilerPath, 'lib', 'lib.d.ts');
    let lib6Path = path.join(compilerPath, 'lib', 'lib.es6.d.ts');

    try {
        require.resolve(libPath);
    } catch(e) {
        libPath = path.join(compilerPath, 'bin', 'lib.d.ts');
        lib6Path = path.join(compilerPath, 'bin', 'lib.es6.d.ts');
    }

    let compilerInfo: ICompilerInfo = {
        compilerName,
        compilerPath,
        tsImpl,
        lib5: loadLib(libPath),
        lib6: loadLib(lib6Path)
    };

    let configFileName = tsImpl.findConfigFile(options.tsconfig || process.cwd());
    let configFile = null;
    if (configFileName) {
        configFile = tsImpl.readConfigFile(configFileName);
        if (configFile.error) {
            throw configFile.error;
        }
        if (configFile.config) {
            _.extend(options, configFile.config.compilerOptions);
            _.extend(options, configFile.config.awesomeTypescriptLoaderOptions);
        }
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

    if (typeof options.jsx !== 'undefined') {
        switch(options.jsx as any) {
            case 'react': options.jsx = ts.JsxEmit.React; break;
            case 'preserve': options.jsx = ts.JsxEmit.Preserve; break;
        }
    }

    if (typeof options.rewriteImports == 'undefined') {
        options.rewriteImports = [];
    }

    if (typeof options.externals == 'undefined') {
        options.externals = [];
    }

    if (options.target) {
        options.target = helpers.parseOptionTarget(<any>options.target, tsImpl);
    }

    let babelImpl: any;
    if (options.useBabel) {
        try {
            babelImpl = require(path.join(process.cwd(), 'node_modules', 'babel'));
        } catch (e) {
            console.error(BABEL_ERROR);
            process.exit(1);
        }
    }

    let cacheIdentifier = null;
    if (options.useCache) {
        console.log(webpack.query);

        if (!options.cacheDirectory) {
            options.cacheDirectory = path.join(process.cwd(), '.awcache');
        }

        if (!fs.existsSync(options.cacheDirectory)) {
            fs.mkdirSync(options.cacheDirectory)
        }

        cacheIdentifier = {
            'typescript': tsImpl.version,
            'awesome-typescript-loader': pkg.version,
            'awesome-typescript-loader-query': webpack.query,
            'babel-core': babelImpl
                ? babelImpl.version
                : null
        }
    }

    let tsState = new State(options, webpack._compiler.inputFileSystem, compilerInfo);
    let compiler = (<any>webpack._compiler);

    compiler.plugin('watch-run', (watching, callback) => {
        let resolver = createResolver(watching.compiler, watching.compiler.resolvers.normal.resolve);
        let instance: ICompilerInstance = resolveInstance(watching.compiler, instanceName);
        let state = instance.tsState;
        let mtimes = watching.compiler.watchFileSystem.watcher.mtimes;
        let changedFiles = Object.keys(mtimes);

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
            let instance: ICompilerInstance = resolveInstance(compilation.compiler, instanceName);
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

                let errors = helpers.formatErrors(diagnostics);
                errors.forEach(emitError);
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
        babelImpl,
        compiledFiles: {},
        options,
        externalsInvoked: false,
        checker: options.forkChecker
            ? createChecker(compilerInfo, options)
            : null,
        cacheIdentifier
    }
}

function loader(text) {
    compiler.call(undefined, this, text)
}

function compiler(webpack: IWebPack, text: string): void {
    if (webpack.cacheable) {
        webpack.cacheable();
    }

    let options = <ICompilerOptions>loaderUtils.parseQuery(webpack.query);
    let instanceName = options.instanceName || 'default';

    let instance = ensureInstance(webpack, options, instanceName);

    let state = instance.tsState;

    let callback = webpack.async();
    let fileName = webpack.resourcePath;

    let resolver = createResolver(webpack._compiler, webpack.resolve);
    let isDepsApplied = false;

    let depsInjector = {
        add: (depFileName) => {webpack.addDependency(depFileName)},
        clear: webpack.clearDependencies.bind(webpack)
    };

    let applyDeps = _.once(() => {
        depsInjector.clear();
        depsInjector.add(fileName);
        state.fileAnalyzer.dependencies.applyCompiledFiles(fileName, depsInjector);
        if (state.options.reEmitDependentFiles) {
            state.fileAnalyzer.dependencies.applyChain(fileName, depsInjector);
        }
    });

    if (options.externals && !instance.externalsInvoked) {
        instance.externalsInvoked = true;
        instance.tsFlow = instance.tsFlow.then(() => {
            return <any>Promise.all(options.externals.map(external => {
                return state.fileAnalyzer.checkDependencies(resolver, external);
            }))
        });
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
            let compiledModule
            if (instance.options.usePrecompiledFiles) {
                compiledModule = findCompiledModule(fileName);
            }

            if (compiledModule) {
                state.fileAnalyzer.dependencies.addCompiledModule(fileName, compiledModule.fileName);
                return {
                    text: compiledModule.text,
                    map: JSON.parse(compiledModule.map)
                }
            } else {

                function transform() {
                    let resultText;
                    let resultSourceMap;
                    let output = state.emit(fileName);
                    let result = helpers.findResultFor(output, fileName);

                    if (result.text === undefined) {
                        throw new Error('No output found for ' + fileName);
                    }

                    resultText = result.text;
                    resultSourceMap = JSON.parse(result.sourceMap);
                    resultSourceMap.sources = [ fileName ];
                    resultSourceMap.file = fileName;
                    resultSourceMap.sourcesContent = [ text ];

                    if (instance.options.useBabel) {
                        let defaultOptions = {
                            inputSourceMap: resultSourceMap,
                            filename: fileName,
                            sourceMap: true
                        }

                        let babelResult = instance.babelImpl.transform(resultText, defaultOptions);
                        resultText = babelResult.code;
                        resultSourceMap = babelResult.map;
                    }

                    return {
                        text: resultText,
                        map: resultSourceMap
                    };
                }

                if (instance.options.useCache) {
                    return cachePromise({
                        source: text,
                        identifier: instance.cacheIdentifier,
                        directory: instance.options.cacheDirectory,
                        options: webpack.query,
                        transform: transform
                    })
                } else {
                    return transform();
                }
            }
        })
        .then((transform: { text: string; map: any }) => {
            let resultText = transform.text;
            let resultSourceMap = transform.map;

            if (resultSourceMap) {
                resultSourceMap.sources = [ fileName ];
                resultSourceMap.file = fileName;
                resultSourceMap.sourcesContent = [ text ];
            }

            applyDeps();
            isDepsApplied = true;

            try {
                callback(null, resultText, resultSourceMap)
            } catch (e) {
                console.error('Error in bail mode:', e);
                process.exit(1);
            }
        })
        .finally(() => {
            if (!isDepsApplied) {
                applyDeps();
            }
        })
        .catch(ResolutionError, err => {
            callback(err, helpers.codegenErrorReport([err]));
        })
        .catch((err) => { callback(err) })
}

export = loader;
