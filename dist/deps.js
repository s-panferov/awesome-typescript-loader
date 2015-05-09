var _ = require("lodash");
var objectAssign = require('object-assign');
var DependencyManager = (function () {
    function DependencyManager(dependencies, knownTypeDeclarations) {
        if (dependencies === void 0) { dependencies = {}; }
        if (knownTypeDeclarations === void 0) { knownTypeDeclarations = {}; }
        this.indirectImports = [];
        this.dependencies = dependencies;
        this.knownTypeDeclarations = knownTypeDeclarations;
    }
    DependencyManager.prototype.clone = function () {
        return new DependencyManager(_.cloneDeep(this.dependencies), _.cloneDeep(this.knownTypeDeclarations));
    };
    DependencyManager.prototype.addIndirectImport = function (fileName) {
        this.indirectImports.push(fileName);
    };
    DependencyManager.prototype.clearIndirectImports = function () {
        this.indirectImports = [];
    };
    DependencyManager.prototype.getIndirectImports = function () {
        var imports = this.indirectImports;
        this.clearIndirectImports();
        return imports;
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
        this.getDependencies(fileName).concat(this.getIndirectImports()).forEach(function (depFileName) {
            if (!appliedDeps.hasOwnProperty(depFileName)) {
                deps.add(depFileName);
                appliedDeps[depFileName] = true;
            }
            if (!appliedChains[depFileName]) {
                _this.applyChain(depFileName, deps, appliedChains, appliedDeps);
            }
        });
    };
    return DependencyManager;
})();
exports.DependencyManager = DependencyManager;
//# sourceMappingURL=deps.js.map