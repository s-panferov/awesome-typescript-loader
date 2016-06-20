import { State } from './host';
import * as fs from 'fs';
import * as path from 'path';
import * as _ from 'lodash';
import { formatError } from './helpers';
import { ICompilerInfo } from './host';
import { createChecker } from './checker';

let colors = require('colors/safe');
let pkg = require('../package.json');

export interface LoaderPlugin {
    processProgram?: (program: ts.Program) => void;
}

export interface LoaderPluginDef {
    file: string;
    options: any;
}

export interface ICompilerInstance {
    id: number;
    tsState: State;
    babelImpl?: any;
    compiledFiles: {[key:string]: boolean};
    compilerConfig: TsConfig;
    loaderConfig: LoaderConfig;
    externalsInvoked: boolean;
    checker: any;
    cacheIdentifier: any;
    plugins: LoaderPluginDef[];
    initedPlugins: LoaderPlugin[];
    shouldUpdateProgram: boolean;
}

interface ICompiler {
    inputFileSystem: typeof fs;
    _tsInstances: {[key:string]: ICompilerInstance};
    _tsFork: boolean;
    options: {
        externals: {
            [ key: string ]: string
        }
    };
}

export interface IWebPack {
    _compiler: ICompiler;
    cacheable: () => void;
    query: string;
    async: () => (err: Error, source?: string, map?: string) => void;
    resourcePath: string;
    resolve: () => void;
    addDependency: (dep: string) => void;
    clearDependencies: () => void;
    emitFile: (fileName: string, text: string) => void;
    options: {
        atl?: {
            plugins: LoaderPluginDef[]
        }
    };
}

export interface LoaderConfig {
    instanceName?: string;
    showRecompileReason?: boolean;
    compiler?: string;
    emitRequireType?: boolean;
    reEmitDependentFiles?: boolean;
    tsconfig?: string;
    useWebpackText?: boolean;
    externals?: string[];
    doTypeCheck?: boolean;
    ignoreDiagnostics?: number[];
    forkChecker?: boolean;
    forkCheckerSilent?: boolean;
    useBabel?: boolean;
    babelCore?: string;
    babelOptions?: any;
    usePrecompiledFiles?: boolean;
    skipDeclarationFilesCheck?: boolean;
    useCache?: boolean;
    cacheDirectory?: string;
    resolveGlobs?: boolean;
    library: string;
}

export type QueryOptions = LoaderConfig & ts.CompilerOptions;
export type TsConfig = ts.ParsedCommandLine;

function getRootCompiler(compiler) {
    if (compiler.parentCompilation) {
        return getRootCompiler(compiler.parentCompilation.compiler);
    } else {
        return compiler;
    }
}

function getInstanceStore(compiler): { [key:string]: ICompilerInstance } {
    let store = getRootCompiler(compiler)._tsInstances;
    if (store) {
        return store;
    } else {
        throw new Error('Can not resolve instance store');
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

const COMPILER_ERROR = colors.red(`\n\nTypescript compiler cannot be found, please add it to your package.json file:
    npm install --save-dev typescript
`);

const BABEL_ERROR = colors.red(`\n\nBabel compiler cannot be found, please add it to your package.json file:
    npm install --save-dev babel-core
`);

/**
 * Creates compiler instance
 */
let id = 0;
export function ensureInstance(webpack: IWebPack, query: QueryOptions, instanceName: string): ICompilerInstance {
    ensureInstanceStore(webpack._compiler);

    let exInstance = resolveInstance(webpack._compiler, instanceName);

    if (exInstance) {
        return exInstance;
    }

    let compilerPath = query.compiler || 'typescript';

    let tsImpl: typeof ts;
    try {
        tsImpl = require(compilerPath);
    } catch (e) {
        console.error(e);
        console.error(COMPILER_ERROR);
        process.exit(1);
    }

    let compilerInfo: ICompilerInfo = {
        compilerPath,
        tsImpl,
    };

    let { compilerConfig, loaderConfig } = readConfigFile(process.cwd(), query, tsImpl);

    console.log(compilerConfig, loaderConfig);

    applyDefaults(compilerConfig, loaderConfig);
    let babelImpl = setupBabel(loaderConfig);
    let cacheIdentifier = setupCache(loaderConfig, tsImpl, webpack, babelImpl);

    let forkChecker = loaderConfig.forkChecker && getRootCompiler(webpack._compiler)._tsFork;
    let tsState = new State(
        loaderConfig,
        compilerConfig,
        compilerInfo
    );

    let compiler = (<any>webpack._compiler);

    setupWatchRun(compiler, instanceName);

    if (loaderConfig.doTypeCheck) {
        setupAfterCompile(compiler, instanceName, forkChecker);
    }

    let webpackOptions = _.pick(webpack._compiler.options, 'resolve');

    let atlOptions = webpack.options.atl;
    let plugins: LoaderPluginDef[] = [];

    if (atlOptions && atlOptions.plugins) {
        plugins = atlOptions.plugins;
    }

    let initedPlugins = [];
    if (!forkChecker) {
        initedPlugins = plugins.map(plugin => {
            return require(plugin.file)(plugin.options);
        });
    }

    return getInstanceStore(webpack._compiler)[instanceName] = {
        id: ++id,
        tsState,
        babelImpl,
        compiledFiles: {},
        loaderConfig,
        compilerConfig,
        externalsInvoked: false,
        checker: forkChecker
            ? createChecker(
                compilerInfo,
                loaderConfig,
                compilerConfig.options,
                webpackOptions,
                tsState.defaultLib,
                plugins)
            : null,
        cacheIdentifier,
        plugins,
        initedPlugins,
        shouldUpdateProgram: true
    };
}

function setupCache(loaderConfig: LoaderConfig, tsImpl: typeof ts, webpack: IWebPack, babelImpl: any) {
    let cacheIdentifier = null;
    if (loaderConfig.useCache) {
        if (!loaderConfig.cacheDirectory) {
            loaderConfig.cacheDirectory = path.join(process.cwd(), '.awcache');
        }

        if (!fs.existsSync(loaderConfig.cacheDirectory)) {
            fs.mkdirSync(loaderConfig.cacheDirectory);
        }

        cacheIdentifier = {
            'typescript': tsImpl.version,
            'awesome-typescript-loader': pkg.version,
            'awesome-typescript-loader-query': webpack.query,
            'babel-core': babelImpl
                ? babelImpl.version
                : null
        };
    }
}

function setupBabel(loaderConfig: LoaderConfig): any {
    let babelImpl: any;
    if (loaderConfig.useBabel) {
        try {
            let babelPath = loaderConfig.babelCore || path.join(process.cwd(), 'node_modules', 'babel-core');
            babelImpl = require(babelPath);
        } catch (e) {
            console.error(BABEL_ERROR);
            process.exit(1);
        }
    }

    return babelImpl;
}

function applyDefaults(compilerConfig: TsConfig, loaderConfig: LoaderConfig) {
    compilerConfig.typingOptions.exclude = compilerConfig.typingOptions.exclude || [];
    let initialFiles = compilerConfig.fileNames;

    _.defaults(compilerConfig.options, {
        sourceMap: true,
        verbose: false,
        skipDefaultLibCheck: true,
        suppressOutputPathCheck: true,
    });

    _.defaults(compilerConfig.options, {
        sourceRoot: compilerConfig.options.sourceMap ? process.cwd() : undefined
    });

    _.defaults(loaderConfig, {
        externals: [],
        doTypeCheck: true,
        sourceMap: true,
        verbose: false,
    });

    delete compilerConfig.options.outDir;
    delete compilerConfig.options.outFile;
    delete compilerConfig.options.out;
    delete compilerConfig.options.noEmit;

    loaderConfig.externals.push.apply(loaderConfig.externals, initialFiles);
}

function readConfigFile(baseDir: string, query: QueryOptions, tsImpl: typeof ts): { compilerConfig: TsConfig, loaderConfig } {
    let configFilePath: string;
    if (query.tsconfig && query.tsconfig.match(/\.json$/)) {
        configFilePath = query.tsconfig;
    } else {
        configFilePath = tsImpl.findConfigFile(process.cwd(), tsImpl.sys.fileExists);
    }

    if (!configFilePath) {
        return null;
    }

    let existingOptions = tsImpl.convertCompilerOptionsFromJson(query, process.cwd(), 'atl.query');
    let jsonConfigFile = tsImpl.readConfigFile(configFilePath, tsImpl.sys.readFile);

    let compilerConfig = tsImpl.parseJsonConfigFileContent(
        jsonConfigFile.config,
        tsImpl.sys,
        process.cwd(),
        existingOptions.options,
        configFilePath
    );

    return {
        compilerConfig,
        loaderConfig: _.defaults(query, jsonConfigFile.config.awesomeTypescriptLoaderOptions)
    };
}

let EXTENSIONS = /\.tsx?$|\.jsx?$/;

function setupWatchRun(compiler, instanceName: string) {
    compiler.plugin('watch-run', function (watching, callback) {
        let instance = resolveInstance(watching.compiler, instanceName);
        let state = instance.tsState;
        let mtimes = watching.compiler.watchFileSystem.watcher.mtimes;
        let changedFiles = Object.keys(mtimes);

        changedFiles.forEach((changedFile) => {
            state.fileAnalyzer.validFiles.markFileInvalid(changedFile);
        });

        try {
            changedFiles.forEach(changedFile => {
                if (EXTENSIONS.test(changedFile)) {
                    if (state.hasFile(changedFile)) {
                        state.readFileAndUpdate(changedFile);
                        state.fileAnalyzer.checkDependencies(changedFile);
                    }
                }
            });

            if (!state.loaderConfig.forkChecker) {
                state.updateProgram();
            }
            callback();
        } catch (err) {
            console.error(err.toString());
            callback();
        }
    });
}

let runChecker = (instance, payload) => {
    instance.checker.send({
        messageType: 'compile',
        payload
    });
};

runChecker = _.debounce(runChecker, 200);

function setupAfterCompile(compiler, instanceName, forkChecker = false) {
    compiler.plugin('after-compile', function(compilation, callback) {
        // Don't add errors for child compilations
        if (compilation.compiler.isChild()) {
            callback();
            return;
        }

        let instance: ICompilerInstance = resolveInstance(compilation.compiler, instanceName);
        let state = instance.tsState;

        if (forkChecker) {
            let payload = {
                files: state.allFiles(),
                resolutionCache: state.fileAnalyzer.dependencies.resolutions
            };

            runChecker(instance, payload);
        } else {
            if (!state.program || instance.shouldUpdateProgram) {
                // program may be undefined here, if all files
                // will be loaded by tsconfig
                state.updateProgram();
                instance.shouldUpdateProgram = false;
            }

            let diagnostics = state.ts.getPreEmitDiagnostics(state.program);
            let emitError = (msg) => {
                if (compilation.bail) {
                    console.error('Error in bail mode:', msg);
                    process.exit(1);
                }
                compilation.errors.push(new Error(msg));
            };

            let { loaderConfig: { ignoreDiagnostics } } = instance;
            diagnostics
                .filter(err => !ignoreDiagnostics || ignoreDiagnostics.indexOf(err.code) == -1)
                .map(err => `[${ instanceName }] ` + formatError(err))
                .forEach(emitError);

            instance.initedPlugins.forEach(plugin => {
                plugin.processProgram(state.program);
            });
        }

        let phantomImports = [];
        state.allFileNames().forEach((fileName) => {
            if (!instance.compiledFiles[fileName]) {
                phantomImports.push(fileName);
            }
        });

        if (instance.compilerConfig.options.declaration) {
            phantomImports.forEach(imp => {
                let output = instance.tsState.services.getEmitOutput(imp);
                let declarationFile = output.outputFiles.filter(filePath =>
                    !!filePath.name.match(/\.d.ts$/))[0];
                if (declarationFile) {
                    let assetPath = path.relative(process.cwd(), declarationFile.name);
                    compilation.assets[assetPath] = {
                        source: () => declarationFile.text,
                        size: () => declarationFile.text.length
                    };
                }
            });
        }

        instance.compiledFiles = {};
        compilation.fileDependencies.push.apply(compilation.fileDependencies, phantomImports);
        compilation.fileDependencies = _.uniq(compilation.fileDependencies);

        callback();
    });
}
