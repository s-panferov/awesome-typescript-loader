/// <reference path="./defines.d.ts" />

import * as _ from 'lodash';
import * as path from 'path';

let objectAssign = require('object-assign');

import { findCompiledModule, cache } from './cache';
import * as helpers from './helpers';
import { isTypeDeclaration } from './deps';
import { QueryOptions, IWebPack, ensureInstance, ICompilerInstance } from './instance';
import { PathsPlugin } from './paths-plugin';

let loaderUtils = require('loader-utils');

function loader(text) {
    try {
        compiler.call(undefined, this, text);
    } catch(e) {
        console.error(e, e.stack);
        throw e;
    }
}

interface Transformation {
    text: string;
    map: any;
}

function compiler(webpack: IWebPack, text: string): void {
    if (webpack.cacheable) {
        webpack.cacheable();
    }

    let options = <QueryOptions>loaderUtils.parseQuery(webpack.query);
    let instanceName = options.instanceName || 'default';
    let instance = ensureInstance(webpack, options, instanceName);
    let state = instance.tsState;
    let callback = webpack.async();
    let fileName = helpers.toUnix(webpack.resourcePath);

    let depsInjector = {
        add: (depFileName) => webpack.addDependency(path.normalize(depFileName)),
        clear: webpack.clearDependencies.bind(webpack)
    };

    let applyDeps = _.once(() => {
        depsInjector.clear();
        depsInjector.add(fileName);
        state.fileAnalyzer.dependencies.applyCompiledFiles(fileName, depsInjector);
        if (state.loaderConfig.reEmitDependentFiles) {
            state.fileAnalyzer.dependencies.applyChain(fileName, depsInjector);
        }
    });

    invokeKnownFilesOneTime(instance);

    instance.compiledFiles[fileName] = true;
    let doUpdate = false;

    if (state.updateFile(fileName, text, true)) {
        state.fileAnalyzer.validFiles.markFileInvalid(fileName);
        doUpdate = true;
    }

    try {
        let wasChanged = state.fileAnalyzer.checkDependencies(fileName);
        if (wasChanged || doUpdate) {
            instance.shouldUpdateProgram = true;
        }

        let compiledModule;
        if (instance.loaderConfig.usePrecompiledFiles) {
            compiledModule = findCompiledModule(fileName);
        }

        let transformation: Transformation = null;

        if (compiledModule) {
            state.fileAnalyzer.dependencies.addCompiledModule(fileName, compiledModule.fileName);
            transformation = {
                text: compiledModule.text,
                map: compiledModule.map
                    ? JSON.parse(compiledModule.map)
                    : null
            };
        } else {

            let transformationFunction = () => transform(
                webpack,
                instance,
                fileName,
                text
            );

            if (instance.loaderConfig.useCache) {
                transformation = cache<Transformation>({
                    source: text,
                    identifier: instance.cacheIdentifier,
                    directory: instance.loaderConfig.cacheDirectory,
                    options: webpack.query,
                    transform: transformationFunction
                });
            } else {
                transformation = transformationFunction();
            }
        }

        let resultText = transformation.text;
        let resultSourceMap = transformation.map;

        if (resultSourceMap) {
            let sourcePath = path.relative(
                instance.compilerConfig.options.sourceRoot || process.cwd(),
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

function transform(webpack: IWebPack, instance: ICompilerInstance, fileName: string, text: string): Transformation {
    let resultText;
    let resultSourceMap = null;
    let state = instance.tsState;

    let useSlowEmit = state.compilerConfig.options.declaration || state.loaderConfig.disableFastEmit;
    if (useSlowEmit) {
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

    if (instance.loaderConfig.useBabel) {
        let defaultOptions = {
            inputSourceMap: resultSourceMap,
            sourceRoot: process.cwd(),
            filename: fileName,
            sourceMap: true
        };

        let babelOptions = objectAssign({}, defaultOptions, instance.loaderConfig.babelOptions);
        let babelResult = instance.babelImpl.transform(resultText, babelOptions);

        resultText = babelResult.code;
        resultSourceMap = babelResult.map;
    }

    return {
        text: resultText,
        map: resultSourceMap
    };
}

function invokeKnownFilesOneTime(instance: ICompilerInstance) {
     if (instance.loaderConfig.externals && !instance.externalsInvoked) {

        instance.loaderConfig.externals
            .filter(isTypeDeclaration)
            .forEach(ext => instance.tsState.fileAnalyzer.checkDependencies(ext));

        instance.externalsInvoked = true;
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
(loader as any).TsConfigPathsPlugin = PathsPlugin;

module.exports = loader;
