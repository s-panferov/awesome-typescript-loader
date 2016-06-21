import { State } from './host';

let objectAssign = require('object-assign');

type FileSet = {[fileName: string]: boolean};

export interface IDependency {
    add(fileName: string): void;
    clear(): void;
}

export interface IExternals {
    [key: string]: string;
}

export type Exclude = string[];

export function isTypeDeclaration(fileName: string): boolean {
    return /\.d.ts$/.test(fileName);
}

export class FileAnalyzer {
    dependencies = new DependencyManager();
    validFiles = new ValidFilesManager();
    state: State;

    constructor(state: State) {
        this.state = state;
    }

    checkDependencies(fileName: string, isDefaultLib = false): boolean {
        let isValid = this.validFiles.isFileValid(fileName);
        if (isValid) {
            return isValid;
        }

        this.validFiles.markFileValid(fileName);
        this.dependencies.clearDependencies(fileName);

        let changed = false;

        try {
            if (!this.state.hasFile(fileName)) {
                this.state.readFileAndAdd(fileName, isDefaultLib);
                changed = true;
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
        let isJavaScript = sourceFile.flags & this.state.ts.NodeFlags.JavaScriptFile;
        let info = this.state.ts.preProcessFile(sourceFile.text, true, !!isJavaScript);

        return info.importedFiles
            .map(file => file.fileName)
            .map(depName => this.resolve(fileName, depName))
            .filter(Boolean);
    }

    resolve(fileName: string, depName: string): ts.ResolvedModule {

        if (/^[a-z0-9].*\.d\.ts$/.test(depName)) {
            // Make import relative
            // We need this to be able to resolve directives like
            //
            //      <reference path="lib.d.ts" />
            //
            // with resolver.
            depName = './' + depName;
        }

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

        return resolvedModule;
    }
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
