/// <reference path='../node_modules/typescript/lib/typescriptServices.d.ts' />
/// <reference path="./defines.d.ts"/>
/// <reference path='../typings/tsd.d.ts' />

import * as _ from 'lodash';
import * as path from 'path';

import { ICompilerOptions } from './host';
import { createResolver } from './deps';
import { findCompiledModule, cache } from './cache';
import * as helpers from './helpers';
import { IWebPack, ensureInstance } from './instance';

let promisify = require('es6-promisify');
let loaderUtils = require('loader-utils');
let cachePromise: any = promisify(cache);

async function loader(text) {
    try {
        await compiler.call(undefined, this, text);
    } catch(e) {
        console.error(e, e.stack);
        throw e;
    }
}

async function compiler(webpack: IWebPack, text: string): Promise<void> {
    if (webpack.cacheable) {
        webpack.cacheable();
    }

    let options = <ICompilerOptions>loaderUtils.parseQuery(webpack.query);
    let instanceName = options.instanceName || 'default';

    let instance = ensureInstance(webpack, options, instanceName);
    let state = instance.tsState;

    let callback = webpack.async();
    let fileName = state.normalizePath(webpack.resourcePath);

    let resolver = createResolver(
        webpack._compiler.options.externals,
        state.options.exclude || [],
        webpack.resolve,
        webpack
    );

    let depsInjector = {
        add: (depFileName) => webpack.addDependency(depFileName),
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

    if (instance.options.externals && !instance.externalsInvoked) {
        if (instance.externalsInvocation) {
            await instance.externalsInvocation;
        } else {
            let promises = instance.options.externals.map(async (external) => {
                await state.fileAnalyzer.checkDependencies(resolver, external);
            });

            instance.externalsInvocation = Promise.all(promises).then(() => {
                instance.externalsInvoked = true;
            });

            await instance.externalsInvocation;
        }
    }

    instance.compiledFiles[fileName] = true;
    let doUpdate = false;
    if (instance.options.useWebpackText) {
        if (state.updateFile(fileName, text, true)) {
            doUpdate = true;
        }
    }

    try {
        let wasChanged = await state.fileAnalyzer.checkDependenciesLocked(resolver, fileName);
        if (wasChanged || doUpdate) {
            instance.shouldUpdateProgram = true;
        }

        let compiledModule;
        if (instance.options.usePrecompiledFiles) {
            compiledModule = findCompiledModule(fileName);
        }

        let transformation = null;

        if (compiledModule) {
            state.fileAnalyzer.dependencies.addCompiledModule(fileName, compiledModule.fileName);
            transformation = {
                text: compiledModule.text,
                map: compiledModule.map
                    ? JSON.parse(compiledModule.map)
                    : null
            };
        } else {

            function transform() {
                let resultText;
                let resultSourceMap = null;

                if (state.options.declaration) {
                    // can't use fastEmit with declaration generation

                    let output = state.emit(fileName);
                    let result = helpers.findResultFor(output, fileName);

                    if (result.text === undefined) {
                        throw new Error('No output found for ' + fileName);
                    }

                    if (result.declaration) {
                        webpack.emitFile(
                            path.relative(process.cwd(), result.declaration.sourceName),
                            result.declaration.text
                        );
                    }

                    resultText = result.text;
                    resultSourceMap = result.sourceMap;
                } else {
                    // Use super-fast emit

                    let result = state.fastEmit(fileName);
                    resultText = result.text;
                    resultSourceMap = result.sourceMap;
                }

                let sourceFileName = fileName.replace(process.cwd() + '/', '');
                if (resultSourceMap) {
                    resultSourceMap = JSON.parse(resultSourceMap);
                    resultSourceMap.sources = [ sourceFileName ];
                    resultSourceMap.file = sourceFileName;
                    resultSourceMap.sourcesContent = [ text ];

                    resultText = resultText.replace(/^\/\/# sourceMappingURL=[^\r\n]*/gm, '');
                }

                if (instance.options.useBabel) {
                    let defaultOptions = {
                        inputSourceMap: resultSourceMap,
                        sourceRoot: process.cwd(),
                        filename: fileName,
                        sourceMap: true
                    };

                    let babelOptions = Object.assign({}, defaultOptions, options.babelOptions);
                    let babelResult = instance.babelImpl.transform(resultText, babelOptions);

                    resultText = babelResult.code;
                    resultSourceMap = babelResult.map;
                }

                return {
                    text: resultText,
                    map: resultSourceMap
                };
            }

            if (instance.options.useCache) {
                transformation = await cachePromise({
                    source: text,
                    identifier: instance.cacheIdentifier,
                    directory: instance.options.cacheDirectory,
                    options: webpack.query,
                    transform: transform
                } as any);
            } else {
                transformation = transform();
            }
        }

        let resultText = transformation.text;
        let resultSourceMap = transformation.map;

        if (resultSourceMap) {
            let sourcePath = path.relative(
                instance.options.sourceRoot || process.cwd(),
                loaderUtils.getRemainingRequest(webpack)
            );

            resultSourceMap.sources = [ sourcePath ];
            resultSourceMap.file = fileName;
            resultSourceMap.sourcesContent = [ text ];
        }

        try {
            callback(null, resultText, resultSourceMap);
        } catch (e) {
            console.error('Error in bail mode:', e, e.stack.join
                ? e.stack.join ('\n')
                : e.stack
            );
            process.exit(1);
        }
    } catch (err) {
        console.error(err.toString(), err.stack.toString());
        callback(err, helpers.codegenErrorReport([err]));
    } finally {
        applyDeps();
    }
}

class ForkCheckerPlugin {
    apply(compiler) {
        compiler.plugin("watch-run", function(params, callback) {
            compiler._tsFork = true;
            callback();
        });
    }
}

(loader as any).ForkCheckerPlugin = ForkCheckerPlugin;

module.exports = loader;
