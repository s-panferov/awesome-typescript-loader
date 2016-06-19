import * as _ from 'lodash';
import * as path from 'path';
import { State } from './host';

let objectAssign = require('object-assign');

type FileSet = {[fileName: string]: boolean};

export interface SyncResolver {
    (base: string, dep: string): string;
}

export interface IDependency {
    add(fileName: string): void;
    clear(): void;
}

export interface IExternals {
    [key: string]: string;
}

export type Exclude = string[];

export function createIgnoringResolver(
    externals: IExternals,
    exclude: Exclude,
    resolver: SyncResolver,
): SyncResolver {
    function resolve(base: string, dep: string): string {
        let inWebpackExternals = externals && externals.hasOwnProperty(dep);
        let inTypeScriptExclude = false;

        if ((inWebpackExternals || inTypeScriptExclude)) {
            return '%%ignore';
        } else {
            let resultPath = resolver(base, dep);
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
        }
    }

    return resolve;
}

export function isTypeDeclaration(fileName: string): boolean {
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

export class FileAnalyzer {
    dependencies = new DependencyManager();
    validFiles = new ValidFilesManager();
    state: State;

    constructor(state: State) {
        this.state = state;
    }

    checkDependencies(fileName: string): boolean {
        let isValid = this.validFiles.isFileValid(fileName);
        if (isValid) {
            return isValid;
        }

        this.validFiles.markFileValid(fileName);
        this.dependencies.clearDependencies(fileName);

        let changed = false;

        try {
            if (!this.state.hasFile(fileName)) {
                changed = this.state.readFileAndUpdate(fileName);
            }
            this.checkDependenciesInternal(fileName);
        } catch (err) {
            this.validFiles.markFileInvalid(fileName);
            throw err;
        }

        return changed;
    }

    checkDependenciesInternal(fileName: string): void {
        let imports = this.findImportDeclarations(fileName);

        imports.forEach(imp => {
            this.dependencies.addDependency(fileName, imp);
            this.checkDependencies(imp.resolvedFileName);
        });

        return null;
    }

    findImportDeclarations(fileName: string): ts.ResolvedModule[] {
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

        let resolvedImports = imports.map((importPath) => {
            return this.resolve(fileName, importPath);
        });

        return resolvedImports.filter(Boolean);
    }

    resolve(fileName: string, depName: string): ts.ResolvedModule {
        let resolution = this.state.ts.resolveModuleName(
            depName,
            fileName,
            this.state.compilerConfig.options,
            this.state.ts.sys
        );

        let { resolvedModule } = resolution;

        if (resolvedModule) {
            this.state.fileAnalyzer.dependencies.addResolution(fileName, depName, resolvedModule);
        }

        console.log(
            fileName,'\n',
            depName, '\n',
            resolvedModule && resolvedModule.resolvedFileName, '\n',
            !resolvedModule && resolution.failedLookupLocations, '\n\n');

        return resolvedModule;
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
    dependencies: {[fileName: string]: ts.ResolvedModule[]};
    resolutions: {[cacheKey: string]: ts.ResolvedModule};
    knownTypeDeclarations: FileSet;
    compiledModules: {[fileName: string]: string[]};

    constructor() {
        this.dependencies = {};
        this.knownTypeDeclarations = {};
        this.compiledModules = {};
        this.resolutions = {};
    }

    addResolution(fileName: string, depName: string, resolvedModule: ts.ResolvedModule) {
        this.resolutions[`${fileName}::${depName}`] = resolvedModule;
    }

    getResolution(fileName: string, depName: string): ts.ResolvedModule {
        return this.resolutions[`${fileName}::${depName}`];
    }

    addDependency(fileName: string, dep: ts.ResolvedModule): void {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }

        this.dependencies[fileName].push(dep);
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

    getDependencies(fileName: string): ts.ResolvedModule[] {
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
            this.getDependencies(fileName).forEach((dep) => {
                let fileName = dep.resolvedFileName;
                let depContext = {
                    fileName: dep.resolvedFileName,
                    dependencies: []
                };
                context.dependencies.push(depContext);

                if (!appliedDeps[fileName]) {
                    appliedDeps[fileName] = true;
                    walk(fileName, depContext);
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

    isFileValid(fileName: string): boolean {
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
