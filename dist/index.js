/// <reference path='../node_modules/typescript/lib/typescriptServices.d.ts' />
/// <reference path='../typings/tsd.d.ts' />
var Promise = require('bluebird');
var path = require('path');
var _ = require('lodash');
var childProcess = require('child_process');
var colors = require('colors');
var host_1 = require('./host');
var deps_1 = require('./deps');
var helpers = require('./helpers');
var helpers_1 = require('./helpers');
var loaderUtils = require('loader-utils');
function getRootCompiler(compiler) {
    if (compiler.parentCompilation) {
        return getRootCompiler(compiler.parentCompilation.compiler);
    }
    else {
        return compiler;
    }
}
function getInstanceStore(compiler) {
    var store = getRootCompiler(compiler)._tsInstances;
    if (store) {
        return store;
    }
    else {
        throw new Error('Can not resolve instance store');
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
function createResolver(compiler, webpackResolver) {
    var externals = compiler.options.externals;
    var resolver = Promise.promisify(webpackResolver);
    function resolve(base, dep) {
        if (externals && externals.hasOwnProperty(dep)) {
            return Promise.resolve('%%ignore');
        }
        else {
            return resolver(base, dep);
        }
    }
    return resolve;
}
function createChecker(compilerInfo, compilerOptions) {
    var checker = childProcess.fork(path.join(__dirname, 'checker.js'));
    checker.send({
        messageType: 'init',
        payload: {
            compilerInfo: _.omit(compilerInfo, 'tsImpl'),
            compilerOptions: compilerOptions
        }
    }, null);
    return checker;
}
var COMPILER_ERROR = colors.red("\n\nTypescript compiler cannot be found, please add it to your package.json file:\n    npm install --save-dev typescript\n");
function ensureInstance(webpack, options, instanceName) {
    ensureInstanceStore(webpack._compiler);
    var exInstance = resolveInstance(webpack._compiler, instanceName);
    if (exInstance) {
        return exInstance;
    }
    var tsFlow = Promise.resolve();
    var compilerName = options.compiler || 'typescript';
    var compilerPath = path.dirname(compilerName);
    if (compilerPath == '.') {
        compilerPath = compilerName;
    }
    var tsImpl;
    try {
        tsImpl = require(compilerName);
    }
    catch (e) {
        console.error(COMPILER_ERROR);
        process.exit(1);
    }
    var libPath = path.join(compilerPath, 'lib', 'lib.d.ts');
    var lib6Path = path.join(compilerPath, 'lib', 'lib.es6.d.ts');
    try {
        require.resolve(libPath);
    }
    catch (e) {
        libPath = path.join(compilerPath, 'bin', 'lib.d.ts');
        lib6Path = path.join(compilerPath, 'bin', 'lib.es6.d.ts');
    }
    var compilerInfo = {
        compilerName: compilerName,
        compilerPath: compilerPath,
        tsImpl: tsImpl,
        lib5: helpers_1.loadLib(libPath),
        lib6: helpers_1.loadLib(lib6Path)
    };
    var configFileName = tsImpl.findConfigFile(options.tsconfig || process.cwd());
    var configFile = null;
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
    }
    else {
        if (typeof options.emitRequireType === 'string') {
            options.emitRequireType = options.emitRequireType === 'true';
        }
    }
    if (typeof options.reEmitDependentFiles === 'undefined') {
        options.reEmitDependentFiles = false;
    }
    else {
        if (typeof options.reEmitDependentFiles === 'string') {
            options.reEmitDependentFiles = options.reEmitDependentFiles === 'true';
        }
    }
    if (typeof options.doTypeCheck === 'undefined') {
        options.doTypeCheck = true;
    }
    else {
        if (typeof options.doTypeCheck === 'string') {
            options.doTypeCheck = options.doTypeCheck === 'true';
        }
    }
    if (typeof options.forkChecker === 'undefined') {
        options.forkChecker = false;
    }
    else {
        if (typeof options.forkChecker === 'string') {
            options.forkChecker = options.forkChecker === 'true';
        }
    }
    if (typeof options.useWebpackText === 'undefined') {
        options.useWebpackText = false;
    }
    else {
        if (typeof options.useWebpackText === 'string') {
            options.useWebpackText = options.useWebpackText === 'true';
        }
    }
    if (typeof options.jsx !== 'undefined') {
        switch (options.jsx) {
            case 'react':
                options.jsx = 2;
                break;
            case 'preserve':
                options.jsx = 1;
                break;
        }
    }
    if (typeof options.rewriteImports == 'undefined') {
        options.rewriteImports = [];
    }
    if (typeof options.externals == 'undefined') {
        options.externals = [];
    }
    if (options.target) {
        options.target = helpers.parseOptionTarget(options.target, tsImpl);
    }
    var tsState = new host_1.State(options, webpack._compiler.inputFileSystem, compilerInfo);
    var compiler = webpack._compiler;
    compiler.plugin('watch-run', function (watching, callback) {
        var resolver = createResolver(watching.compiler, watching.compiler.resolvers.normal.resolve);
        var instance = resolveInstance(watching.compiler, instanceName);
        var state = instance.tsState;
        var mtimes = watching.compiler.watchFileSystem.watcher.mtimes;
        var changedFiles = Object.keys(mtimes);
        changedFiles.forEach(function (changedFile) {
            state.fileAnalyzer.validFiles.markFileInvalid(changedFile);
        });
        Promise.all(changedFiles.map(function (changedFile) {
            if (/\.ts$|\.d\.ts|\.tsx$/.test(changedFile)) {
                return state.readFileAndUpdate(changedFile).then(function () {
                    return state.fileAnalyzer.checkDependencies(resolver, changedFile);
                });
            }
            else {
                return Promise.resolve();
            }
        }))
            .then(function (_) { state.updateProgram(); callback(); })
            .catch(deps_1.ResolutionError, function (err) {
            console.error(err.message);
            callback();
        })
            .catch(function (err) { console.log(err); callback(); });
    });
    if (options.doTypeCheck) {
        compiler.plugin('after-compile', function (compilation, callback) {
            var instance = resolveInstance(compilation.compiler, instanceName);
            var state = instance.tsState;
            if (options.forkChecker) {
                var payload = {
                    files: state.files
                };
                console.time('\nSending files to the checker');
                instance.checker.send({
                    messageType: 'compile',
                    payload: payload
                });
                console.timeEnd('\nSending files to the checker');
            }
            else {
                var diagnostics = state.ts.getPreEmitDiagnostics(state.program);
                var emitError = function (err) {
                    if (compilation.bail) {
                        console.error('Error in bail mode:', err);
                        process.exit(1);
                    }
                    compilation.errors.push(new Error(err));
                };
                var errors = helpers.formatErrors(diagnostics);
                errors.forEach(emitError);
            }
            var phantomImports = [];
            Object.keys(state.files).forEach(function (fileName) {
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
        tsFlow: tsFlow,
        tsState: tsState,
        compiledFiles: {},
        options: options,
        externalsInvoked: false,
        checker: options.forkChecker
            ? createChecker(compilerInfo, options)
            : null
    };
}
function loader(text) {
    compiler.call(undefined, this, text);
}
function compiler(webpack, text) {
    if (webpack.cacheable) {
        webpack.cacheable();
    }
    var options = loaderUtils.parseQuery(webpack.query);
    var instanceName = options.instanceName || 'default';
    var instance = ensureInstance(webpack, options, instanceName);
    var state = instance.tsState;
    var callback = webpack.async();
    var fileName = webpack.resourcePath;
    var resolver = createResolver(webpack._compiler, webpack.resolve);
    var depsInjector = {
        add: function (depFileName) { webpack.addDependency(depFileName); },
        clear: webpack.clearDependencies.bind(webpack)
    };
    var applyDeps = _.once(function () {
        depsInjector.clear();
        depsInjector.add(fileName);
        if (state.options.reEmitDependentFiles) {
            state.fileAnalyzer.dependencies.applyChain(fileName, depsInjector);
        }
    });
    if (options.externals && !instance.externalsInvoked) {
        instance.externalsInvoked = true;
        instance.tsFlow = instance.tsFlow.then(Promise.all(options.externals.map(function (external) {
            return state.fileAnalyzer.checkDependencies(resolver, external);
        })));
    }
    instance.tsFlow = instance.tsFlow
        .then(function () {
        instance.compiledFiles[fileName] = true;
        var doUpdate = false;
        if (instance.options.useWebpackText) {
            if (state.updateFile(fileName, text, true)) {
                doUpdate = true;
            }
        }
        return state.fileAnalyzer.checkDependencies(resolver, fileName).then(function (wasChanged) {
            if (doUpdate || wasChanged) {
                state.updateProgram();
            }
        });
    })
        .then(function () {
        return state.emit(fileName);
    })
        .then(function (output) {
        var result = helpers.findResultFor(output, fileName);
        if (result.text === undefined) {
            throw new Error('no output found for ' + fileName);
        }
        var sourceMap = JSON.parse(result.sourceMap);
        sourceMap.sources = [fileName];
        sourceMap.file = fileName;
        sourceMap.sourcesContent = [text];
        applyDeps();
        try {
            callback(null, result.text, sourceMap);
        }
        catch (e) {
            console.error('Error in bail mode:', e);
            process.exit(1);
        }
    })
        .finally(function () {
        applyDeps();
    })
        .catch(deps_1.ResolutionError, function (err) {
        callback(err, helpers.codegenErrorReport([err]));
    })
        .catch(function (err) { callback(err); });
}
module.exports = loader;
//# sourceMappingURL=index.js.map