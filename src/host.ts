import * as ts from "typescript";
import * as fs from 'fs';
import * as util from 'util';
import * as path from 'path';

import { FileAnalyzer } from './deps';
import { loadLib } from './helpers';
import { LoaderConfig, TsConfig } from './instance';

let RUNTIME = loadLib('../lib/runtime.d.ts');

export interface IFile {
    text: string;
    isDefaultLib: boolean;
    version: number;
}

export interface ICompilerInfo {
    compilerPath: string;
    tsImpl: typeof ts;
}

export interface IOutputFile extends ts.OutputFile {
    sourceName: string;
}

export interface IEmitOutput extends ts.EmitOutput {
    outputFiles: IOutputFile[];
}

export class Host implements ts.LanguageServiceHost {
    state: State;

    constructor(state: State) {
        this.state = state;
    }

    getScriptFileNames() {
        return this.state.allFileNames();
    }

    getScriptVersion(fileName: string) {
        if (this.state.getFile(fileName)) {
            return this.state.getFile(fileName).version.toString();
        }
    }

    getScriptSnapshot(fileName) {
        let file = this.state.getFile(fileName);
        !file && console.log(fileName, file)
        return this.state.ts.ScriptSnapshot.fromString(file.text);
    }

    getCurrentDirectory() {
        return process.cwd();
    }

    getScriptIsOpen() {
        return true;
    }

    getCompilationSettings() {
        return this.state.compilerConfig.options;
    }

    getDefaultLibFileName(options: ts.CompilerOptions) {
       return this.state.defaultLib;
    }

    resolveModuleNames(moduleNames: string[], containingFile: string) {
        return moduleNames.map(moduleName => {
            return this.state.fileAnalyzer.dependencies.getResolution(containingFile, moduleName);
        });
    }

    getDefaultLibLocation(): string {
        return path.dirname(this.state.ts.sys.getExecutingFilePath());
    }

    log(message) {
        // console.log(message);
    }

}

export class State {

    ts: typeof ts;
    fs: typeof fs;
    compilerInfo: ICompilerInfo;
    host: Host;
    files: {[fileName: string]: IFile} = {};
    services: ts.LanguageService;
    loaderConfig: LoaderConfig;
    compilerConfig: TsConfig;
    program: ts.Program;
    fileAnalyzer: FileAnalyzer;
    defaultLib: string;

    constructor(
        loaderConfig: LoaderConfig,
        compilerConfig: TsConfig,
        compilerInfo: ICompilerInfo
    ) {
        this.ts = compilerInfo.tsImpl;
        this.compilerInfo = compilerInfo;
        this.host = new Host(this);
        this.services = this.ts.createLanguageService(this.host, this.ts.createDocumentRegistry());
        this.loaderConfig = loaderConfig;
        this.compilerConfig = compilerConfig;
        this.fileAnalyzer = new FileAnalyzer(this);

        if (loaderConfig.emitRequireType) {
            this.addFile(RUNTIME.fileName, RUNTIME.text);
        }

        this.loadDefaultLib();
    }

    loadDefaultLib() {
        let { options } = this.compilerConfig;
        if (!options.noLib) {
            if (options.lib && options.lib.length > 0) {
                let libraryDir = this.host.getDefaultLibLocation();
                options.lib.forEach((libName, i) => {
                    let fileName = path.join(libraryDir, libName);
                    this.fileAnalyzer.checkDependencies(fileName, true);
                    if (i === 0) {
                        this.defaultLib = fileName;
                    }
                });
            } else {
                let defaultLib = this.ts.getDefaultLibFilePath(options);
                if (defaultLib) {
                    this.defaultLib = defaultLib;
                    this.fileAnalyzer.checkDependencies(defaultLib, true);
                }
            }
        }
    }

    updateProgram() {
        this.program = this.services.getProgram();
    }

    allFileNames() {
        return Object.keys(this.files);
    }

    getSourceFile(fileName: string): ts.SourceFile {
        let services: any = this.services;
        // FIXME @spanferov `getNonBoundSourceFile` is internal API
        return (services.getSourceFile || services.getNonBoundSourceFile)(fileName);
    }

    /**
     * Returns all the files in this state.
     * Don't add new files using this value (eg `allFiles()[newFilePath] = ...`), just use it as a
     * read only reference (as otherwise the paths won't be normalized correctly)
     */
    allFiles() {
        return this.files;
    }

    emit(fileName: string): IEmitOutput {
        fileName = this.normalizePath(fileName);

        if (!this.program) {
            this.program = this.services.getProgram();
        }

        let outputFiles: IOutputFile[] = [];

        function writeFile(fileName: string, data: string, writeByteOrderMark: boolean) {
            outputFiles.push({
                sourceName: fileName,
                name: fileName,
                writeByteOrderMark: writeByteOrderMark,
                text: data
            });
        }

        let source = this.program.getSourceFile(fileName);
        if (!source) {
            throw new Error(`File ${fileName} was not found in program`);
        }

        let emitResult = this.program.emit(source, writeFile);

        let output = {
            outputFiles: outputFiles,
            emitSkipped: emitResult.emitSkipped
        };

        if (!output.emitSkipped) {
            return output;
        } else {
            throw new Error("Emit skipped");
        }
    }

    fastEmit(fileName: string) {
        fileName = this.normalizePath(fileName);

        let file = this.getFile(fileName);
        if (!file) {
            throw new Error(`Unknown file ${ fileName }`);
        }

        let transpileResult = this.ts.transpileModule(file.text, {
            compilerOptions: this.compilerConfig.options,
            reportDiagnostics: false,
            fileName
        });

        return {
            text: transpileResult.outputText,
            sourceMap: transpileResult.sourceMapText
        };
    }

    updateFile(fileName: string, text: string, checked: boolean = false): boolean {
        fileName = this.normalizePath(fileName);
        let prevFile = this.files[fileName];
        let version = 0;
        let changed = true;
        let isDefaultLib = false;

        if (prevFile) {
            isDefaultLib = prevFile.isDefaultLib;
            if (!checked || (checked && text !== prevFile.text)) {
                version = prevFile.version + 1;
            } else {
                changed = false;
            }
        }

        this.files[fileName] = {
            text,
            version,
            isDefaultLib
        };

        return changed;
    }

    addFile(fileName: string, text: string, isDefaultLib = false): IFile {
        fileName = this.normalizePath(fileName);
        return this.files[fileName] = {
            text,
            isDefaultLib,
            version: 0
        };
    }

    getFile(fileName: string): IFile {
        fileName = this.normalizePath(fileName);
        return this.files[fileName];
    }

    hasFile(fileName: string): boolean {
        fileName = this.normalizePath(fileName);
        return this.files.hasOwnProperty(fileName);
    }

    readFile(fileName: string): string {
        fileName = this.normalizePath(fileName);
        // Use global fs here, because local doesn't contain `readFileSync`
        return fs.readFileSync(fileName, {encoding: 'utf-8'});
    }

    readFileAndAdd(fileName: string, isDefaultLib = false) {
        fileName = this.normalizePath(fileName);
        let text = this.readFile(fileName);
        this.addFile(fileName, text, isDefaultLib);
    }

    readFileAndUpdate(fileName: string, checked: boolean = false): boolean {
        fileName = this.normalizePath(fileName);
        let text = this.readFile(fileName);
        return this.updateFile(fileName, text, checked);
    }

    normalizePath(filePath: string): string {
        return path.normalize(filePath);
    }
}

/**
 * Emit compilation result for a specified fileName.
 */
export function TypeScriptCompilationError(diagnostics) {
    this.diagnostics = diagnostics;
}
util.inherits(TypeScriptCompilationError, Error);
