/// <reference path="../node_modules/typescript/bin/typescriptServices.d.ts" />
/// <reference path="../typings/tsd.d.ts" />


import Promise = require("bluebird");
import path = require('path');
import fs = require('fs');

var loaderUtils = require('loader-utils');

import host = require('./host');
import helpers = require('./helpers');

interface WebPack {
    _compiler: {
        inputFileSystem: typeof fs;
        _tsState: host.State
    };
    cacheable: () => void;
    query: string;
    async: () => (err: Error, source?: string, map?: string) => void;
    resourcePath: string;
    resolve: () => void;
    addDependency: (dep: string) => void;
    clearDependencies: () => void;
}

/**
 * Creates compiler instance
 */
function ensureInit(webpack: WebPack) {
    if (typeof webpack._compiler._tsState !== "undefined") {
        return;
    }

    var options = loaderUtils.parseQuery(webpack.query);
    var tsImpl: typeof ts;

    if (options.typescriptCompiler) {
        tsImpl = require(options.typescriptCompiler);
    } else {
        tsImpl = require('typescript');
    }

    if (options.target) {
        options.target = helpers.parseOptionTarget(options.target, tsImpl);
    }

    webpack._compiler._tsState = new host.State(options, webpack._compiler.inputFileSystem, tsImpl);
}

function loader(text) {
    compiler.call(undefined, this, text)
}

var lastTimes = {};

function compiler(webpack: WebPack, text: string): void {
    if (webpack.cacheable) {
        webpack.cacheable();
    }

    ensureInit.call(undefined, webpack);

    var callback = webpack.async();
    var filename = webpack.resourcePath;
    var resolver = <host.Resolver>Promise.promisify(webpack.resolve);

    var deps = {
        add: webpack.addDependency.bind(webpack),
        clear: webpack.clearDependencies.bind(webpack)
    };

    // Here we receive information about what files were changed.
    // The way is hacky, maybe we can find something better.
    var currentTimes = (<any>webpack)._compiler.watchFileSystem.watcher.mtimes;

    // `mtimes` object doesn't change during compilation, so we will not
    // do the same thing on the next changed file.
    if (currentTimes !== lastTimes) {
        for (var changedFile in currentTimes) {
            console.log("Update", changedFile, "in the TS compiler service");
            // `filename` will be updated inside the `emit` call
            if (changedFile !== filename) {
                webpack._compiler._tsState.readFileAndUpdateSync(changedFile);
            }
        }
    }

    lastTimes = currentTimes;

    webpack._compiler._tsState
        .emit(resolver, filename, text, deps)
        .then(output => {
            var result = helpers.findResultFor(output, filename);

            if (result.text === undefined) {
                throw new Error('no output found for ' + filename);
            }

            var sourceFilename = loaderUtils.getRemainingRequest(webpack);
            var current = loaderUtils.getCurrentRequest(webpack);
            var sourceMap = JSON.parse(result.sourceMap);
            sourceMap.sources = [sourceFilename];
            sourceMap.file = current;
            sourceMap.sourcesContent = [text];

            callback(null, result.text, sourceMap);
        })
        .catch(host.TypeScriptCompilationError, err => {
            var errors = helpers.formatErrors(err.diagnostics);
            errors.forEach((<any>webpack).emitError, webpack);

            for (var depDiag in err.depsDiagnostics) {
                var errors = helpers.formatErrors(err.depsDiagnostics[depDiag]);
                errors.forEach((<any>webpack).emitError, webpack);
            }

            callback(null, helpers.codegenErrorReport(errors));
        })
        .catch(callback);
}

export = loader;
