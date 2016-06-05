import * as _ from 'lodash';
import * as path from 'path';

let promisify = require('es6-promisify');

import { State } from './host';

let objectAssign = require('object-assign');

type FileSet = {[fileName: string]: boolean};

export interface IResolver {
    (base: string, dep: string): Promise<string>;
}

export interface IDependency {
    add(fileName: string): void;
    clear(): void;
}

export interface IExternals {
    [key: string]: string;
}

export type Exclude = string[];

export function createResolver(
    externals: IExternals,
    exclude: Exclude,
    webpackResolver: any,
    ctx: any = null
): IResolver {
    let finalResolver = webpackResolver;
    if (webpackResolver.length === 4) {
        // carrying resolver for webpack2
        finalResolver = webpackResolver.bind(ctx, {});
    }
    let resolver: IResolver = promisify(finalResolver) as any;

    function resolve(base: string, dep: string): Promise<string> {
        let inWebpackExternals = externals && externals.hasOwnProperty(dep);
        let inTypeScriptExclude = false;

        if ((inWebpackExternals || inTypeScriptExclude)) {
            return Promise.resolve<string>('%%ignore');
        } else {
            return resolver(base, dep).then(resultPath => {
                if (Array.isArray(resultPath)) {
                    resultPath = resultPath[0];
                }

                // ignore excluded javascript
                if (!resultPath.match(/.tsx?$/)) {
                    let matchedExcludes = exclude.filter((excl) => {
                        return resultPath.indexOf(excl) !== -1;
                    });

                    if (matchedExcludes.length > 0) {
                        return '%%ignore';
                    } else {
                        return resultPath;
                    }
                } else {
                    return resultPath;
                }
            });
        }
    }

    return resolve;
}

function isTypeDeclaration(fileName: string): boolean {
    return /\.d.ts$/.test(fileName);
}

function isImportOrExportDeclaration(node: ts.Node) {
    return (!!(<any>node).exportClause || !!(<any>node).importClause)
        && (<any>node).moduleSpecifier;
}

function isImportEqualsDeclaration(node: ts.Node) {
    return !!(<any>node).moduleReference && (<any>node).moduleReference.hasOwnProperty('expression');
}

function isIgnoreDependency(absulutePath: string) {
    return absulutePath == '%%ignore';
}

let lock: Promise<any>;

export class FileAnalyzer {
    dependencies = new DependencyManager();
    validFiles = new ValidFilesManager();
    state: State;

    constructor(state: State) {
        this.state = state;
    }

    async checkDependenciesLocked(resolver: IResolver, fileName: string): Promise<boolean> {
        let isValid = this.validFiles.isFileValid(fileName);
        if (isValid) {
            return isValid;
        }

        if (lock) {
            return lock
                .then(() => {
                    return this.checkDependenciesLocked(resolver, fileName);
                });
        }

        let resolveLock;
        lock = new Promise((res, rej) => { resolveLock = res; });

        try {
            let checked = await this.checkDependencies(resolver, fileName);
            return checked;
        } finally {
            lock = null;
            resolveLock();
        }
    }

    async checkDependencies(resolver: IResolver, fileName: string): Promise<boolean> {
        let isValid = this.validFiles.isFileValid(fileName);
        if (isValid) {
            return isValid;
        }

        this.validFiles.markFileValid(fileName);
        this.dependencies.clearDependencies(fileName);

        let changed = false;

        try {
            if (!this.state.hasFile(fileName)) {
                changed = await this.state.readFileAndUpdate(fileName);
            }
            await this.checkDependenciesInternal(resolver, fileName);
        } catch (err) {
            this.validFiles.markFileInvalid(fileName);
            throw err;
        }

        return changed;
    }

    async checkDependenciesInternal(resolver: IResolver, fileName: string): Promise<void> {
        let imports = await this.findImportDeclarations(resolver, fileName);
        let tasks: Promise<any>[] = [];

        for (let i = 0; i < imports.length; i++) {
            let importPath = imports[i];
            let isDeclaration = isTypeDeclaration(importPath);
            let isRequiredJs = /\.js$/.exec(importPath) || importPath.indexOf('.') === -1;

            if (isDeclaration) {
                let hasDeclaration = this.dependencies.hasTypeDeclaration(importPath);
                if (!hasDeclaration) {
                    this.dependencies.addTypeDeclaration(importPath);
                    tasks.push(this.checkDependencies(resolver, importPath));
                }
            } else if (isRequiredJs && !this.state.options.allowJs) {
                continue;
            } else {
                if (!checkIfModuleBuiltInCached(importPath)) {
                    this.dependencies.addDependency(fileName, importPath);
                    tasks.push(this.checkDependencies(resolver, importPath));
                }
            }
        }

        await Promise.all(tasks);
        return null;
    }

    async findImportDeclarations(resolver: IResolver, fileName: string): Promise<string[]> {
        let sourceFile = this.state.getSourceFile(fileName);
        let isDeclaration = isTypeDeclaration(fileName);

        let imports = [];
        let visit = (node: ts.Node) => {
            if (!isDeclaration && isImportEqualsDeclaration(node)) {
                // we need this check to ensure that we have an external import
                let importPath = (<any>node).moduleReference.expression.text;
                imports.push(importPath);
            } else if (!isDeclaration && isImportOrExportDeclaration(node)) {
                let importPath = (<any>node).moduleSpecifier.text;
                imports.push(importPath);
            }
        };

        imports.push.apply(imports, sourceFile.referencedFiles.map(file => file.fileName));
        this.state.ts.forEachChild(sourceFile, visit);

        let task = imports.map(async (importPath) => {
            let absolutePath: string = await this.resolve(resolver, fileName, importPath);
            if (!isIgnoreDependency(absolutePath)) {
                return absolutePath;
            }
        });

        let resolvedImports = await Promise.all(task);

        // FIXME ts bug
        return resolvedImports.filter(Boolean) as any;
    }

    resolve(resolver: IResolver, fileName: string, defPath: string): Promise<string> {
        let result: Promise<string>;

        if (/^[a-z0-9].*\.d\.ts$/.test(defPath)) {
            // Make import relative
            defPath = './' + defPath;
        }

        if (isTypeDeclaration(defPath)) {
            // We MUST NOT resolve symlinks when working with .d.ts files, because/
            // they work whithout module resolution.
            result = Promise.resolve(path.resolve(path.dirname(fileName), defPath));
        } else {
            result = resolver(path.dirname(fileName), defPath)
                .catch(function (error) {
                    // Node builtin modules
                    if (checkIfModuleBuiltIn(defPath)) {
                        return defPath;
                    } else {
                        throw error;
                    }
                });
        }

        return result
            .catch(function (error) {
                let detailedError: any = new ResolutionError();
                detailedError.message = error.message + "\n    Required in " + fileName;
                detailedError.cause = error;
                detailedError.fileName = fileName;

                throw detailedError;
            });
    }
}

let builtInCache = {};

function checkIfModuleBuiltInCached(modPath: string): boolean {
    return !!builtInCache[modPath];
}

function checkIfModuleBuiltIn(modPath: string): boolean {
    if (builtInCache[modPath]) {
        return true;
    }

    try {
        if (require.resolve(modPath) === modPath) {
            builtInCache[modPath] = true;
            return true;
        }
    } catch (e) {
    }

    return false;
}

export interface IDependencyGraphItem {
    fileName: string;
    dependencies: IDependencyGraphItem[];
}

export class DependencyManager {
    dependencies: {[fileName: string]: string[]};
    knownTypeDeclarations: FileSet;
    compiledModules: {[fileName: string]: string[]};

    constructor(dependencies: {[fileName: string]: string[]} = {}, knownTypeDeclarations: FileSet = {}) {
        this.dependencies = dependencies;
        this.knownTypeDeclarations = knownTypeDeclarations;
        this.compiledModules = {};
    }

    clone(): DependencyManager {
        return new DependencyManager(
            _.cloneDeep(this.dependencies),
            _.cloneDeep(this.knownTypeDeclarations)
        );
    }

    addDependency(fileName: string, depFileName: string): void {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }

        this.dependencies[fileName].push(depFileName);
    }

    addCompiledModule(fileName: string, depFileName: string): void {
        if (!this.compiledModules.hasOwnProperty(fileName)) {
            this.clearCompiledModules(fileName);
        }

        let store = this.compiledModules[fileName];

        if (store.indexOf(depFileName) === -1) {
            store.push(depFileName);
        }
    }

    clearDependencies(fileName: string): void {
        this.dependencies[fileName] = [];
    }

    clearCompiledModules(fileName: string): void {
        this.compiledModules[fileName] = [];
    }

    getDependencies(fileName: string): string[] {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }

        return this.dependencies[fileName].slice();
    }

    addTypeDeclaration(fileName: string) {
        this.knownTypeDeclarations[fileName] = true;
    }

    hasTypeDeclaration(fileName: string): boolean {
        return this.knownTypeDeclarations.hasOwnProperty(fileName);
    }

    getTypeDeclarations(): {[fileName: string]: boolean} {
        return objectAssign({}, this.knownTypeDeclarations);
    }

    getDependencyGraph(fileName: string): IDependencyGraphItem {
        let appliedDeps: {[fileName: string]: boolean} = {};
        let result: IDependencyGraphItem = {
            fileName,
            dependencies: []
        };

        let walk = (fileName: string, context: IDependencyGraphItem) => {
            this.getDependencies(fileName).forEach((depFileName) => {
                let depContext = {
                    fileName: depFileName,
                    dependencies: []
                };
                context.dependencies.push(depContext);

                if (!appliedDeps[depFileName]) {
                    appliedDeps[depFileName] = true;
                    walk(depFileName, depContext);
                }
            });
        };

        walk(fileName, result);
        return result;
    }

    applyCompiledFiles(fileName: string, deps: IDependency) {
        if (!this.compiledModules.hasOwnProperty(fileName)) {
            this.clearCompiledModules(fileName);
        }

        this.compiledModules[fileName].forEach((mod) => {
            deps.add(mod);
        });
    }

    applyChain(fileName: string, deps: IDependency) {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }

        let appliedDeps: FileSet = {};
        let graph = this.getDependencyGraph(fileName);

        let walk = (item: IDependencyGraphItem) => {
            let itemFileName = item.fileName;
            if (!appliedDeps[itemFileName]) {
                appliedDeps[itemFileName] = true;
                deps.add(itemFileName);
                item.dependencies.forEach((dep) => walk(dep));
            }
        };

        walk(graph);
    }
}

export class ValidFilesManager {
    files: {[fileName: string]: boolean} = {};

    isFileValid(fileName: string): Promise<boolean> | boolean {
        return this.files[fileName];
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
export class ResolutionError extends Error {
    message: string;
    fileName: string;
    cause: Error;
}
