var _ = require('lodash');
var util = require('util');
var path = require('path');
var Promise = require('bluebird');
var objectAssign = require('object-assign');
function isTypeDeclaration(fileName) {
    return /\.d.ts$/.test(fileName);
}
var FileAnalyzer = (function () {
    function FileAnalyzer(state) {
        this.dependencies = new DependencyManager();
        this.validFiles = new ValidFilesManager();
        this.state = state;
    }
    FileAnalyzer.prototype.checkDependencies = function (resolver, fileName) {
        var _this = this;
        if (this.validFiles.isFileValid(fileName)) {
            return Promise.resolve();
        }
        this.dependencies.clearDependencies(fileName);
        var flow = this.state.hasFile(fileName) ?
            Promise.resolve(false) :
            this.state.readFileAndUpdate(fileName);
        this.validFiles.markFileValid(fileName);
        return flow
            .then(function () { return _this.checkDependenciesInternal(resolver, fileName); })
            .catch(function (err) {
            _this.validFiles.markFileInvalid(fileName);
            throw err;
        });
    };
    FileAnalyzer.prototype.checkDependenciesInternal = function (resolver, fileName) {
        var _this = this;
        var dependencies = this.findImportDeclarations(fileName)
            .map(function (depRelFileName) {
            return _this.resolve(resolver, fileName, depRelFileName);
        })
            .map(function (depFileNamePromise) { return depFileNamePromise.then(function (depFileName) {
            var result = Promise.resolve(depFileName);
            var isDeclaration = isTypeDeclaration(depFileName);
            var isRequiredJs = /\.js$/.exec(depFileName);
            if (isDeclaration) {
                var hasDeclaration = _this.dependencies.hasTypeDeclaration(depFileName);
                if (!hasDeclaration) {
                    _this.dependencies.addTypeDeclaration(depFileName);
                    return _this.checkDependencies(resolver, depFileName).then(function () { return result; });
                }
            }
            else if (isRequiredJs) {
                return Promise.resolve(null);
            }
            else {
                _this.dependencies.addDependency(fileName, depFileName);
                return _this.checkDependencies(resolver, depFileName);
            }
            return result;
        }); });
        return Promise.all(dependencies).then(function (_) { });
    };
    FileAnalyzer.prototype.findImportDeclarations = function (fileName) {
        var _this = this;
        var node = this.state.services.getSourceFile(fileName);
        var isDeclaration = isTypeDeclaration(fileName);
        var result = [];
        var visit = function (node) {
            if (node.kind === 208) {
                if (!isDeclaration && node.moduleReference.hasOwnProperty("expression")) {
                    result.push(node.moduleReference.expression.text);
                }
            }
            else if (!isDeclaration && node.kind === 209) {
                result.push(node.moduleSpecifier.text);
            }
            else if (node.kind === 227) {
                result = result.concat(node.referencedFiles.map(function (f) {
                    return path.resolve(path.dirname(node.fileName), f.fileName);
                }));
            }
            _this.state.ts.forEachChild(node, visit);
        };
        visit(node);
        return result;
    };
    FileAnalyzer.prototype.resolve = function (resolver, fileName, defPath) {
        var result;
        if (!path.extname(defPath).length) {
            result = resolver(path.dirname(fileName), defPath + ".ts")
                .error(function (error) {
                return resolver(path.dirname(fileName), defPath + ".d.ts");
            })
                .error(function (error) {
                return resolver(path.dirname(fileName), defPath);
            });
        }
        else {
            if (/\.d\.ts$/.test(defPath)) {
                result = Promise.resolve(defPath);
            }
            else {
                result = resolver(path.dirname(fileName), defPath);
            }
        }
        return result
            .error(function (error) {
            var detailedError = new ResolutionError();
            detailedError.message = error.message + "\n    Required in " + fileName;
            detailedError.cause = error;
            detailedError.fileName = fileName;
            throw detailedError;
        });
    };
    return FileAnalyzer;
})();
exports.FileAnalyzer = FileAnalyzer;
var DependencyManager = (function () {
    function DependencyManager(dependencies, knownTypeDeclarations) {
        if (dependencies === void 0) { dependencies = {}; }
        if (knownTypeDeclarations === void 0) { knownTypeDeclarations = {}; }
        this.dependencies = dependencies;
        this.knownTypeDeclarations = knownTypeDeclarations;
    }
    DependencyManager.prototype.clone = function () {
        return new DependencyManager(_.cloneDeep(this.dependencies), _.cloneDeep(this.knownTypeDeclarations));
    };
    DependencyManager.prototype.addDependency = function (fileName, depFileName) {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }
        this.dependencies[fileName].push(depFileName);
    };
    DependencyManager.prototype.clearDependencies = function (fileName) {
        this.dependencies[fileName] = [];
    };
    DependencyManager.prototype.getDependencies = function (fileName) {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }
        return this.dependencies[fileName].slice();
    };
    DependencyManager.prototype.addTypeDeclaration = function (fileName) {
        this.knownTypeDeclarations[fileName] = true;
    };
    DependencyManager.prototype.hasTypeDeclaration = function (fileName) {
        return this.knownTypeDeclarations.hasOwnProperty(fileName);
    };
    DependencyManager.prototype.getTypeDeclarations = function () {
        return objectAssign({}, this.knownTypeDeclarations);
    };
    DependencyManager.prototype.getDependencyGraph = function (fileName) {
        var _this = this;
        var appliedDeps = {};
        var result = {
            fileName: fileName,
            dependencies: []
        };
        var walk = function (fileName, context) {
            _this.getDependencies(fileName).forEach(function (depFileName) {
                var depContext = {
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
    };
    DependencyManager.prototype.formatDependencyGraph = function (item) {
        var result = {
            buf: 'DEPENDENCY GRAPH FOR: ' + path.relative(process.cwd(), item.fileName)
        };
        var walk = function (item, level, buf) {
            for (var i = 0; i < level; i++) {
                buf.buf = buf.buf + "  ";
            }
            buf.buf = buf.buf + path.relative(process.cwd(), item.fileName);
            buf.buf = buf.buf + "\n";
            item.dependencies.forEach(function (dep) { return walk(dep, level + 1, buf); });
        };
        walk(item, 0, result);
        return result.buf += '\n\n';
    };
    DependencyManager.prototype.applyChain = function (fileName, deps) {
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }
        var appliedDeps = {};
        var graph = this.getDependencyGraph(fileName);
        var walk = function (item) {
            var itemFileName = item.fileName;
            if (!appliedDeps[itemFileName]) {
                appliedDeps[itemFileName] = true;
                deps.add(itemFileName);
                item.dependencies.forEach(function (dep) { return walk(dep); });
            }
        };
        walk(graph);
    };
    return DependencyManager;
})();
exports.DependencyManager = DependencyManager;
var ValidFilesManager = (function () {
    function ValidFilesManager() {
        this.files = {};
    }
    ValidFilesManager.prototype.isFileValid = function (fileName) {
        return !!this.files[fileName];
    };
    ValidFilesManager.prototype.markFileValid = function (fileName) {
        this.files[fileName] = true;
    };
    ValidFilesManager.prototype.markFileInvalid = function (fileName) {
        this.files[fileName] = false;
    };
    return ValidFilesManager;
})();
exports.ValidFilesManager = ValidFilesManager;
var ResolutionError = (function () {
    function ResolutionError() {
    }
    return ResolutionError;
})();
exports.ResolutionError = ResolutionError;
util.inherits(ResolutionError, Error);
//# sourceMappingURL=deps.js.map