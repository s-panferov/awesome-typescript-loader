import { State } from './host';
import { withoutTypeScriptExtension } from './helpers';
import * as path from 'path';
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
            this.checkDependencies(imp);
        });

        return null;
    }

    findImportDeclarations(fileName: string)  {
        let sourceFile = this.state.getSourceFile(fileName);
        let isJavaScript = sourceFile.flags & this.state.ts.NodeFlags.JavaScriptFile;
        let info = this.state.ts.preProcessFile(sourceFile.text, true, !!isJavaScript);
        let options = this.state.compilerConfig.options;
        let ts = this.state.ts;
        let deps = this.state.fileAnalyzer.dependencies;
        let imports: string[] = [];

        imports.push.apply(imports, info.importedFiles
            .map(file => file.fileName)
            .map(depName => {
                let moduleName = withoutTypeScriptExtension(depName);
                let { resolvedModule } = ts.resolveModuleName(moduleName, fileName, options, ts.sys);
                if (resolvedModule) {
                    deps.addModuleResolution(fileName, depName, resolvedModule);
                    return resolvedModule.resolvedFileName;
                }
            })
            .filter(Boolean));

        imports.push.apply(imports, info.referencedFiles
            .map(file => file.fileName)
            .map(depName => {
                let relative = /^[a-z0-9].*\.d\.ts$/.test(depName)
                    ? './' + depName
                    : depName;
                return path.resolve(path.dirname(fileName), relative);
            })
            .map(depName => {
                let moduleName = withoutTypeScriptExtension(depName);
                let { resolvedModule } = ts.classicNameResolver(moduleName, fileName, options, ts.sys);
                if (resolvedModule) {
                    deps.addModuleResolution(fileName, depName, resolvedModule);
                    // return non-realpath name (symlinks not resolved)
                    return depName;
                }
            })
            .filter(Boolean));

        if (info.typeReferenceDirectives) {
            imports.push.apply(imports, info.typeReferenceDirectives
                .map(file => file.fileName)
                .map(depName => {
                    let { resolvedTypeReferenceDirective } = ts.resolveTypeReferenceDirective(depName, fileName, options, ts.sys);
                    if (resolvedTypeReferenceDirective) {
                        deps.addTypeReferenceResolution(fileName, depName, resolvedTypeReferenceDirective);
                        return resolvedTypeReferenceDirective.resolvedFileName;
                    }
                })
                .filter(Boolean));
        }

        return imports;
    }
}

export interface IDependencyGraphItem {
    fileName: string;
    dependencies: IDependencyGraphItem[];
}

export class DependencyManager {
    dependencies: {[fileName: string]: string[]} = {};
    moduleResolutions: {[cacheKey: string]: ts.ResolvedModule} = {};
    typeReferenceResolutions: {[cacheKey: string]: ts.ResolvedTypeReferenceDirective} = {};
    compiledModules: {[fileName: string]: string[]} = {};

    addModuleResolution(fileName: string, depName: string, resolvedModule: ts.ResolvedModule) {
        this.moduleResolutions[`${fileName}::${depName}`] = resolvedModule;
    }

    addTypeReferenceResolution(fileName: string, depName: string, resolvedModule: ts.ResolvedTypeReferenceDirective) {
        this.typeReferenceResolutions[`${fileName}::${depName}`] = resolvedModule;
    }

    getModuleResolution(fileName: string, depName: string): ts.ResolvedModule {
        return this.moduleResolutions[`${fileName}::${depName}`];
    }

    getTypeReferenceResolution(fileName: string, depName: string): ts.ResolvedTypeReferenceDirective {
        return this.typeReferenceResolutions[`${fileName}::${depName}`];
    }

    addDependency(fileName: string, dep: string): void {
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

    getDependencies(fileName: string): string[] {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }

        return this.dependencies[fileName].slice();
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
