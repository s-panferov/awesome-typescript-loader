/// <reference path="../node_modules/typescript/bin/typescriptServices.d.ts" />
/// <reference path="../typings/tsd.d.ts" />
var Promise = require("bluebird");
var _ = require('lodash');
var loaderUtils = require('loader-utils');
var host = require('./host');
var helpers = require('./helpers');
function ensureInstance(webpack, options, instanceName) {
    if (typeof webpack._compiler._tsInstances === 'undefined') {
        webpack._compiler._tsInstances = {};
    }
    if (typeof webpack._compiler._tsInstances[instanceName] !== "undefined") {
        return webpack._compiler._tsInstances[instanceName];
    }
    var tsFlow = Promise.resolve();
    var tsImpl;
    if (options.compiler) {
        tsImpl = require(options.compiler);
    }
    else {
        tsImpl = require('typescript');
    }
    if (typeof options.emitRequireType === 'undefined') {
        options.emitRequireType = true;
    }
    else {
        options.emitRequireType = (options.emitRequireType == 'true' ? true : false);
    }
    if (options.target) {
        options.target = helpers.parseOptionTarget(options.target, tsImpl);
    }
    var tsState = new host.State(options, webpack._compiler.inputFileSystem, tsImpl);
    var compiler = webpack._compiler;
    compiler.plugin("watch-run", function (watching, callback) {
        var resolver = Promise.promisify(watching.compiler.resolvers.normal.resolve);
        var instance = watching.compiler._tsInstances[instanceName];
        var state = instance.tsState;
        var mtimes = watching.compiler.watchFileSystem.watcher.mtimes;
        var changedFiles = Object.keys(mtimes);
        changedFiles.forEach(function (changedFile) {
            state.validFiles.markFileInvalid(changedFile);
        });
        Promise.all(changedFiles.map(function (changedFile) {
            if (/\.ts$|\.d\.ts$/.test(changedFile)) {
                return state.readFileAndUpdate(changedFile).then(function () {
                    return state.checkDependencies(resolver, changedFile);
                });
            }
            else {
                return Promise.resolve();
            }
        }))
            .then(function (_) { state.updateProgram(); callback(); })
            .catch(function (err) { return console.error(err); });
    });
    compiler.plugin("after-compile", function (compilation, callback) {
        var instance = compilation.compiler._tsInstances[instanceName];
        var state = instance.tsState;
        var diagnostics = state.ts.getPreEmitDiagnostics(state.program);
        var emitError = function (err) {
            compilation.errors.push(new Error(err));
        };
        var phantomImports = [];
        Object.keys(state.files).forEach(function (fileName) {
            if (!instance.compiledFiles[fileName]) {
                phantomImports.push(fileName);
            }
        });
        instance.compiledFiles = {};
        compilation.fileDependencies.push.apply(compilation.fileDependencies, phantomImports);
        compilation.fileDependencies = _.uniq(compilation.fileDependencies);
        var errors = helpers.formatErrors(diagnostics);
        errors.forEach(emitError);
        callback();
    });
    return webpack._compiler._tsInstances[instanceName] = {
        tsFlow: tsFlow,
        tsState: tsState,
        compiledFiles: {}
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
    var resolver = Promise.promisify(webpack.resolve);
    var deps = {
        add: function (depFileName) { webpack.addDependency(depFileName); },
        clear: webpack.clearDependencies.bind(webpack)
    };
    var applyDeps = _.once(function () {
        deps.clear();
        deps.add(fileName);
        state.dependencies.applyChain(fileName, deps);
    });
    instance.tsFlow = instance.tsFlow
        .then(function () { return state.checkDependencies(resolver, fileName); })
        .then(function () {
        instance.compiledFiles[fileName] = true;
        return state.emit(fileName);
    })
        .then(function (output) {
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
        .finally(function () {
        applyDeps();
    })
        .catch(host.ResolutionError, function (err) {
        console.error(err);
        callback(err, helpers.codegenErrorReport([err]));
    })
        .catch(function (err) { console.error(err); callback(err); });
}
module.exports = loader;
//# sourceMappingURL=index.js.map