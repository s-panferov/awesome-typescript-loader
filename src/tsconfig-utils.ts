import * as path from 'path';
import * as tsconfig from 'tsconfig';

function reverseKeysAndValues(obj) {
    var toret = {};
    Object.keys(obj).forEach(function (key) {
        toret[obj[key]] = key;
    });
    return toret;
}

function buildEnumMap(tsImpl: typeof ts) {
    let typescriptEnumMap = {
        target: {
            'es3': tsImpl.ScriptTarget.ES3,
            'es5': tsImpl.ScriptTarget.ES5,
            'es6': tsImpl.ScriptTarget.ES6,
            'latest': tsImpl.ScriptTarget.Latest
        },
        module: {
            'none': tsImpl.ModuleKind.None,
            'commonjs': tsImpl.ModuleKind.CommonJS,
            'amd': tsImpl.ModuleKind.AMD,
            'umd': tsImpl.ModuleKind.UMD,
            'system': tsImpl.ModuleKind.System,
            'es6': tsImpl.ModuleKind.ES6,
            'es2015': tsImpl.ModuleKind.ES2015,
        },
        moduleResolution: {
            'node': tsImpl.ModuleResolutionKind.NodeJs,
            'classic': tsImpl.ModuleResolutionKind.Classic
        },
        jsx: {
            'preserve': tsImpl.JsxEmit.Preserve,
            'react': tsImpl.JsxEmit.React
        },
        newLine: {
            'CRLF': tsImpl.NewLineKind.CarriageReturnLineFeed,
            'LF': tsImpl.NewLineKind.LineFeed
        }
    };
    
    return typescriptEnumMap;
}

function mixin(target, source) {
    for (var key in source) {
        target[key] = source[key];
    }
    return target;
}

export function rawToTsCompilerOptions(jsonOptions, projectDir, tsImpl: typeof ts) {
    let typescriptEnumMap = buildEnumMap(tsImpl);
    var compilerOptions: any = {};
    for (var key in jsonOptions) {
        if (typescriptEnumMap[key]) {
            compilerOptions[key] = typescriptEnumMap[key][jsonOptions[key].toLowerCase()];
        }
        else {
            compilerOptions[key] = jsonOptions[key];
        }
    }
    if (compilerOptions.outDir !== undefined) {
        compilerOptions.outDir = path.resolve(projectDir, compilerOptions.outDir);
    }
    if (compilerOptions.rootDir !== undefined) {
        compilerOptions.rootDir = path.resolve(projectDir, compilerOptions.rootDir);
    }
    if (compilerOptions.out !== undefined) {
        compilerOptions.out = path.resolve(projectDir, compilerOptions.out);
    }
    if (compilerOptions.outFile !== undefined) {
        compilerOptions.out = path.resolve(projectDir, compilerOptions.outFile);
    }
    return compilerOptions;
}