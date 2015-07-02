import * as _ from 'lodash';
import * as util from 'util';
import * as path from 'path';
import * as Promise from 'bluebird';

import { State } from './host';

var objectAssign = require('object-assign');

type FileSet = {[fileName: string]: boolean};

export interface Resolver {
    (base: string, dep: string): Promise<String>
}

export interface Dependency {
    add(fileName: string): void;
    clear(): void
}

function isTypeDeclaration(fileName: string): boolean {
    return /\.d.ts$/.test(fileName);
}

function pathWithoutExt(fileName) {
    let extension = path.extname(fileName);
    return path.join(
        path.dirname(fileName),
        path.basename(fileName, extension)
    );
}

function needRewrite(rewriteImports, importPath): boolean {
    return rewriteImports && _.any(rewriteImports.split(','), (i) => importPath.indexOf(i) !== -1)
}

function updateText(text, pos, end, newText): string {
    return text.slice(0, pos) + ` '${newText}'` + text.slice(end, text.length);
}

function isImportOrExportDeclaration(node: ts.Node) {
    return (!!(<any>node).exportClause || !!(<any>node).importClause)
        && (<any>node).moduleSpecifier;
}

function isImportEqualsDeclaration(node: ts.Node) {
    return !!(<any>node).moduleReference && (<any>node).moduleReference.hasOwnProperty('expression')
}

function isSourceFileDeclaration(node: ts.Node) {
    return !!(<any>node).referencedFiles
}

export class FileAnalyzer {
    dependencies = new DependencyManager();
    validFiles = new ValidFilesManager();
    state: State;

    constructor(state: State) {
        this.state = state;
    }

    checkDependencies(resolver: Resolver, fileName: string): Promise<boolean> {
        if (this.validFiles.isFileValid(fileName)) {
            return Promise.resolve(false);
        }

        this.dependencies.clearDependencies(fileName);


        var flow = this.state.hasFile(fileName) ?
            Promise.resolve(false) :
            this.state.readFileAndUpdate(fileName);

        this.validFiles.markFileValid(fileName);

        let wasChanged = false;
        return flow
            .then((changed) => {
                wasChanged = changed;
                return this.checkDependenciesInternal(resolver, fileName) })
            .catch((err) => {
                this.validFiles.markFileInvalid(fileName);
                throw err
            })
            .then(() => wasChanged);
    }

    private checkDependenciesInternal(resolver: Resolver, fileName: string): Promise<void> {
        var dependencies = this.findImportDeclarations(resolver, fileName)
            .then((deps) => {
                return deps.map(depFileName => {

                    var result: Promise<string> = Promise.resolve(depFileName);
                    var isDeclaration = isTypeDeclaration(depFileName);

                    var isRequiredJs = /\.js$/.exec(depFileName) || depFileName.indexOf('.') === -1;

                    if (isDeclaration) {
                        var hasDeclaration = this.dependencies.hasTypeDeclaration(depFileName);
                        if (!hasDeclaration) {
                            this.dependencies.addTypeDeclaration(depFileName);
                            return this.checkDependencies(resolver, depFileName).then(() => result)
                        }
                    } else if (isRequiredJs) {
                        return Promise.resolve(null);
                    } else {
                        this.dependencies.addDependency(fileName, depFileName);
                        return this.checkDependencies(resolver, depFileName);
                    }

                    return result;
                });
            });

        return Promise.all(dependencies).then((_) => {});
    }

    private findImportDeclarations(resolver: Resolver, fileName: string): Promise<string[]> {
        var sourceFile = this.state.services.getSourceFile(fileName);
        let scriptSnapshot = (<any>sourceFile).scriptSnapshot.text;

        var isDeclaration = isTypeDeclaration(fileName);

        var rewrites: {pos: number, end: number, module: string}[] = [];
        var resolves: Promise<void>[] = [];

        var result = [];
        var visit = (node: ts.Node) => {
            if (!isDeclaration && isImportEqualsDeclaration(node)) {
                // we need this check to ensure that we have an external import
                let importPath = (<any>node).moduleReference.expression.text;
                resolves.push(this.resolve(resolver, fileName, importPath).then((absolutePath) => {
                    if (needRewrite(this.state.options.rewriteImports, importPath)) {
                        let { pos, end } = (<any>node).moduleReference.expression;
                        let module = pathWithoutExt(absolutePath);
                        rewrites.push({ pos, end, module });
                    }
                    result.push(absolutePath);
                }));
            } else if (!isDeclaration && isImportOrExportDeclaration(node)) {
                let importPath = (<any>node).moduleSpecifier.text;
                resolves.push(this.resolve(resolver, fileName, importPath).then((absolutePath) => {
                    if (needRewrite(this.state.options.rewriteImports, importPath)) {
                        let module = pathWithoutExt(absolutePath);
                        let { pos, end } = (<any>node).moduleSpecifier;
                        rewrites.push({ pos, end, module });
                    }
                    result.push(absolutePath);
                }));
            } else if (isSourceFileDeclaration(node)) {
                result = result.concat((<ts.SourceFile>node).referencedFiles.map(function (f) {
                    return path.resolve(path.dirname((<ts.SourceFile>node).fileName), f.fileName);
                }));
            }
            this.state.ts.forEachChild(node, visit);
        };

        visit(sourceFile);
        return Promise.all(resolves).then(() => {
            let orderedRewrites = (<any>_).sortByAll(rewrites, 'pos', 'end').reverse();
            orderedRewrites.forEach(({ pos, end, module }) => {
                scriptSnapshot = updateText(scriptSnapshot, pos, end, module)
            });
            this.state.updateFile(fileName, scriptSnapshot);
            return result;
        });
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
                .error(function (error) {
                    // Node builtin modules
                    try {
                        if (require.resolve(defPath) == defPath) {
                            return defPath;
                        } else {
                            throw error;
                        }
                    } catch (e) {
                        throw error;
                    }
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

export interface DependencyGraphItem {
    fileName: string;
    dependencies: DependencyGraphItem[]
}

export class DependencyManager {
    dependencies: {[fileName: string]: string[]};
    knownTypeDeclarations: FileSet;

    constructor(dependencies: {[fileName: string]: string[]} = {}, knownTypeDeclarations: FileSet = {}) {
        this.dependencies = dependencies;
        this.knownTypeDeclarations = knownTypeDeclarations;
    }

    clone(): DependencyManager {
        return new DependencyManager(
            _.cloneDeep(this.dependencies),
            _.cloneDeep(this.knownTypeDeclarations)
        )
    }

    addDependency(fileName: string, depFileName: string): void {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }

        this.dependencies[fileName].push(depFileName);
    }

    clearDependencies(fileName: string): void {
        this.dependencies[fileName] = []
    }

    getDependencies(fileName: string): string[] {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }

        return this.dependencies[fileName].slice()
    }

    addTypeDeclaration(fileName: string) {
        this.knownTypeDeclarations[fileName] = true
    }

    hasTypeDeclaration(fileName: string): boolean {
        return this.knownTypeDeclarations.hasOwnProperty(fileName)
    }

    getTypeDeclarations(): {[fileName: string]: boolean} {
        return objectAssign({}, this.knownTypeDeclarations);
    }

    getDependencyGraph(fileName: string): DependencyGraphItem {
        var appliedDeps: {[fileName: string]: boolean} = {};
        var result: DependencyGraphItem = {
            fileName,
            dependencies: []
        };

        var walk = (fileName: string, context: DependencyGraphItem) => {
            this.getDependencies(fileName).forEach((depFileName) => {
                var depContext = {
                    fileName: depFileName,
                    dependencies: []
                };
                context.dependencies.push(depContext);

                if (!appliedDeps[depFileName]) {
                    appliedDeps[depFileName] = true;
                    walk(depFileName, depContext);
                }
            })
        };

        walk(fileName, result);
        return result;
    }

    formatDependencyGraph(item: DependencyGraphItem): string {
        var result = {
            buf: 'DEPENDENCY GRAPH FOR: ' + path.relative(process.cwd(), item.fileName)
        };
        var walk = (item: DependencyGraphItem, level: number, buf: typeof result) => {
            for (var i = 0; i < level; i++) { buf.buf = buf.buf + "  " }
            buf.buf = buf.buf + path.relative(process.cwd(), item.fileName);
            buf.buf = buf.buf + "\n";

            item.dependencies.forEach((dep) => walk(dep, level + 1, buf))
        };

        walk(item, 0, result);
        return result.buf += '\n\n';
    }

    applyChain(fileName: string, deps: Dependency) {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }

        var appliedDeps: FileSet = {};
        var graph = this.getDependencyGraph(fileName);

        var walk = (item: DependencyGraphItem) => {
            var itemFileName = item.fileName;
            if (!appliedDeps[itemFileName]) {
                appliedDeps[itemFileName] = true;
                deps.add(itemFileName)
                item.dependencies.forEach((dep) => walk(dep))
            }
        };

        walk(graph);
    }
}

export class ValidFilesManager {
    files: {[fileName: string]: boolean} = {};

    isFileValid(fileName: string): boolean {
        return !!this.files[fileName]
    }

    markFileValid(fileName: string) {
        this.files[fileName] = true;
    }

    markFileInvalid(fileName: string) {
        this.files[fileName] = false;
    }
}

/**
 * Emit compilation result for a specified fileName.
 */
export class ResolutionError {
    message: string;
    fileName: string;
    cause: Error;
}
util.inherits(ResolutionError, Error);
