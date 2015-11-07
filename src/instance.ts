import { ICompilerOptions, State } from './host';
import * as colors from 'colors';
import * as fs from 'fs';
import * as path from 'path';
import * as _ from 'lodash';
import { loadLib, parseOptionTarget, formatErrors } from './helpers';
import { ICompilerInfo } from './host';
import { createResolver } from './deps';
import { createChecker } from './checker';

let deasync = require('deasync');

let pkg = require('../package.json');

export interface ICompilerInstance {
    tsFlow: Promise<any>;
    tsState: State;
    babelImpl?: any;
    compiledFiles: {[key:string]: boolean};
    options: ICompilerOptions;
    externalsInvoked: boolean;
    checker: any;
    cacheIdentifier: any;
}

interface ICompiler {
    inputFileSystem: typeof fs;
    _tsInstances: {[key:string]: ICompilerInstance};
    _tsFork: boolean;
    options: {
        externals: {
            [ key: string ]: string
        }
    }
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

const COMPILER_ERROR = colors.red(`\n\nTypescript compiler cannot be found, please add it to your package.json file:
    npm install --save-dev typescript
`);

const BABEL_ERROR = colors.red(`\n\nBabel compiler cannot be found, please add it to your package.json file:
    npm install --save-dev babel
`);

/**
 * Creates compiler instance
 */
export function ensureInstance(webpack: IWebPack, options: ICompilerOptions, instanceName: string): ICompilerInstance {
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
        console.error(e)
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

    let tsConfigFiles = [];
    if (configFileName) {
        configFile = tsImpl.readConfigFile(configFileName, (path) => fs.readFileSync(path).toString());
        if (configFile.error) {
            throw configFile.error;
        }
        if (configFile.config) {
            _.extend(options, configFile.config.compilerOptions);
            _.extend(options, configFile.config.awesomeTypescriptLoaderOptions);
            tsConfigFiles = configFile.config.files || tsConfigFiles;
        }
    }
    if (typeof options.moduleResolution === "string") {
       var moduleTypes = {
           "node": tsImpl.ModuleResolutionKind.NodeJs,
           "classic": tsImpl.ModuleResolutionKind.Classic
       };
        options.moduleResolution = moduleTypes[options.moduleResolution];

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
            case 'react': options.jsx = tsImpl.JsxEmit.React; break;
            case 'preserve': options.jsx = tsImpl.JsxEmit.Preserve; break;
        }
    }

    if (typeof options.externals == 'undefined') {
        options.externals = [];
    }

    if (configFileName) {
        let configFilePath = path.dirname(configFileName);
        options.externals = options.externals.concat(
            tsConfigFiles
                .filter(file => /\.d\.ts$/.test(file))
                .map(file => path.resolve(configFilePath, file))
        )
    }

    if (options.target) {
        options.target = parseOptionTarget(<any>options.target, tsImpl);
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

    let forkChecker = options.forkChecker && getRootCompiler(webpack._compiler)._tsFork;
    let syncResolver = deasync(webpack.resolve);

    let tsState = new State(options, webpack._compiler.inputFileSystem, compilerInfo, syncResolver);
    let compiler = (<any>webpack._compiler);

    compiler.plugin('watch-run', async function (watching, callback) {
        let compiler: ICompiler = watching.compiler;
        let resolver = createResolver(compiler.options.externals, watching.compiler.resolvers.normal.resolve);
        let instance: ICompilerInstance = resolveInstance(watching.compiler, instanceName);
        let state = instance.tsState;
        let mtimes = watching.compiler.watchFileSystem.watcher.mtimes;
        let changedFiles = Object.keys(mtimes);

        changedFiles.forEach((changedFile) => {
            state.fileAnalyzer.validFiles.markFileInvalid(changedFile);
        });
        
        try {
            let tasks = changedFiles.map(async function(changedFile) {
                if (/\.ts$|\.d\.ts|\.tsx$/.test(changedFile)) {
                    await state.readFileAndUpdate(changedFile);
                    await state.fileAnalyzer.checkDependencies(resolver, changedFile);
                }
            });
            
            await Promise.all(tasks);
            state.updateProgram(); 
            callback();
        } catch (err) {
            console.error(err);
            callback();
        }
    });

    if (options.doTypeCheck) {
        compiler.plugin('after-compile', function(compilation, callback) {
            let instance: ICompilerInstance = resolveInstance(compilation.compiler, instanceName);
            let state = instance.tsState;

            if (forkChecker) {
                let payload = {
                    files: state.allFiles(),
                    resolutionCache: state.host.moduleResolutionHost.resolutionCache
                };
                
                instance.checker.send({
                    messageType: 'compile',
                    payload
                });
            } else {
                let diagnostics = state.ts.getPreEmitDiagnostics(state.program);
                let emitError = (err) => {
                    if (compilation.bail) {
                        console.error('Error in bail mode:', err);
                        process.exit(1);
                    }
                    compilation.errors.push(new Error(err))
                };

                let errors = formatErrors(instanceName, diagnostics);
                errors.forEach(emitError);
            }

            let phantomImports = [];
            state.allFileNames().forEach((fileName) => {
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
        checker: forkChecker
            ? createChecker(compilerInfo, options)
            : null,
        cacheIdentifier
    }
}