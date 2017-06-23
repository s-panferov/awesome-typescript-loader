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

    times: Dict<number>;
    watchedFiles?: Set<string>;
    startTime?: number;
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
    context: string;
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

function resolveInstance(compiler, instanceName): Instance {
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
    const context = options.context || process.cwd();

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
        compilerConfig,
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
        context,
        times: {}
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
    compilerConfig: TsConfig,
    loaderConfig: LoaderConfig,
    tsImpl: typeof ts,
    webpack: Loader,
    babelImpl: any,
    context: string
) {
    if (loaderConfig.useCache) {
        if (!loaderConfig.cacheDirectory) {
            loaderConfig.cacheDirectory = path.join(context, '.awcache');
        }

        if (!fs.existsSync(loaderConfig.cacheDirectory)) {
            mkdirp.sync(loaderConfig.cacheDirectory);
        }

        return {
            typescript: tsImpl.version,
            'awesome-typescript-loader': pkg.version,
            'babel-core': babelImpl ? babelImpl.version : null,
            babelPkg: pkg.babel,
            // TODO: babelrc.json/babelrc.js
            compilerConfig,
            env: process.env.BABEL_ENV || process.env.NODE_ENV || 'development'
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
            console.error(BABEL_ERROR, e);
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
    const def: any = {
        sourceMap: true,
        verbose: false,
        skipDefaultLibCheck: true,
        suppressOutputPathCheck: true
    };

    if (compilerConfig.options.outDir && compilerConfig.options.declaration) {
        def.declarationDir = compilerConfig.options.outDir;
    }

    _.defaults(compilerConfig.options, def);

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
export type Dict<T> = {[key: string]: T};

const filterMtimes = (mtimes: any) => {
    const res = {};
    Object.keys(mtimes).forEach(fileName => {
        if (!!EXTENSIONS.test(fileName)) {
            res[fileName] = mtimes[fileName];
        }
    });

    return res;
};

function setupWatchRun(compiler, instanceName: string) {
    compiler.plugin('watch-run', function (watching, callback) {
        const instance = resolveInstance(watching.compiler, instanceName);
        const checker = instance.checker;
        const watcher = watching.compiler.watchFileSystem.watcher
            || watching.compiler.watchFileSystem.wfs.watcher;

        const startTime = instance.startTime || watching.startTime;
        const times = filterMtimes(watcher.getTimes());
        const lastCompiled = instance.compiledFiles;

        instance.compiledFiles = {};
        instance.startTime = startTime;

        const set = new Set(Object.keys(times).map(toUnix));
        if (instance.watchedFiles || lastCompiled) {
            const removedFiles = [];
            const checkFiles = (instance.watchedFiles || Object.keys(lastCompiled)) as any;
            checkFiles.forEach(file => {
                if (!set.has(file)) {
                    removedFiles.push(file);
                }
            });

            removedFiles.forEach(file => {
                checker.removeFile(file);
            });
        }
        instance.watchedFiles = set;

        const instanceTimes = instance.times;
        instance.times = Object.assign({}, times) as any;

        const updates = Object.keys(times)
            .filter(fileName => {
                const updated = times[fileName] > (instanceTimes[fileName] || startTime);
                return updated;
            })
            .map(fileName => {
                const unixFileName = toUnix(fileName);
                if (fs.existsSync(unixFileName)) {
                    checker.updateFile(unixFileName, fs.readFileSync(unixFileName).toString(), true);
                } else {
                    checker.removeFile(unixFileName);
                }
            });

        Promise.all(updates)
            .then(() => {
                callback();
            })
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

        const files = instance.checker.getFiles()
            .then(({files}) => {
                const normalized = files.map(file => {
                    const rpath = path.normalize(file);
                    instance.compiledFiles[file] = true;
                    return rpath;
                });
                Array.prototype.push.apply(compilation.fileDependencies, normalized);
            });

        const timeStart = +(new Date());
        const diag = instance.loaderConfig.transpileOnly
            ? Promise.resolve()
            : instance.checker.getDiagnostics()
                .then(diags => {
                    if (!silent) {
                        if (diags.length) {
                            console.error(colors.red(`\n[${instanceName}] Checking finished with ${diags.length} errors`));
                        } else {
                            let timeEnd = +new Date();
                            console.log(
                                colors.green(`\n[${instanceName}] Ok, ${(timeEnd - timeStart) / 1000} sec.`)
                            );
                        }
                    }

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
