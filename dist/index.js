/// <reference path="../node_modules/typescript/bin/typescriptServices.d.ts" />
/// <reference path="../typings/tsd.d.ts" />
var Promise = require("bluebird");
var loaderUtils = require('loader-utils');
var host = require('./host');
var helpers = require('./helpers');
var lastTimes = {};
var lastDeps;
var showRecompileReason = false;
function ensureInit(webpack) {
    if (typeof webpack._compiler._tsState !== "undefined") {
        return;
    }
    var options = loaderUtils.parseQuery(webpack.query);
    var tsImpl;
    if (options.compiler) {
        tsImpl = require(options.compiler);
    }
    else {
        tsImpl = require('typescript');
    }
    showRecompileReason = !!options.showRecompileReason;
    if (options.target) {
        options.target = helpers.parseOptionTarget(options.target, tsImpl);
    }
    webpack._compiler._tsState = new host.State(options, webpack._compiler.inputFileSystem, tsImpl);
}
function loader(text) {
    compiler.call(undefined, this, text);
}
function compiler(webpack, text) {
    if (webpack.cacheable) {
        webpack.cacheable();
    }
    ensureInit.call(undefined, webpack);
    var callback = webpack.async();
    var fileName = webpack.resourcePath;
    var resolver = Promise.promisify(webpack.resolve);
    var deps = {
        add: function (depFileName) { webpack.addDependency(depFileName); },
        clear: webpack.clearDependencies.bind(webpack)
    };
    var state = webpack._compiler._tsState;
    var currentTimes = webpack._compiler.watchFileSystem.watcher.mtimes;
    var changedFiles = Object.keys(currentTimes);
    var flow = Promise.resolve();
    if (currentTimes !== lastTimes) {
        if (showRecompileReason) {
            lastDeps = state.dependencies.clone();
        }
        for (var changedFile in currentTimes) {
            state.validFiles.markFileInvalid(changedFile);
        }
        flow = Promise.all(Object.keys(currentTimes).map(function (changedFile) {
            if (/\.ts$|\.d\.ts$/.test(changedFile)) {
                return state.readFileAndUpdate(changedFile).then(function () {
                    return state.checkDependencies(resolver, changedFile);
                });
            }
            else {
                return Promise.resolve();
            }
        })).then(function (_) { });
        flow = flow.then(function () {
            state.resetProgram();
        });
    }
    lastTimes = currentTimes;
    if (showRecompileReason && changedFiles.length) {
        console.log("Recompile reason:\n    " + fileName + "\n        " +
            lastDeps.recompileReason(fileName, changedFiles).join("\n        "));
    }
    flow.then(function () { return state.checkDependencies(resolver, fileName); })
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
        callback(err, helpers.codegenErrorReport([err]));
    })
        .catch(host.TypeScriptCompilationError, function (err) {
        var errors = helpers.formatErrors(err.diagnostics);
        errors.forEach(webpack.emitError, webpack);
        for (var depDiag in err.depsDiagnostics) {
            var errors = helpers.formatErrors(err.depsDiagnostics[depDiag]);
            errors.forEach(webpack.emitError, webpack);
        }
        callback(null, helpers.codegenErrorReport(errors));
    })
        .catch(callback);
}
module.exports = loader;
//# sourceMappingURL=index.js.map