var _ = require("lodash");
var objectAssign = require('object-assign');
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
    DependencyManager.prototype.applyChain = function (fileName, deps, appliedChains, appliedDeps) {
        var _this = this;
        if (appliedChains === void 0) { appliedChains = {}; }
        if (appliedDeps === void 0) { appliedDeps = {}; }
        if (!this.dependencies.hasOwnProperty(fileName)) {
            this.clearDependencies(fileName);
        }
        appliedChains[fileName] = true;
        if (!appliedChains.hasOwnProperty(".d.ts")) {
            appliedChains[".d.ts"] = true;
            Object.keys(this.knownTypeDeclarations).forEach(function (declFileName) {
                deps.add(declFileName);
            });
        }
        this.getDependencies(fileName).forEach(function (depFileName) {
            if (!appliedDeps.hasOwnProperty(depFileName)) {
                deps.add(depFileName);
                appliedDeps[depFileName] = true;
            }
            if (!appliedChains[depFileName]) {
                _this.applyChain(depFileName, deps, appliedChains, appliedDeps);
            }
        });
    };
    DependencyManager.prototype.recompileReason = function (fileName, changedFiles) {
        var changedFilesSet = {};
        changedFiles.forEach(function (fileName) { return changedFilesSet[fileName] = true; });
        return this.recompileReasonInternal(fileName, changedFilesSet, {});
    };
    DependencyManager.prototype.recompileReasonInternal = function (fileName, changedFilesSet, visitedFiles) {
        var fileDeps = this.getDependencies(fileName);
        var currentVisitedFiles = objectAssign({}, visitedFiles);
        currentVisitedFiles[fileName] = true;
        for (var i = 0; i < fileDeps.length; i++) {
            var depFileName = fileDeps[i];
            if (changedFilesSet.hasOwnProperty(depFileName)) {
                return [depFileName];
            }
            else {
                if (currentVisitedFiles.hasOwnProperty(depFileName)) {
                    continue;
                }
                var internal = this.recompileReasonInternal(depFileName, changedFilesSet, currentVisitedFiles);
                if (internal.length) {
                    return [depFileName].concat(internal);
                }
            }
        }
        return [];
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
//# sourceMappingURL=deps.js.map