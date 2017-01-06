import * as _ from 'lodash';
import * as path from 'path';

import { findCompiledModule, cache } from './cache';
import * as helpers from './helpers';
import { QueryOptions, Loader, ensureInstance, Instance } from './instance';
import { PathsPlugin } from './paths-plugin';
import { CheckerPlugin as _CheckerPlugin } from './watch-mode';

let loaderUtils = require('loader-utils');

function loader(text) {
    try {
        compiler.call(undefined, this, text);
    } catch(e) {
        console.error(e, e.stack);
        throw e;
    }
}

namespace loader {
    export const TsConfigPathsPlugin = PathsPlugin;
    export const CheckerPlugin = _CheckerPlugin;
}

interface Transformation {
    text: string;
    map: any;
    deps: string[];
    fresh?: boolean;
}

function compiler(loader: Loader, text: string): void {
    if (loader.cacheable) {
        loader.cacheable();
    }

    let options = <QueryOptions>loaderUtils.parseQuery(loader.query);
    let instanceName = options.instance || 'at-loader';
    let instance = ensureInstance(loader, options, instanceName);
    let callback = loader.async();
    let fileName = helpers.toUnix(loader.resourcePath);

    instance.compiledFiles[fileName] = true;

    let compiledModule;
    if (instance.loaderConfig.usePrecompiledFiles) {
        compiledModule = findCompiledModule(fileName);
    }

    let transformation: Promise<{cached: boolean, result: Transformation}> = null;

    if (compiledModule) {
        transformation = Promise.resolve({
            text: compiledModule.text,
            map: compiledModule.map
                ? JSON.parse(compiledModule.map)
                : null
        }).then(result => ({cached: true, result}));
    } else {
        let transformationFunction = () => transform(
            loader,
            instance,
            fileName,
            text
        );

        if (instance.loaderConfig.useCache) {
            transformation = cache<Transformation>({
                source: text,
                identifier: instance.cacheIdentifier,
                directory: instance.loaderConfig.cacheDirectory,
                options: loader.query,
                transform: transformationFunction
            });
        } else {
            transformation = transformationFunction().then(result => ({cached: false, result}));
        }
    }

    transformation
        .then(({cached, result}) => {
            if (!instance.compilerConfig.options.isolatedModules) {
                // If our modules are isolated we don't need to recompile all the deps
                result.deps.forEach(dep => loader.addDependency(path.normalize(dep)));
            }
            if (cached) {
                // Update file in checker in case we read it from the cache
                instance.checker.updateFile(fileName, text);
            }
            return result;
        })
        .then(({text, map}) => {
            callback(null, text, map);
        })
        .catch(callback)
        .catch(e => {
            console.error('Error in bail mode:', e, e.stack.join
                ? e.stack.join ('\n')
                : e.stack
            );
            process.exit(1);
        });
}

function transform(webpack: Loader, instance: Instance, fileName: string, text: string): Promise<Transformation> {
    let resultText;
    let resultSourceMap = null;

    return instance.checker.emitFile(fileName, text).then((({emitResult, deps}) => {
        resultSourceMap = emitResult.sourceMap;
        resultText = emitResult.text;

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

            let babelOptions = _.assign({}, defaultOptions, instance.loaderConfig.babelOptions);
            let babelResult = instance.babelImpl.transform(resultText, babelOptions);

            resultText = babelResult.code;
            resultSourceMap = babelResult.map;
        }

        if (resultSourceMap) {
            let sourcePath = path.relative(
                instance.compilerConfig.options.sourceRoot || process.cwd(),
                loaderUtils.getRemainingRequest(webpack)
            );

            resultSourceMap.sources = [ sourcePath ];
            resultSourceMap.file = fileName;
            resultSourceMap.sourcesContent = [ text ];
        }

        return {
            text: resultText,
            map: resultSourceMap,
            deps,
        };
    }));
}

export = loader;
