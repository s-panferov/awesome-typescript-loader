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
var Promise = require('bluebird');
var _ = require('lodash');
var deps_1 = require('./deps');
var cache_1 = require('./cache');
var helpers = require('./helpers');
var instance_1 = require('./instance');
let loaderUtils = require('loader-utils');
let pkg = require('../package.json');
let cachePromise = Promise.promisify(cache_1.cache);
function loader(text) {
    compiler.call(undefined, this, text);
}
let externalsInvocation;
function compiler(webpack, text) {
    return __awaiter(this, void 0, Promise, function* () {
        if (webpack.cacheable) {
            webpack.cacheable();
        }
        let options = loaderUtils.parseQuery(webpack.query);
        let instanceName = options.instanceName || 'default';
        let instance = instance_1.ensureInstance(webpack, options, instanceName);
        let state = instance.tsState;
        let callback = webpack.async();
        let fileName = state.normalizePath(webpack.resourcePath);
        let resolver = deps_1.createResolver(webpack._compiler.options.externals, webpack.resolve);
        let depsInjector = {
            add: depFileName => {
                webpack.addDependency(depFileName);
            },
            clear: webpack.clearDependencies.bind(webpack)
        };
        let applyDeps = _.once(() => {
            depsInjector.clear();
            depsInjector.add(fileName);
            state.fileAnalyzer.dependencies.applyCompiledFiles(fileName, depsInjector);
            if (state.options.reEmitDependentFiles) {
                state.fileAnalyzer.dependencies.applyChain(fileName, depsInjector);
            }
        });
        if (options.externals && !instance.externalsInvoked) {
            if (externalsInvocation) {
                yield externalsInvocation;
            } else {
                externalsInvocation = options.externals.map(external => __awaiter(this, void 0, Promise, function* () {
                    yield state.fileAnalyzer.checkDependencies(resolver, external);
                }));
                yield Promise.all(externalsInvocation);
            }
            instance.externalsInvoked = true;
        }
        instance.compiledFiles[fileName] = true;
        let doUpdate = false;
        if (instance.options.useWebpackText) {
            if (state.updateFile(fileName, text, true)) {
                doUpdate = true;
            }
        }
        try {
            let wasChanged = yield state.fileAnalyzer.checkDependencies(resolver, fileName);
            if (wasChanged || doUpdate) {
                state.updateProgram();
            }
            let compiledModule;
            if (instance.options.usePrecompiledFiles) {
                compiledModule = cache_1.findCompiledModule(fileName);
            }
            let transformation = null;
            if (compiledModule) {
                state.fileAnalyzer.dependencies.addCompiledModule(fileName, compiledModule.fileName);
                transformation = {
                    text: compiledModule.text,
                    map: JSON.parse(compiledModule.map)
                };
            } else {
                function transform() {
                    let resultText;
                    let resultSourceMap;
                    let output = state.emit(fileName);
                    let result = helpers.findResultFor(output, fileName);
                    if (result.text === undefined) {
                        throw new Error('No output found for ' + fileName);
                    }
                    resultText = result.text;
                    resultSourceMap = JSON.parse(result.sourceMap);
                    resultSourceMap.sources = [fileName];
                    resultSourceMap.file = fileName;
                    resultSourceMap.sourcesContent = [text];
                    if (instance.options.useBabel) {
                        let defaultOptions = {
                            inputSourceMap: resultSourceMap,
                            filename: fileName,
                            sourceMap: true
                        };
                        let babelResult = instance.babelImpl.transform(resultText, defaultOptions);
                        resultText = babelResult.code;
                        resultSourceMap = babelResult.map;
                    }
                    return {
                        text: resultText,
                        map: resultSourceMap
                    };
                }
                if (instance.options.useCache) {
                    transformation = yield cachePromise({
                        source: text,
                        identifier: instance.cacheIdentifier,
                        directory: instance.options.cacheDirectory,
                        options: webpack.query,
                        transform: transform
                    });
                } else {
                    transformation = transform();
                }
            }
            let resultText = transformation.text;
            let resultSourceMap = transformation.map;
            if (resultSourceMap) {
                resultSourceMap.sources = [fileName];
                resultSourceMap.file = fileName;
                resultSourceMap.sourcesContent = [text];
            }
            try {
                callback(null, resultText, resultSourceMap);
            } catch (e) {
                console.error('Error in bail mode:', e);
                process.exit(1);
            }
        } catch (err) {
            console.log(err);
            callback(err, helpers.codegenErrorReport([err]));
        }
    });
}
class ForkCheckerPlugin {
    apply(compiler) {
        compiler.plugin("watch-run", function (params, callback) {
            compiler._tsFork = true;
            callback();
        });
    }
}
loader.ForkCheckerPlugin = ForkCheckerPlugin;
module.exports = loader;
//# sourceMappingURL=index.js.map