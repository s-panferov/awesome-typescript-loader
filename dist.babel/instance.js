"use strict";

var __awaiter = undefined && undefined.__awaiter || function (thisArg, _arguments, Promise, generator) {
    return new Promise(function (resolve, reject) {
        generator = generator.call(thisArg, _arguments);
        function cast(value) {
            return value instanceof Promise && value.constructor === Promise ? value : new Promise(function (resolve) {
                resolve(value);
            });
        }
        function onfulfill(value) {
            try {
                step("next", value);
            } catch (e) {
                reject(e);
            }
        }
        function onreject(value) {
            try {
                step("throw", value);
            } catch (e) {
                reject(e);
            }
        }
        function step(verb, value) {
            var result = generator[verb](value);
            result.done ? resolve(result.value) : cast(result.value).then(onfulfill, onreject);
        }
        step("next", void 0);
    });
};
var host_1 = require('./host');
var colors = require('colors');
var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var helpers_1 = require('./helpers');
var deps_1 = require('./deps');
var checker_1 = require('./checker');
let deasync = require('deasync');
let pkg = require('../package.json');
function getRootCompiler(compiler) {
    if (compiler.parentCompilation) {
        return getRootCompiler(compiler.parentCompilation.compiler);
    } else {
        return compiler;
    }
}
function getInstanceStore(compiler) {
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
    npm install --save-dev babel
`);
function ensureInstance(webpack, options, instanceName) {
    ensureInstanceStore(webpack._compiler);
    let exInstance = resolveInstance(webpack._compiler, instanceName);
    if (exInstance) {
        return exInstance;
    }
    let tsFlow = Promise.resolve();
    let compilerName = options.compiler || 'typescript';
    let compilerPath = path.dirname(compilerName);
    if (compilerPath == '.') {
        compilerPath = compilerName;
    }
    let tsImpl;
    try {
        tsImpl = require(compilerName);
    } catch (e) {
        console.error(e);
        console.error(COMPILER_ERROR);
        process.exit(1);
    }
    let libPath = path.join(compilerPath, 'lib', 'lib.d.ts');
    let lib6Path = path.join(compilerPath, 'lib', 'lib.es6.d.ts');
    try {
        require.resolve(libPath);
    } catch (e) {
        libPath = path.join(compilerPath, 'bin', 'lib.d.ts');
        lib6Path = path.join(compilerPath, 'bin', 'lib.es6.d.ts');
    }
    let compilerInfo = {
        compilerName,
        compilerPath,
        tsImpl,
        lib5: helpers_1.loadLib(libPath),
        lib6: helpers_1.loadLib(lib6Path)
    };
    let configFileName = tsImpl.findConfigFile(options.tsconfig || process.cwd());
    let configFile = null;
    let tsConfigFiles = [];
    if (configFileName) {
        configFile = tsImpl.readConfigFile(configFileName, path => fs.readFileSync(path).toString());
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
            options.emitRequireType = options.emitRequireType === 'true';
        }
    }
    if (typeof options.reEmitDependentFiles === 'undefined') {
        options.reEmitDependentFiles = false;
    } else {
        if (typeof options.reEmitDependentFiles === 'string') {
            options.reEmitDependentFiles = options.reEmitDependentFiles === 'true';
        }
    }
    if (typeof options.doTypeCheck === 'undefined') {
        options.doTypeCheck = true;
    } else {
        if (typeof options.doTypeCheck === 'string') {
            options.doTypeCheck = options.doTypeCheck === 'true';
        }
    }
    if (typeof options.forkChecker === 'undefined') {
        options.forkChecker = false;
    } else {
        if (typeof options.forkChecker === 'string') {
            options.forkChecker = options.forkChecker === 'true';
        }
    }
    if (typeof options.useWebpackText === 'undefined') {
        options.useWebpackText = false;
    } else {
        if (typeof options.useWebpackText === 'string') {
            options.useWebpackText = options.useWebpackText === 'true';
        }
    }
    if (typeof options.jsx !== 'undefined') {
        switch (options.jsx) {
            case 'react':
                options.jsx = tsImpl.JsxEmit.React;
                break;
            case 'preserve':
                options.jsx = tsImpl.JsxEmit.Preserve;
                break;
        }
    }
    if (typeof options.externals == 'undefined') {
        options.externals = [];
    }
    if (configFileName) {
        let configFilePath = path.dirname(configFileName);
        options.externals = options.externals.concat(tsConfigFiles.filter(file => /\.d\.ts$/.test(file)).map(file => path.resolve(configFilePath, file)));
    }
    if (options.target) {
        options.target = helpers_1.parseOptionTarget(options.target, tsImpl);
    }
    let babelImpl;
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
            fs.mkdirSync(options.cacheDirectory);
        }
        cacheIdentifier = {
            'typescript': tsImpl.version,
            'awesome-typescript-loader': pkg.version,
            'awesome-typescript-loader-query': webpack.query,
            'babel-core': babelImpl ? babelImpl.version : null
        };
    }
    let forkChecker = options.forkChecker && getRootCompiler(webpack._compiler)._tsFork;
    let syncResolver = deasync(webpack.resolve);
    let tsState = new host_1.State(options, webpack._compiler.inputFileSystem, compilerInfo, syncResolver);
    let compiler = webpack._compiler;
    compiler.plugin('watch-run', function (watching, callback) {
        return __awaiter(this, void 0, Promise, function* () {
            let compiler = watching.compiler;
            let resolver = deps_1.createResolver(compiler.options.externals, watching.compiler.resolvers.normal.resolve);
            let instance = resolveInstance(watching.compiler, instanceName);
            let state = instance.tsState;
            let mtimes = watching.compiler.watchFileSystem.watcher.mtimes;
            let changedFiles = Object.keys(mtimes);
            changedFiles.forEach(changedFile => {
                state.fileAnalyzer.validFiles.markFileInvalid(changedFile);
            });
            try {
                let tasks = changedFiles.map(function (changedFile) {
                    return __awaiter(this, void 0, Promise, function* () {
                        if (/\.ts$|\.d\.ts|\.tsx$/.test(changedFile)) {
                            yield state.readFileAndUpdate(changedFile);
                            yield state.fileAnalyzer.checkDependencies(resolver, changedFile);
                        }
                    });
                });
                yield Promise.all(tasks);
                state.updateProgram();
                callback();
            } catch (err) {
                console.error(err);
                callback();
            }
        });
    });
    if (options.doTypeCheck) {
        compiler.plugin('after-compile', function (compilation, callback) {
            let instance = resolveInstance(compilation.compiler, instanceName);
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
                let emitError = err => {
                    if (compilation.bail) {
                        console.error('Error in bail mode:', err);
                        process.exit(1);
                    }
                    compilation.errors.push(new Error(err));
                };
                let errors = helpers_1.formatErrors(instanceName, diagnostics);
                errors.forEach(emitError);
            }
            let phantomImports = [];
            state.allFileNames().forEach(fileName => {
                if (!instance.compiledFiles[fileName]) {
                    phantomImports.push(fileName);
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
        checker: forkChecker ? checker_1.createChecker(compilerInfo, options) : null,
        cacheIdentifier
    };
}
exports.ensureInstance = ensureInstance;
//# sourceMappingURL=instance.js.map