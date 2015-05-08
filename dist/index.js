/// <reference path="../node_modules/typescript/bin/typescriptServices.d.ts" />
/// <reference path="../typings/tsd.d.ts" />
var Promise = require("bluebird");
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
    var showRecompileReason = !!options.showRecompileReason;
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
    webpack._compiler.plugin("after-compile", function (compilation, callback) {
        var state = compilation.compiler._tsInstances[instanceName].tsState;
        var diagnostics = state.ts.getPreEmitDiagnostics(state.program);
        var emitError = function (err) {
            compilation.errors.push(new Error(err));
        };
        var errors = helpers.formatErrors(diagnostics);
        errors.forEach(emitError);
        callback();
    });
    return webpack._compiler._tsInstances[instanceName] = {
        tsFlow: tsFlow,
        tsState: tsState,
        showRecompileReason: showRecompileReason,
        lastTimes: {},
        lastDeps: null
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
    var currentTimes = webpack._compiler.watchFileSystem.watcher.mtimes;
    var changedFiles = Object.keys(currentTimes);
    instance.tsFlow = instance.tsFlow
        .then(function () {
        var depsFlow = Promise.resolve();
        if (currentTimes !== instance.lastTimes) {
            if (instance.showRecompileReason) {
                instance.lastDeps = state.dependencies.clone();
            }
            for (var changedFile in currentTimes) {
                state.validFiles.markFileInvalid(changedFile);
            }
            depsFlow = Promise.all(Object.keys(currentTimes).map(function (changedFile) {
                if (/\.d\.ts$/.test(changedFile)) {
                    return state.readFileAndUpdate(changedFile).then(function () {
                        return state.checkDependencies(resolver, changedFile);
                    });
                }
                else {
                    return Promise.resolve();
                }
            }))
                .then(function (_) { return state.resetProgram(); });
        }
        instance.lastTimes = currentTimes;
        if (instance.showRecompileReason && changedFiles.length) {
            console.log("Recompile reason:\n    " + fileName + "\n        " +
                instance.lastDeps.recompileReason(fileName, changedFiles).join("\n        "));
        }
        return depsFlow;
    })
        .then(function () { return state.updateFile(fileName, text, false); })
        .then(function () { return state.checkDependencies(resolver, fileName); })
        .then(function () { return state.emit(fileName); })
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
        callback(null, result.text, sourceMap);
    })
        .finally(function () {
        deps.clear();
        deps.add(fileName);
        state.dependencies.applyChain(fileName, deps);
    })
        .catch(host.ResolutionError, function (err) {
        console.error(err);
        callback(err, helpers.codegenErrorReport([err]));
    })
        .catch(callback);
}
module.exports = loader;
//# sourceMappingURL=index.js.map