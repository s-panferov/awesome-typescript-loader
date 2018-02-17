import * as ts from 'typescript';

export interface CompilerInfo {
    compilerPath: string;
    compilerVersion: string;
    tsImpl: typeof ts;
}

export interface LoaderConfig {
    instance?: string;
    compiler?: string;
    configFileName?: string;
    configFileContent?: string;
    forceIsolatedModules?: boolean;
    errorsAsWarnings?: boolean;
    transpileOnly?: boolean;
    ignoreDiagnostics?: number[];
    compilerOptions?: ts.CompilerOptions;
    useTranspileModule?: boolean;
    useBabel?: boolean;
    babelCore?: string;
    babelOptions?: any;
    usePrecompiledFiles?: boolean;
    silent?: boolean;
    useCache?: boolean;
    cacheDirectory?: string;
    entryFileIsJs?: boolean;
    debug?: boolean;
    customTranformersPath?: string;
    getCustomTransformers?: (program: ts.Program) => ts.CustomTransformers | undefined;
    reportFiles?: string[];
    context?: string;
}

export interface OutputFile {
    text: string;
    sourceMap: string;
    declaration: ts.OutputFile;
}

export type TsConfig = ts.ParsedCommandLine;
