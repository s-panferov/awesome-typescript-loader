import _ = require("lodash");

var objectAssign = require('object-assign');

type FileSet = {[fileName: string]: boolean};

export interface Dependency {
    add(fileName: string): void;
    clear(): void
}

export class DependencyManager {
    dependencies: {[fileName: string]: string[]}
    knownTypeDeclarations: FileSet

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

    applyChain(fileName: string, deps: Dependency, appliedChains: FileSet = {}, appliedDeps: FileSet = {}) {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }

        appliedChains[fileName] = true;

        if (!appliedChains.hasOwnProperty(".d.ts")) {
            appliedChains[".d.ts"] = true;
            Object.keys(this.knownTypeDeclarations).forEach((declFileName) => {
                deps.add(declFileName)
            })
        }

        this.getDependencies(fileName).forEach((depFileName) => {
            if (!appliedDeps.hasOwnProperty(depFileName)) {
                deps.add(depFileName);
                appliedDeps[depFileName] = true;
            }

            if (!appliedChains[depFileName]) {
                this.applyChain(depFileName, deps, appliedChains, appliedDeps);
            }
        })
    }

    recompileReason(fileName: string, changedFiles: string[]): string[] {
        var changedFilesSet: FileSet = {};
        changedFiles.forEach(fileName => changedFilesSet[fileName] = true);
        return this.recompileReasonInternal(fileName, changedFilesSet, {});
    }

    private recompileReasonInternal(fileName: string, changedFilesSet: FileSet, visitedFiles: FileSet): string[] {
        var fileDeps = this.getDependencies(fileName);

        var currentVisitedFiles = objectAssign({}, visitedFiles);
        currentVisitedFiles[fileName] = true;

        for (var i = 0; i < fileDeps.length; i++) {
            var depFileName = fileDeps[i];

            if (changedFilesSet.hasOwnProperty(depFileName)) {
                return [depFileName];
            } else {
                if (currentVisitedFiles.hasOwnProperty(depFileName)) {
                    continue;
                }
                var internal = this.recompileReasonInternal(depFileName, changedFilesSet, currentVisitedFiles);
                if (internal.length) {
                    return [depFileName].concat(internal)
                }
            }
        }

        return [];
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