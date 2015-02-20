import fs = require('fs');
import util = require('util');
import path = require('path');
import Promise = require('bluebird');

import helpers = require('./helpers');

var objectAssign = require('object-assign');

var RUNTIME = helpers.loadLib('./runtime.d.ts');
var LIB = helpers.loadLib('typescript/bin/lib.d.ts');

export interface Resolver {
    (base: string, dep: string): Promise<String>
}

export interface Dependency {
    add(fileName: string): void;
    clear(): void
}

export interface VisitedDeclarations {
    [fileName: string]: boolean
}

export interface File {
    text: string;
    version: number;
}

var total = 0;

export class Host implements ts.LanguageServiceHost {

    state: State;

    constructor(state: State) {
        this.state = state;
    }

    getScriptFileNames() {
        return Object.keys(this.state.files);
    }

    getScriptVersion(fileName: string) {
        return this.state.files[fileName] && this.state.files[fileName].version.toString();
    }

    getScriptSnapshot(fileName) {
        var file = this.state.files[fileName];

        if (!file) {
            return null;
        }

        return {
            getText: function (start, end) {
                return file.text.substring(start, end);
            },
            getLength: function () {
                return file.text.length;
            },
            getLineStartPositions: function () {
                return [];
            },
            getChangeRange: function (oldSnapshot) {
                return undefined;
            }
        };
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
        return LIB.fileName;
    }

    log(message) {
        //console.log(message);
    }

}

export class State {

    ts: typeof ts;
    fs: typeof fs;
    host: Host;
    files: {[fileName: string]: File} = {};
    knownTypeDeclarations: string[] = [];
    services: ts.LanguageService;
    options: ts.CompilerOptions;
    runtimeRead: boolean;

    constructor(
        options: ts.CompilerOptions,
        fsImpl: typeof fs,
        tsImpl: typeof ts
    ) {
        this.ts = tsImpl || require('typescript');
        this.fs = fsImpl;
        this.host = new Host(this);
        this.services = this.ts.createLanguageService(this.host, this.ts.createDocumentRegistry());

        this.options = {};
        this.runtimeRead = false;

        objectAssign(this.options, {
            target: this.ts.ScriptTarget.ES5,
            module: this.ts.ModuleKind.CommonJS,
            sourceMap: true,
            verbose: false
        });

        objectAssign(this.options, options);

        this.addFile(RUNTIME.fileName, RUNTIME.text);
        this.addFile(LIB.fileName, LIB.text);
    }

    resetService() {
        this.services = this.ts.createLanguageService(this.host, this.ts.createDocumentRegistry());
    }

    emit(resolver: Resolver, fileName: string, text: string, deps: Dependency): Promise<ts.EmitOutput> {

        // Check if we need to compiler Webpack runtime definitions.
        if (!this.runtimeRead) {
            this.services.getEmitOutput(RUNTIME.fileName);
            this.runtimeRead = true;
        }

        this.updateFile(fileName, text);

        return <any>this.checkDependencies(resolver, fileName, deps).then((deps) => {

            var t1 = Date.now();
            var output = this.services.getEmitOutput(fileName);
            var diff = Date.now() - t1;
            total += diff;
            console.log(fileName, diff, total);

            var depsDiagnostics = {};
            var diagnostics = this.services.getCompilerOptionsDiagnostics()
                .concat(this.services.getSyntacticDiagnostics(fileName))
                .concat(this.services.getSemanticDiagnostics(fileName));

            if (diagnostics.length) {
                deps.forEach((depFileName) => {
                    depsDiagnostics[depFileName] = this.services.getSyntacticDiagnostics(depFileName)
                        .concat(this.services.getSemanticDiagnostics(depFileName));
                });

                if (diagnostics.length) {
                    throw new TypeScriptCompilationError(diagnostics, depsDiagnostics);
                }
            }

            if (!output.emitSkipped) {
                return output;
            } else {
                throw new Error("Emit skipped");
            }
        });
    }

    checkDependencies(resolver: Resolver, fileName: string, deps: Dependency): Promise<string[]> {
        deps.clear();
        // It's strange but we really need to add file to its deps
        // to make webpack to recompile it after change.
        deps.add(fileName);
        return this.checkDependenciesInternal(resolver, fileName, deps, {})
            .then(depFileNames => {
                this.knownTypeDeclarations.forEach(declFileName => {
                    deps.add(declFileName)
                })
                return depFileNames;
            })
    }

    checkDependenciesInternal(resolver, fileName, deps: Dependency, visited: VisitedDeclarations): Promise<string[]> {
        var dependencies = this.findImportDeclarations(fileName)
            .map(depRelFileName =>
                this.resolve(resolver, fileName, depRelFileName))
            .map(depFileNamePromise => depFileNamePromise.then(depFileName => {

                var result: Promise<string> = Promise.resolve(depFileName);
                var isTypeDeclaration = /\.d.ts$/.exec(depFileName);

                if (isTypeDeclaration) {
                    this.knownTypeDeclarations.push(depFileName);
                } else {
                    deps.add(depFileName);
                }

                // This is d.ts which doesn't go through typescript-loader separately so
                // we should take care of it by analyzing its dependencies here.
                if (isTypeDeclaration && !visited.hasOwnProperty(depFileName)) {
                    visited[depFileName] = true;
                    result = this.readFileAndUpdate(depFileName, /*checked=*/true)
                        .then(_ => this.checkDependenciesInternal(resolver, depFileName, deps, visited))
                        .then(_ => Promise.resolve(depFileName));
                } else {
                    if (!this.files.hasOwnProperty(depFileName)) {
                        result = this.readFileAndAdd(depFileName).then(_ => Promise.resolve(depFileName));
                    }
                }

                return <Promise<string>>result;

            }));

        return Promise.all<string>(dependencies)
    }

    findImportDeclarations(fileName: string) {
        var node = this.services.getSourceFile(fileName);

        var result = [];
        var visit = (node: ts.Node) => {
            if (node.kind === ts.SyntaxKind.ImportDeclaration) {
                // we need this check to ensure that we have an external import
                if ((<ts.ImportDeclaration>node).moduleReference.hasOwnProperty("expression")) {
                    result.push((<any>node).moduleReference.expression.text);
                }
            } else if (node.kind === ts.SyntaxKind.SourceFile) {
                result = result.concat((<ts.SourceFile>node).referencedFiles.map(function (f) {
                    return path.resolve(path.dirname((<ts.SourceFile>node).fileName), f.fileName);
                }));
            }

            this.ts.forEachChild(node, visit);
        }
        visit(node);
        return result;
    }

    updateFile(fileName: string, text: string, checked: boolean = false): void {
        var prevFile = this.files[fileName];
        var version = 0;

        if (prevFile) {
            if (!checked || (checked && text !== prevFile.text)) {
                version = prevFile.version + 1;
            }
        }

        this.files[fileName] = {
            text: text,
            version: version
        }
    }

    addFile(fileName: string, text: string): void {
        this.files[fileName] = {
            text: text,
            version: 0
        }
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

    readFileAndUpdate(fileName: string, checked: boolean = false): Promise<any> {
        return this.readFile(fileName).then((text) => this.updateFile(fileName, text, checked));
    }

    readFileAndUpdatSync(fileName: string, checked: boolean = false) {
        var text = this.readFileSync(fileName);
        this.updateFile(fileName, text, checked);
    }

    resolve(resolver: Resolver, fileName: string, defPath: string) {
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
            result = resolver(path.dirname(fileName), defPath)
        }

        return result
            .error(function (error) {
                var detailedError: any = new Error(error.message + "\n    Required in " + fileName);
                detailedError.cause = error;

                throw detailedError;
            })
    }

}


/**
 * Emit compilation result for a specified fileName.
 */
export function TypeScriptCompilationError(diagnostics, depsDiagnostics) {
    this.diagnostics = diagnostics;
    this.depsDiagnostics = depsDiagnostics;
}
util.inherits(TypeScriptCompilationError, Error);
