import fs = require('fs');
import util = require('util');
import path = require('path');
import Promise = require('bluebird');
import _ = require('lodash');

import helpers = require('./helpers');
import deps = require('./deps');

var objectAssign = require('object-assign');

var RUNTIME = helpers.loadLib('./runtime.d.ts');
var LIB = helpers.loadLib('typescript/bin/lib.d.ts');
var LIB6 = helpers.loadLib('typescript/bin/lib.es6.d.ts');

export interface Resolver {
    (base: string, dep: string): Promise<String>
}

export interface File {
    text: string;
    version: number;
}

export interface CompilerOptions extends ts.CompilerOptions {
    instanceName?: string;
    showRecompileReason?: boolean;
    compiler?: string;
    emitRequireType?: boolean;
    library?: string;
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
        } else {
            var version = this.state.indirectImportVersions[fileName];
            return version != null ? version.toString() : null;
        }
    }

    getScriptSnapshot(fileName) {
        var file = this.state.files[fileName];

        if (this.state.indirectImportFailures[fileName]) {
            return
        }

        if (!file) {
            try {
                return this.state.indirectImport(fileName);
            }
            catch (e) {
                this.state.indirectImportFailures[fileName] = true;
                return;
            }
        }

        return this.state.ts.ScriptSnapshot.fromString(file.text);
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
        return options.target === ts.ScriptTarget.ES6 ? LIB6.fileName : LIB.fileName;
    }

    log(message) {
        //console.log(message);
    }

}

function isTypeDeclaration(fileName: string): boolean {
    return /\.d.ts$/.test(fileName);
}

export class State {

    ts: typeof ts;
    fs: typeof fs;
    host: Host;
    files: {[fileName: string]: File} = {};
    services: ts.LanguageService;
    options: CompilerOptions;
    program: ts.Program;
    indirectImportVersions: {[key:string]: number} = {};
    indirectImportCache: {[key:string]: ts.IScriptSnapshot} = {};
    indirectImportFailures: {[key:string]: boolean} = {};

    dependencies = new deps.DependencyManager();

    constructor(
        options: CompilerOptions,
        fsImpl: typeof fs,
        tsImpl: typeof ts
    ) {
        this.ts = tsImpl || require('typescript');
        this.fs = fsImpl;
        this.host = new Host(this);
        this.services = this.ts.createLanguageService(this.host, this.ts.createDocumentRegistry());

        this.options = {};

        objectAssign(this.options, {
            target: this.ts.ScriptTarget.ES5,
            module: this.ts.ModuleKind.CommonJS,
            sourceMap: true,
            verbose: false
        });

        objectAssign(this.options, options);

        if (this.options.emitRequireType) {
            this.addFile(RUNTIME.fileName, RUNTIME.text);
        }

        if (this.options.target === ts.ScriptTarget.ES6 || this.options.library === 'es6') {
            this.addFile(LIB6.fileName, LIB6.text);
        } else {
            this.addFile(LIB.fileName, LIB.text);
        }
    }

    indirectImport(fileName: string): ts.IScriptSnapshot {
        if (this.indirectImportCache[fileName]) {
            return this.indirectImportCache[fileName]
        } else {
            var rawFile = this.readFileSync(fileName);
            var snapshot = this.ts.ScriptSnapshot.fromString(rawFile)
            this.addIndirectImport(fileName, snapshot);
            return snapshot;
        }
    }

    addIndirectImport(fileName: string, snapshot: ts.IScriptSnapshot) {
        this.indirectImportCache[fileName] = snapshot;
        this.dependencies.addIndirectImport(fileName);
        if (typeof this.indirectImportVersions[fileName] == 'undefined') {
            this.indirectImportVersions[fileName] = 0;
        } else {
            this.indirectImportVersions[fileName] += 1;
        }
    }

    clearIndirectImportCache() {
        this.indirectImportCache = {}
        this.indirectImportFailures = {}
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

    checkDeclarations(resolver: Resolver, fileName: string): Promise<void> {
        this.dependencies.clearDependencies(fileName);

        var flow = this.hasFile(fileName) ?
            Promise.resolve(false) :
            this.readFileAndUpdate(fileName);

        return flow.then(() => this.checkDeclarationsInternal(resolver, fileName))
    }

    private checkDeclarationsInternal(resolver: Resolver, fileName: string): Promise<void> {
        var dependencies = this.findDeclarations(fileName)
            .map(depRelFileName =>
                this.resolve(resolver, fileName, depRelFileName))
            .map(depFileNamePromise => depFileNamePromise.then(depFileName => {
                var result: Promise<string> = Promise.resolve(depFileName);
                this.dependencies.addTypeDeclaration(depFileName);
                return this.checkDeclarations(resolver, depFileName).then(() => result)
            }));

        return Promise.all(dependencies).then((_) => {});
    }

    private findDeclarations(fileName: string) {
        var node = this.services.getSourceFile(fileName);

        var result = [];
        var visit = (node: ts.Node) => {
            if (node.kind === ts.SyntaxKind.SourceFile) {
                result = result.concat((<ts.SourceFile>node).referencedFiles.map(function (f) {
                    return path.resolve(path.dirname((<ts.SourceFile>node).fileName), f.fileName);
                }));
            }
            this.ts.forEachChild(node, visit);
        };
        visit(node);
        return result;
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

    resolve(resolver: Resolver, fileName: string, defPath: string): Promise<string> {
        var result;
        if (!path.extname(defPath).length) {
            result = resolver(path.dirname(fileName), defPath + ".ts")
                .error(function (error) {
                    return resolver(path.dirname(fileName), defPath + ".d.ts")
                })
                .error(function (error) {
                    return resolver(path.dirname(fileName), defPath)
                })
        } else {
            // We don't need to resolve .d.ts here because they are already
            // absolute at this step.
            if (/\.d\.ts$/.test(defPath)) {
                result = Promise.resolve(defPath)
            } else {
                result = resolver(path.dirname(fileName), defPath)
            }
        }

        return result
            .error(function (error) {
                var detailedError: any = new ResolutionError();
                detailedError.message = error.message + "\n    Required in " + fileName;
                detailedError.cause = error;
                detailedError.fileName = fileName;

                throw detailedError;
            })
    }

}


/**
 * Emit compilation result for a specified fileName.
 */
export function TypeScriptCompilationError(diagnostics) {
    this.diagnostics = diagnostics;
}
util.inherits(TypeScriptCompilationError, Error);


/**
 * Emit compilation result for a specified fileName.
 */
export class ResolutionError {
    message: string;
    fileName: string;
    cause: Error;
}
util.inherits(ResolutionError, Error);
