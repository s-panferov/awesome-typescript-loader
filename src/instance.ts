import { ICompilerOptions, State } from './host';
import * as fs from 'fs';
import * as path from 'path';
import * as _ from 'lodash';
import * as tsconfig from 'tsconfig';
import { loadLib, formatError } from './helpers';
import { ICompilerInfo } from './host';
import { createResolver } from './deps';
import { createChecker } from './checker';
import { rawToTsCompilerOptions, parseContent, tsconfigSuggestions } from './tsconfig-utils';
import makeResolver from './resolver';

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
    tsFlow: Promise<any>;
    tsState: State;
    babelImpl?: any;
    compiledFiles: {[key:string]: boolean};
    options: ICompilerOptions;
    externalsInvoked: boolean;
    checker: any;
    cacheIdentifier: any;
    plugins: LoaderPluginDef[];
    initedPlugins: LoaderPlugin[];
    externalsInvocation: Promise<any>;
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
export function ensureInstance(webpack: IWebPack, options: ICompilerOptions, instanceName: string): ICompilerInstance {
    ensureInstanceStore(webpack._compiler);

    let exInstance = resolveInstance(webpack._compiler, instanceName);

    if (exInstance) {
        return exInstance;
    }

    let tsFlow = Promise.resolve();
    let compilerPath = options.compiler || 'typescript';

    let tsImpl: typeof ts;
    try {
        tsImpl = require(compilerPath);
    } catch (e) {
        console.error(e);
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
        compilerPath,
        tsImpl,
        lib5: loadLib(libPath),
        lib6: loadLib(lib6Path)
    };

    _.defaults(options, {
        resolveGlobs: true
    });

    let configFilePath: string;
    let configFile: tsconfig.TSConfig;
    if (options.tsconfig && options.tsconfig.match(/\.json$/)) {
        configFilePath = options.tsconfig;
    } else {
        configFilePath = tsconfig.resolveSync(options.tsconfig || process.cwd());
    }

    if (configFilePath) {
        let content = fs.readFileSync(configFilePath).toString();
        configFile = parseContent(content, configFilePath);

        if (options.resolveGlobs) {
            tsconfigSuggestions(configFile);
            configFile = tsconfig.readFileSync(configFilePath, { filterDefinitions: true });
        }
    }

    let tsFiles: string[] = [];
    if (configFile) {
        if (configFile.compilerOptions) {
            _.defaults(options, (configFile as any).awesomeTypescriptLoaderOptions);
            _.defaults(options, configFile.compilerOptions);
            options.exclude = configFile.exclude || [];
            tsFiles = configFile.files;
        }
    }

    let projDir = configFilePath
        ? path.dirname(configFilePath)
        : process.cwd();

    options = rawToTsCompilerOptions(options, projDir, tsImpl);

    _.defaults(options, {
        externals: [],
        doTypeCheck: true,
        sourceMap: true,
        verbose: false,
        noLib: false,
        skipDefaultLibCheck: true,
        suppressOutputPathCheck: true,
        sourceRoot: options.sourceMap ? process.cwd() : undefined
    });

    options = _.omit(options, 'outDir', 'files', 'out', 'noEmit') as any;
    options.externals.push.apply(options.externals, tsFiles);

    let babelImpl: any;
    if (options.useBabel) {
        try {
            let babelPath = options.babelCore || path.join(process.cwd(), 'node_modules', 'babel-core');
            babelImpl = require(babelPath);
        } catch (e) {
            console.error(BABEL_ERROR);
            process.exit(1);
        }
    }

    let cacheIdentifier = null;
    if (options.useCache) {
        if (!options.cacheDirectory) {
            options.cacheDirectory = path.join(process.cwd(), '.awcache');
        }

        if (!fs.existsSync(options.cacheDirectory)) {
            fs.mkdirSync(options.cacheDirectory);
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

    let forkChecker = options.forkChecker && getRootCompiler(webpack._compiler)._tsFork;
    let resolver = makeResolver(webpack._compiler.options);
    let syncResolver = resolver.resolveSync.bind(resolver);

    let tsState = new State(options, webpack._compiler.inputFileSystem, compilerInfo, syncResolver);
    let compiler = (<any>webpack._compiler);

    setupWatchRun(compiler, instanceName);

    if (options.doTypeCheck) {
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
        tsFlow,
        tsState,
        babelImpl,
        compiledFiles: {},
        options,
        externalsInvoked: false,
        checker: forkChecker
            ? createChecker(compilerInfo, options, webpackOptions, plugins)
            : null,
        cacheIdentifier,
        plugins,
        initedPlugins,
        externalsInvocation: null,
        shouldUpdateProgram: true
    };
}

let EXTENSIONS = /\.tsx?$|\.jsx?$/;

function setupWatchRun(compiler, instanceName: string) {
    compiler.plugin('watch-run', async function (watching, callback) {
        let compiler: ICompiler = watching.compiler;
        let instance = resolveInstance(watching.compiler, instanceName);
        let state = instance.tsState;
        let resolver = createResolver(
            compiler.options.externals,
            state.options.exclude || [],
            watching.compiler.resolvers.normal.resolve,
            watching.compiler.resolvers.normal
        );
        let mtimes = watching.compiler.watchFileSystem.watcher.mtimes;
        let changedFiles = Object.keys(mtimes);

        changedFiles.forEach((changedFile) => {
            state.fileAnalyzer.validFiles.markFileInvalid(changedFile);
        });

        try {
            let tasks = changedFiles.map(async function(changedFile) {
                if (EXTENSIONS.test(changedFile)) {
                    if (state.hasFile(changedFile)) {
                        await state.readFileAndUpdate(changedFile);
                        await state.fileAnalyzer.checkDependenciesLocked(resolver, changedFile);
                    }
                }
            });

            await Promise.all(tasks);
            if (!state.options.forkChecker) {
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
                resolutionCache: state.host.moduleResolutionHost.resolutionCache
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

            let { options: { ignoreDiagnostics } } = instance;
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

        if (instance.options.declaration) {
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
