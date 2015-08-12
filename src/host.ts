import * as fs from 'fs';
import * as util from 'util';
import * as path from 'path';
import * as Promise from 'bluebird';
import * as _ from 'lodash';

import { FileAnalyzer } from './deps';
import { loadLib } from './helpers';

let objectAssign = require('object-assign');

let RUNTIME = loadLib('../lib/runtime.d.ts');

export interface IFile {
    text: string;
    version: number;
}

export interface ICompilerInfo {
    compilerName: string;
    compilerPath: string;
    tsImpl: typeof ts;
    lib5: { fileName: string, text: string };
    lib6: { fileName: string, text: string };
}

export interface ICompilerOptions extends ts.CompilerOptions {
    noLib?: boolean;
    instanceName?: string;
    showRecompileReason?: boolean;
    compiler?: string;
    emitRequireType?: boolean;
    library?: string;
    reEmitDependentFiles?: boolean;
    tsconfig?: string;
    useWebpackText?: boolean;
    rewriteImports?: any;
    externals?: any;
    doTypeCheck?: boolean;
    forkChecker?: boolean;
    useBabel?: boolean;
    usePrecompiledFiles?: boolean;
    useCache?: boolean;
    cacheDirectory?: string;
}

export interface IOutputFile extends ts.OutputFile {
    sourceName: string
}

export interface IEmitOutput extends ts.EmitOutput {
    outputFiles: IOutputFile[]
}

export class Host implements ts.LanguageServiceHost {

    state: State;

    constructor(state: State) {
        this.state = state;
    }

    getScriptFileNames() {
        return Object.keys(this.state.files);
    }

    getScriptVersion(fileName: string) {
        if (this.state.files[fileName]) {
            return this.state.files[fileName].version.toString();
        }
    }

    getScriptSnapshot(fileName) {
        let file = this.state.files[fileName];
        if (file) {
            return this.state.ts.ScriptSnapshot.fromString(file.text);
        }
    }

    getCurrentDirectory() {
        return process.cwd();
    }

    getScriptIsOpen() {
        return true;
    }

    getCompilationSettings() {
        return this.state.options;
    }

    getDefaultLibFileName(options) {
        return options.target === ts.ScriptTarget.ES6 ?
            this.state.compilerInfo.lib6.fileName :
            this.state.compilerInfo.lib5.fileName;
    }

    log(message) {
        //console.log(message);
    }

}

export class State {

    ts: typeof ts;
    fs: typeof fs;
    compilerInfo: ICompilerInfo;
    host: Host;
    files: {[fileName: string]: IFile} = {};
    services: ts.LanguageService;
    options: ICompilerOptions;
    program: ts.Program;
    fileAnalyzer: FileAnalyzer;

    constructor(
        options: ICompilerOptions,
        fsImpl: typeof fs,
        compilerInfo: ICompilerInfo
    ) {
        this.ts = compilerInfo.tsImpl;
        this.compilerInfo = compilerInfo;
        this.fs = fsImpl;
        this.host = new Host(this);
        this.services = this.ts.createLanguageService(this.host, this.ts.createDocumentRegistry());
        this.fileAnalyzer = new FileAnalyzer(this);

        this.options = {};

        objectAssign(this.options, {
            target: this.ts.ScriptTarget.ES5,
            sourceMap: true,
            verbose: false
        });

        objectAssign(this.options, options);

        if (this.options.emitRequireType) {
            this.addFile(RUNTIME.fileName, RUNTIME.text);
        }

        if (!this.options.noLib) {
            if (this.options.target === ts.ScriptTarget.ES6 || this.options.library === 'es6') {
                this.addFile(this.compilerInfo.lib6.fileName, this.compilerInfo.lib6.text);
            } else {
                this.addFile(this.compilerInfo.lib5.fileName, this.compilerInfo.lib5.text);
            }
        }

        this.updateProgram();
    }

    resetService() {
        this.services = this.ts.createLanguageService(this.host, this.ts.createDocumentRegistry());
    }

    resetProgram() {
        this.program = null;
    }

    updateProgram() {
        this.program = this.services.getProgram();
    }

    emit(fileName: string): IEmitOutput {

        if (!this.program) {
            this.program = this.services.getProgram();
        }

        let outputFiles: IOutputFile[] = [];

        let normalizedFileName = this.normalizePath(fileName);

        function writeFile(fileName: string, data: string, writeByteOrderMark: boolean) {
            outputFiles.push({
                sourceName: normalizedFileName,
                name: fileName,
                writeByteOrderMark: writeByteOrderMark,
                text: data
            });
        }

        let source = this.program.getSourceFile(normalizedFileName);
        if (!source) {
            this.updateProgram();
            source = this.program.getSourceFile(normalizedFileName);
            if (!source) {
                throw new Error(`File ${normalizedFileName} was not found in program`);
            }
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

    updateFile(fileName: string, text: string, checked: boolean = false): boolean {
        let prevFile = this.files[fileName];
        let version = 0;
        let changed = true;

        if (prevFile) {
            if (!checked || (checked && text !== prevFile.text)) {
                version = prevFile.version + 1;
            } else {
                changed = false;
            }
        }

        this.files[fileName] = {
            text: text,
            version: version
        };

        return changed
    }

    addFile(fileName: string, text: string): void {
        this.files[fileName] = {
            text: text,
            version: 0
        }
    }

    hasFile(fileName: string): boolean {
        return this.files.hasOwnProperty(fileName);
    }

    readFile(fileName: string): Promise<string> {
        let readFile = Promise.promisify(this.fs.readFile.bind(this.fs));
        return readFile(fileName).then(function (buf) {
            return buf.toString('utf8');
        });
    }

    readFileSync(fileName: string): string {
        // Use global fs here, because local doesn't contain `readFileSync`
        return fs.readFileSync(fileName, {encoding: 'utf-8'});
    }

    readFileAndAdd(fileName: string): Promise<any> {
        return this.readFile(fileName).then((text) => this.addFile(fileName, text));
    }

    readFileAndUpdate(fileName: string, checked: boolean = false): Promise<boolean> {
        return this.readFile(fileName).then((text) => this.updateFile(fileName, text, checked));
    }

    readFileAndUpdateSync(fileName: string, checked: boolean = false): boolean {
        let text = this.readFileSync(fileName);
        return this.updateFile(fileName, text, checked);
    }

    normalizePath(path: string): string {
        return (<any>this.ts).normalizePath(path)
    }
}

/**
 * Emit compilation result for a specified fileName.
 */
export function TypeScriptCompilationError(diagnostics) {
    this.diagnostics = diagnostics;
}
util.inherits(TypeScriptCompilationError, Error);
