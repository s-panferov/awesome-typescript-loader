"use strict";

var __awaiter = undefined && undefined.__awaiter || function (thisArg, _arguments, Promise, generator) {
    return new Promise(function (resolve, reject) {
        generator = generator.call(thisArg, _arguments);
        function cast(value) {
            return value instanceof Promise && value.constructor === Promise ? value : new Promise(function (resolve) {
                resolve(value);
            });
        }
        function onfulfill(value) {
            try {
                step("next", value);
            } catch (e) {
                reject(e);
            }
        }
        function onreject(value) {
            try {
                step("throw", value);
            } catch (e) {
                reject(e);
            }
        }
        function step(verb, value) {
            var result = generator[verb](value);
            result.done ? resolve(result.value) : cast(result.value).then(onfulfill, onreject);
        }
        step("next", void 0);
    });
};
var _ = require('lodash');
var path = require('path');
var Promise = require('bluebird');
let objectAssign = require('object-assign');
function createResolver(externals, webpackResolver) {
    let resolver = Promise.promisify(webpackResolver);
    function resolve(base, dep) {
        if (externals && externals.hasOwnProperty(dep)) {
            return Promise.resolve('%%ignore');
        } else {
            return resolver(base, dep);
        }
    }
    return resolve;
}
exports.createResolver = createResolver;
function isTypeDeclaration(fileName) {
    return (/\.d.ts$/.test(fileName)
    );
}
function pathWithoutExt(fileName) {
    let extension = path.extname(fileName);
    return path.join(path.dirname(fileName), path.basename(fileName, extension));
}
function isImportOrExportDeclaration(node) {
    return (!!node.exportClause || !!node.importClause) && node.moduleSpecifier;
}
function isImportEqualsDeclaration(node) {
    return !!node.moduleReference && node.moduleReference.hasOwnProperty('expression');
}
function isSourceFileDeclaration(node) {
    return !!node.referencedFiles;
}
function isIgnoreDependency(absulutePath) {
    return absulutePath == '%%ignore';
}
class FileAnalyzer {
    constructor(state) {
        this.dependencies = new DependencyManager();
        this.validFiles = new ValidFilesManager();
        this.state = state;
    }
    checkDependencies(resolver, fileName) {
        return __awaiter(this, void 0, Promise, function* () {
            if (this.validFiles.isFileValid(fileName)) {
                return false;
            }
            this.validFiles.markFileValid(fileName);
            this.dependencies.clearDependencies(fileName);
            let changed = false;
            try {
                if (!this.state.hasFile(fileName)) {
                    changed = yield this.state.readFileAndUpdate(fileName);
                }
                yield this.checkDependenciesInternal(resolver, fileName);
            } catch (err) {
                this.validFiles.markFileInvalid(fileName);
                throw err;
            }
            return changed;
        });
    }
    checkDependenciesInternal(resolver, fileName) {
        return __awaiter(this, void 0, Promise, function* () {
            let imports = yield this.findImportDeclarations(resolver, fileName);
            let tasks = [];
            for (let importPath of imports) {
                let isDeclaration = isTypeDeclaration(importPath);
                let isRequiredJs = /\.js$/.exec(importPath) || importPath.indexOf('.') === -1;
                if (isDeclaration) {
                    let hasDeclaration = this.dependencies.hasTypeDeclaration(importPath);
                    if (!hasDeclaration) {
                        this.dependencies.addTypeDeclaration(importPath);
                        tasks.push(this.checkDependencies(resolver, importPath));
                    }
                } else if (isRequiredJs) {
                    continue;
                } else {
                    this.dependencies.addDependency(fileName, importPath);
                    tasks.push(this.checkDependencies(resolver, importPath));
                }
            }
            yield Promise.all(tasks);
            return null;
        });
    }
    findImportDeclarations(resolver, fileName) {
        return __awaiter(this, void 0, Promise, function* () {
            let sourceFile = this.state.services.getSourceFile(fileName);
            let scriptSnapshot = sourceFile.scriptSnapshot.text;
            let isDeclaration = isTypeDeclaration(fileName);
            let resolves = [];
            let imports = [];
            let visit = node => {
                if (!isDeclaration && isImportEqualsDeclaration(node)) {
                    let importPath = node.moduleReference.expression.text;
                    imports.push(importPath);
                } else if (!isDeclaration && isImportOrExportDeclaration(node)) {
                    let importPath = node.moduleSpecifier.text;
                    imports.push(importPath);
                }
            };
            imports.push.apply(imports, sourceFile.referencedFiles.map(file => file.fileName));
            this.state.ts.forEachChild(sourceFile, visit);
            let task = imports.map(importPath => __awaiter(this, void 0, Promise, function* () {
                let absolutePath = yield this.resolve(resolver, fileName, importPath);
                if (!isIgnoreDependency(absolutePath)) {
                    return absolutePath;
                }
            }));
            let resolvedImports = yield Promise.all(task);
            return resolvedImports.filter(Boolean);
        });
    }
    resolve(resolver, fileName, defPath) {
        let result;
        if (!path.extname(defPath).length) {
            result = resolver(path.dirname(fileName), defPath + ".ts").error(function (error) {
                return resolver(path.dirname(fileName), defPath + ".d.ts");
            }).error(function (error) {
                return resolver(path.dirname(fileName), defPath);
            }).error(function (error) {
                try {
                    if (require.resolve(defPath) == defPath) {
                        return defPath;
                    } else {
                        throw error;
                    }
                } catch (e) {
                    throw error;
                }
            });
        } else {
            if (/^[a-z0-9].*\.d\.ts$/.test(defPath)) {
                defPath = './' + defPath;
            }
            result = resolver(path.dirname(fileName), defPath);
        }
        return result.error(function (error) {
            let detailedError = new ResolutionError();
            detailedError.message = error.message + "\n    Required in " + fileName;
            detailedError.cause = error;
            detailedError.fileName = fileName;
            throw detailedError;
        });
    }
}
exports.FileAnalyzer = FileAnalyzer;
class DependencyManager {
    constructor() {
        let dependencies = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];
        let knownTypeDeclarations = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

        this.dependencies = dependencies;
        this.knownTypeDeclarations = knownTypeDeclarations;
        this.compiledModules = {};
    }
    clone() {
        return new DependencyManager(_.cloneDeep(this.dependencies), _.cloneDeep(this.knownTypeDeclarations));
    }
    addDependency(fileName, depFileName) {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }
        this.dependencies[fileName].push(depFileName);
    }
    addCompiledModule(fileName, depFileName) {
        if (!this.compiledModules.hasOwnProperty(fileName)) {
            this.clearCompiledModules(fileName);
        }
        let store = this.compiledModules[fileName];
        if (store.indexOf(depFileName) === -1) {
            store.push(depFileName);
        }
    }
    clearDependencies(fileName) {
        this.dependencies[fileName] = [];
    }
    clearCompiledModules(fileName) {
        this.compiledModules[fileName] = [];
    }
    getDependencies(fileName) {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }
        return this.dependencies[fileName].slice();
    }
    addTypeDeclaration(fileName) {
        this.knownTypeDeclarations[fileName] = true;
    }
    hasTypeDeclaration(fileName) {
        return this.knownTypeDeclarations.hasOwnProperty(fileName);
    }
    getTypeDeclarations() {
        return objectAssign({}, this.knownTypeDeclarations);
    }
    getDependencyGraph(fileName) {
        let appliedDeps = {};
        let result = {
            fileName,
            dependencies: []
        };
        let walk = (fileName, context) => {
            this.getDependencies(fileName).forEach(depFileName => {
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
    applyCompiledFiles(fileName, deps) {
        if (!this.compiledModules.hasOwnProperty(fileName)) {
            this.clearCompiledModules(fileName);
        }
        this.compiledModules[fileName].forEach(mod => {
            deps.add(mod);
        });
    }
    applyChain(fileName, deps) {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }
        let appliedDeps = {};
        let graph = this.getDependencyGraph(fileName);
        let walk = item => {
            let itemFileName = item.fileName;
            if (!appliedDeps[itemFileName]) {
                appliedDeps[itemFileName] = true;
                deps.add(itemFileName);
                item.dependencies.forEach(dep => walk(dep));
            }
        };
        walk(graph);
    }
}
exports.DependencyManager = DependencyManager;
class ValidFilesManager {
    constructor() {
        this.files = {};
    }
    isFileValid(fileName) {
        return !!this.files[fileName];
    }
    markFileValid(fileName) {
        this.files[fileName] = true;
    }
    markFileInvalid(fileName) {
        this.files[fileName] = false;
    }
}
exports.ValidFilesManager = ValidFilesManager;
class ResolutionError extends Error {}
exports.ResolutionError = ResolutionError;
//# sourceMappingURL=deps.js.map