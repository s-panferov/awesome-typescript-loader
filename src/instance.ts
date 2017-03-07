import * as fs from 'fs';
import * as path from 'path';
import * as _ from 'lodash';
import * as ts from 'typescript';
import { toUnix } from './helpers';
import { Checker } from './checker';
import { CompilerInfo, LoaderConfig, TsConfig } from './interfaces';
import { WatchModeSymbol } from './watch-mode';

let colors = require('colors/safe');
let pkg = require('../package.json');
let mkdirp = require('mkdirp');

export interface Instance {
    id: number;
    babelImpl?: any;
    compiledFiles: { [key: string]: boolean };
    configFilePath: string;
    compilerConfig: TsConfig;
    loaderConfig: LoaderConfig;
    checker: Checker;
    cacheIdentifier: any;
    context: string;
}

export interface Compiler {
    inputFileSystem: typeof fs;
    _tsInstances: { [key: string]: Instance };
    options: {
        watch: boolean
    };
}

export interface Loader {
    _compiler: Compiler;
    cacheable: () => void;
    query: string;
    async: () => (err: Error, source?: string, map?: string) => void;
    resourcePath: string;
    resolve: () => void;
    addDependency: (dep: string) => void;
    clearDependencies: () => void;
    emitFile: (fileName: string, text: string) => void;
    emitWarning: (msg: string) => void;
    emitError: (msg: string) => void;
    options: {
        ts?: LoaderConfig
    };
}

export type QueryOptions = LoaderConfig & ts.CompilerOptions;

export function getRootCompiler(compiler) {
    if (compiler.parentCompilation) {
        return getRootCompiler(compiler.parentCompilation.compiler);
    } else {
        return compiler;
    }
}

function resolveInstance(compiler, instanceName) {
     if (!compiler._tsInstances) {
        compiler._tsInstances = {};
    }
    return compiler._tsInstances[instanceName];
}

const COMPILER_ERROR = colors.red(`\n\nTypescript compiler cannot be found, please add it to your package.json file:
    npm install --save-dev typescript
`);

const BABEL_ERROR = colors.red(`\n\nBabel compiler cannot be found, please add it to your package.json file:
    npm install --save-dev babel-core
`);

let id = 0;
export function ensureInstance(
    webpack: Loader,
    query: QueryOptions,
    options: LoaderConfig,
    instanceName: string,
    rootCompiler: any
): Instance {
    let exInstance = resolveInstance(rootCompiler, instanceName);
    if (exInstance) {
        return exInstance;
    }

    const watching = isWatching(rootCompiler);
    const context = process.cwd();

    let compilerInfo = setupTs(query.compiler);
    let { tsImpl } = compilerInfo;

    let { configFilePath, compilerConfig, loaderConfig } = readConfigFile(
        context,
        query,
        options,
        tsImpl
    );

    applyDefaults(
        configFilePath,
        compilerConfig,
        loaderConfig,
        context
    );

    if (!loaderConfig.silent) {
        const sync = watching === WatchMode.Enabled ? ' (in a forked process)' : '';
        console.log(`\n[${instanceName}] Using typescript@${compilerInfo.compilerVersion} from ${compilerInfo.compilerPath} and `
            + `"tsconfig.json" from ${configFilePath}${sync}.\n`);
    }

    let babelImpl = setupBabel(loaderConfig, context);
    let cacheIdentifier = setupCache(
        loaderConfig,
        tsImpl,
        webpack,
        babelImpl,
        context
    );
    let compiler = (<any>webpack._compiler);

    setupWatchRun(compiler, instanceName);
    setupAfterCompile(compiler, instanceName);

    const webpackOptions = _.pick(webpack._compiler.options, 'resolve');
    const checker = new Checker(
        compilerInfo,
        loaderConfig,
        compilerConfig,
        webpackOptions,
        context,
        watching === WatchMode.Enabled
    );

    return rootCompiler._tsInstances[instanceName] = {
        id: ++id,
        babelImpl,
        compiledFiles: {},
        loaderConfig,
        configFilePath,
        compilerConfig,
        checker,
        cacheIdentifier,
        context
    };
}

function findTsImplPackage(inputPath: string) {
    let pkgDir = path.dirname(inputPath);
    if (fs.readdirSync(pkgDir).find((value) => value === 'package.json')) {
        return path.join(pkgDir, 'package.json');
    } else {
        return findTsImplPackage(pkgDir);
    }
}

export function setupTs(compiler: string): CompilerInfo {
    let compilerPath = compiler || 'typescript';

    let tsImpl: typeof ts;
    let tsImplPath: string;
    try {
        tsImplPath = require.resolve(compilerPath);
        tsImpl = require(tsImplPath);
    } catch (e) {
        console.error(e);
        console.error(COMPILER_ERROR);
        process.exit(1);
    }

    const pkgPath = findTsImplPackage(tsImplPath);
    const compilerVersion = require(pkgPath).version;

    let compilerInfo: CompilerInfo = {
        compilerPath,
        compilerVersion,
        tsImpl,
    };

    return compilerInfo;
}

function setupCache(
    loaderConfig: LoaderConfig,
    tsImpl: typeof ts,
    webpack: Loader,
    babelImpl: any,
    context: string
) {
    let cacheIdentifier = null;
    if (loaderConfig.useCache) {
        if (!loaderConfig.cacheDirectory) {
            loaderConfig.cacheDirectory = path.join(context, '.awcache');
        }

        if (!fs.existsSync(loaderConfig.cacheDirectory)) {
            mkdirp.sync(loaderConfig.cacheDirectory);
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

function setupBabel(loaderConfig: LoaderConfig, context: string): any {
    let babelImpl: any;
    if (loaderConfig.useBabel) {
        try {
            let babelPath = loaderConfig.babelCore || path.join(context, 'node_modules', 'babel-core');
            babelImpl = require(babelPath);
        } catch (e) {
            console.error(BABEL_ERROR);
            process.exit(1);
        }
    }

    return babelImpl;
}

function applyDefaults(
    configFilePath: string,
    compilerConfig: TsConfig,
    loaderConfig: LoaderConfig,
    context: string
) {
    _.defaults(compilerConfig.options, {
        sourceMap: true,
        verbose: false,
        declarationDir: compilerConfig.options.outDir,
        skipDefaultLibCheck: true,
        suppressOutputPathCheck: true
    });

    if (loaderConfig.transpileOnly) {
        compilerConfig.options.isolatedModules = true;
    }

    _.defaults(compilerConfig.options, {
        sourceRoot: compilerConfig.options.sourceMap ? context : undefined
    });

    _.defaults(loaderConfig, {
        sourceMap: true,
        verbose: false,
    });

    delete compilerConfig.options.outDir;
    delete compilerConfig.options.outFile;
    delete compilerConfig.options.out;
    delete compilerConfig.options.noEmit;
}

export interface Configs {
    configFilePath: string;
    compilerConfig: TsConfig;
    loaderConfig: LoaderConfig;
}

function absolutize(fileName: string, context: string) {
    if (path.isAbsolute(fileName)) {
        return fileName;
    } else {
        return path.join(context, fileName);
    }
}

export function readConfigFile(
    context: string,
    query: QueryOptions,
    options: LoaderConfig,
    tsImpl: typeof ts
): Configs {
    let configFilePath: string;
    if (query.configFileName  && query.configFileName.match(/\.json$/)) {
        configFilePath = absolutize(query.configFileName, context);
    } else {
        configFilePath = tsImpl.findConfigFile(context, tsImpl.sys.fileExists);
    }

    let existingOptions = tsImpl.convertCompilerOptionsFromJson(query, context, 'atl.query');

    if (!configFilePath || query.configFileContent) {
        return {
            configFilePath: configFilePath || path.join(context, 'tsconfig.json'),
            compilerConfig: tsImpl.parseJsonConfigFileContent(
                query.configFileContent || {},
                tsImpl.sys,
                context,
                _.extend({}, tsImpl.getDefaultCompilerOptions(), existingOptions.options) as ts.CompilerOptions,
                context
            ),
            loaderConfig: query as LoaderConfig
        };
    }

    let jsonConfigFile = tsImpl.readConfigFile(configFilePath, tsImpl.sys.readFile);
    let compilerConfig = tsImpl.parseJsonConfigFileContent(
        jsonConfigFile.config,
        tsImpl.sys,
        path.dirname(configFilePath),
        existingOptions.options,
        configFilePath
    );

    return {
        configFilePath,
        compilerConfig,
        loaderConfig: _.defaults(
            query,
            jsonConfigFile.config.awesomeTypescriptLoaderOptions,
            options
        )
    };
}

let EXTENSIONS = /\.tsx?$|\.jsx?$/;

function setupWatchRun(compiler, instanceName: string) {
    compiler.plugin('watch-run', function (watching, callback) {
        const instance = resolveInstance(watching.compiler, instanceName);
        const checker = instance.checker;
        const watcher = watching.compiler.watchFileSystem.watcher
            || watching.compiler.watchFileSystem.wfs.watcher;

        const mtimes = watcher.mtimes || (watcher.getTimes && watcher.getTimes()) || {};
        const changedFiles = Object.keys(mtimes).map(toUnix);
        const updates = changedFiles
            .filter(file => EXTENSIONS.test(file))
            .map(changedFile => {
                if (fs.existsSync(changedFile)) {
                    checker.updateFile(changedFile, fs.readFileSync(changedFile).toString(), true);
                } else {
                    checker.removeFile(changedFile);
                }
            });

        Promise.all(updates)
            .then(() => callback())
            .catch(callback);
    });
}

enum WatchMode {
    Enabled,
    Disabled,
    Unknown
}

function isWatching(compiler: any): WatchMode {
    const value = compiler && compiler[WatchModeSymbol];
    if (value === true) {
        return WatchMode.Enabled;
    } else if (value === false) {
        return WatchMode.Disabled;
    } else {
        return WatchMode.Unknown;
    }
}

function setupAfterCompile(compiler, instanceName, forkChecker = false) {
    compiler.plugin('after-compile', function (compilation, callback) {
        // Don't add errors for child compilations
        if (compilation.compiler.isChild()) {
            callback();
            return;
        }

        const watchMode = isWatching(compilation.compiler);
        const instance: Instance = resolveInstance(compilation.compiler, instanceName);
        const silent = instance.loaderConfig.silent;
        const asyncErrors = watchMode === WatchMode.Enabled && !silent;

        let emitError = (msg) => {
            if (compilation.bail) {
                console.error('Error in bail mode:', msg);
                process.exit(1);
            }

            if (asyncErrors) {
                console.log(msg, '\n');
            } else {
                compilation.errors.push(new Error(msg));
            }
        };

        instance.compiledFiles = {};
        const files = instance.checker.getFiles()
            .then(({files}) => {
                Array.prototype.push.apply(compilation.fileDependencies, files.map(path.normalize));
            });

        const diag = instance.loaderConfig.transpileOnly
            ? Promise.resolve()
            : instance.checker.getDiagnostics()
                .then(diags => {
                    diags.forEach(diag => emitError(diag.pretty));
                });

        files
            .then(() => {
                if (asyncErrors) {
                    // Don't wait for diags in watch mode
                    return;
                } else {
                    return diag;
                }
            })
            .then(() => callback())
            .catch(callback);
    });
}
