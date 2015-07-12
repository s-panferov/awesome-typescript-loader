import * as fs from 'fs';
import * as util from 'util';
import * as path from 'path';
import * as Promise from 'bluebird';
import * as _ from 'lodash';

import { FileAnalyzer } from './deps';
import { loadLib } from './helpers';

var objectAssign = require('object-assign');

var RUNTIME = loadLib('../lib/runtime.d.ts');

export interface File {
    text: string;
    version: number;
}

export interface CompilerInfo {
    compilerName: string;
    tsImpl: typeof ts;
    lib5: { fileName: string, text: string };
    lib6: { fileName: string, text: string };
}

export interface CompilerOptions extends ts.CompilerOptions {
    noLib?: boolean;
    instanceName?: string;
    showRecompileReason?: boolean;
    compiler?: string;
    emitRequireType?: boolean;
    library?: string;
    reEmitDependentFiles?: boolean;
    tsconfig?: string;
    useWebpackText?: boolean;
    rewriteImports?: string;
    externals?: string
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
        var file = this.state.files[fileName];
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
    compilerInfo: CompilerInfo;
    host: Host;
    files: {[fileName: string]: File} = {};
    services: ts.LanguageService;
    options: CompilerOptions;
    program: ts.Program;
    fileAnalyzer: FileAnalyzer;

    constructor(
        options: CompilerOptions,
        fsImpl: typeof fs,
        compilerInfo: CompilerInfo
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

    emit(fileName: string): ts.EmitOutput {

        if (!this.program) {
            this.program = this.services.getProgram();
        }

        var outputFiles: ts.OutputFile[] = [];

        function writeFile(fileName: string, data: string, writeByteOrderMark: boolean) {
            outputFiles.push({
                name: fileName,
                writeByteOrderMark: writeByteOrderMark,
                text: data
            });
        }

        var normalizedFileName = this.normalizePath(fileName);
        var source = this.program.getSourceFile(normalizedFileName);
        if (!source) {
            this.updateProgram();
            source = this.program.getSourceFile(normalizedFileName);
            if (!source) {
                throw new Error(`File ${normalizedFileName} was not found in program`);
            }
        }

        var emitResult = this.program.emit(source, writeFile);

        var output = {
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
        var prevFile = this.files[fileName];
        var version = 0;
        var changed = true;

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
        var readFile = Promise.promisify(this.fs.readFile.bind(this.fs));
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
        var text = this.readFileSync(fileName);
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
