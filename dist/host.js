var fs = require('fs');
var util = require('util');
var path = require('path');
var Promise = require('bluebird');
var helpers = require('./helpers');
var deps = require('./deps');
var objectAssign = require('object-assign');
var RUNTIME = helpers.loadLib('./runtime.d.ts');
var LIB = helpers.loadLib('typescript/bin/lib.d.ts');
var LIB6 = helpers.loadLib('typescript/bin/lib.es6.d.ts');
var Host = (function () {
    function Host(state) {
        this.state = state;
    }
    Host.prototype.getScriptFileNames = function () {
        return Object.keys(this.state.files);
    };
    Host.prototype.getScriptVersion = function (fileName) {
        return this.state.files[fileName] && this.state.files[fileName].version.toString();
    };
    Host.prototype.getScriptSnapshot = function (fileName) {
        var file = this.state.files[fileName];
        if (!file) {
            return null;
        }
        return {
            getText: function (start, end) {
                return file.text.substring(start, end);
            },
            getLength: function () {
                return file.text.length;
            },
            getLineStartPositions: function () {
                return [];
            },
            getChangeRange: function (oldSnapshot) {
                return undefined;
            }
        };
    };
    Host.prototype.getCurrentDirectory = function () {
        return process.cwd();
    };
    Host.prototype.getScriptIsOpen = function () {
        return true;
    };
    Host.prototype.getCompilationSettings = function () {
        return this.state.options;
    };
    Host.prototype.getDefaultLibFileName = function (options) {
        return options.target === 2 ? LIB6.fileName : LIB.fileName;
    };
    Host.prototype.log = function (message) {
    };
    return Host;
})();
exports.Host = Host;
function isTypeDeclaration(fileName) {
    return /\.d.ts$/.test(fileName);
}
var State = (function () {
    function State(options, fsImpl, tsImpl) {
        this.files = {};
        this.dependencies = new deps.DependencyManager();
        this.validFiles = new deps.ValidFilesManager();
        this.currentDependenciesLookup = null;
        this.ts = tsImpl || require('typescript');
        this.fs = fsImpl;
        this.host = new Host(this);
        this.services = this.ts.createLanguageService(this.host, this.ts.createDocumentRegistry());
        this.options = {};
        this.runtimeRead = false;
        objectAssign(this.options, {
            target: 1,
            module: 1,
            sourceMap: true,
            verbose: false
        });
        objectAssign(this.options, options);
        if (this.options.emitRequireType) {
            this.addFile(RUNTIME.fileName, RUNTIME.text);
        }
        if (this.options.target === 2 || this.options.library === 'es6') {
            this.addFile(LIB6.fileName, LIB6.text);
        }
        else {
            this.addFile(LIB.fileName, LIB.text);
        }
    }
    State.prototype.resetService = function () {
        this.services = this.ts.createLanguageService(this.host, this.ts.createDocumentRegistry());
    };
    State.prototype.resetProgram = function () {
        this.program = null;
    };
    State.prototype.updateProgram = function () {
        this.program = this.services.getProgram();
    };
    State.prototype.emit = function (fileName) {
        if (!this.runtimeRead) {
            this.runtimeRead = true;
        }
        if (!this.program) {
            this.program = this.services.getProgram();
        }
        var outputFiles = [];
        function writeFile(fileName, data, writeByteOrderMark) {
            outputFiles.push({
                name: fileName,
                writeByteOrderMark: writeByteOrderMark,
                text: data
            });
        }
        var normalizedFileName = this.normalizePath(fileName);
        var source = this.program.getSourceFile(normalizedFileName);
        if (!source) {
            this.updateProgram();
            source = this.program.getSourceFile(normalizedFileName);
            if (!source) {
                throw new Error("File " + normalizedFileName + " was not found in program");
            }
        }
        var emitResult = this.program.emit(source, writeFile);
        var output = {
            outputFiles: outputFiles,
            emitSkipped: emitResult.emitSkipped
        };
        if (!output.emitSkipped) {
            return output;
        }
        else {
            throw new Error("Emit skipped");
        }
    };
    State.prototype.checkDependencies = function (resolver, fileName) {
        var _this = this;
        if (this.validFiles.isFileValid(fileName)) {
            return Promise.resolve();
        }
        this.dependencies.clearDependencies(fileName);
        var flow = this.hasFile(fileName) ?
            Promise.resolve(false) :
            this.readFileAndUpdate(fileName);
        this.validFiles.markFileValid(fileName);
        return flow
            .then(function () { return _this.checkDependenciesInternal(resolver, fileName); })
            .catch(function (err) {
            _this.validFiles.markFileInvalid(fileName);
            throw err;
        });
    };
    State.prototype.checkDependenciesInternal = function (resolver, fileName) {
        var _this = this;
        var dependencies = this.findImportDeclarations(fileName)
            .map(function (depRelFileName) {
            return _this.resolve(resolver, fileName, depRelFileName);
        })
            .map(function (depFileNamePromise) { return depFileNamePromise.then(function (depFileName) {
            var result = Promise.resolve(depFileName);
            var isDeclaration = isTypeDeclaration(depFileName);
            var isRequiredModule = /\.js$/.exec(depFileName);
            if (isDeclaration) {
                var hasDeclaration = _this.dependencies.hasTypeDeclaration(depFileName);
                if (!hasDeclaration) {
                    _this.dependencies.addTypeDeclaration(depFileName);
                    return _this.checkDependencies(resolver, depFileName).then(function () { return result; });
                }
            }
            else if (isRequiredModule) {
                return Promise.resolve(null);
            }
            else {
                return Promise.resolve(null);
            }
            return result;
        }); });
        return Promise.all(dependencies).then(function (_) { });
    };
    State.prototype.findImportDeclarations = function (fileName) {
        var _this = this;
        var node = this.services.getSourceFile(fileName);
        var isDeclaration = isTypeDeclaration(fileName);
        var result = [];
        var visit = function (node) {
            if (node.kind === 227) {
                result = result.concat(node.referencedFiles.map(function (f) {
                    return path.resolve(path.dirname(node.fileName), f.fileName);
                }));
            }
            _this.ts.forEachChild(node, visit);
        };
        visit(node);
        return result;
    };
    State.prototype.updateFile = function (fileName, text, checked) {
        if (checked === void 0) { checked = false; }
        var prevFile = this.files[fileName];
        var version = 0;
        var changed = true;
        if (prevFile) {
            if (!checked || (checked && text !== prevFile.text)) {
                version = prevFile.version + 1;
            }
            else {
                changed = false;
            }
        }
        this.files[fileName] = {
            text: text,
            version: version
        };
        return changed;
    };
    State.prototype.addFile = function (fileName, text) {
        this.files[fileName] = {
            text: text,
            version: 0
        };
    };
    State.prototype.hasFile = function (fileName) {
        return this.files.hasOwnProperty(fileName);
    };
    State.prototype.readFile = function (fileName) {
        var readFile = Promise.promisify(this.fs.readFile.bind(this.fs));
        return readFile(fileName).then(function (buf) {
            return buf.toString('utf8');
        });
    };
    State.prototype.readFileSync = function (fileName) {
        return fs.readFileSync(fileName, { encoding: 'utf-8' });
    };
    State.prototype.readFileAndAdd = function (fileName) {
        var _this = this;
        return this.readFile(fileName).then(function (text) { return _this.addFile(fileName, text); });
    };
    State.prototype.readFileAndUpdate = function (fileName, checked) {
        var _this = this;
        if (checked === void 0) { checked = false; }
        return this.readFile(fileName).then(function (text) { return _this.updateFile(fileName, text, checked); });
    };
    State.prototype.readFileAndUpdateSync = function (fileName, checked) {
        if (checked === void 0) { checked = false; }
        var text = this.readFileSync(fileName);
        return this.updateFile(fileName, text, checked);
    };
    State.prototype.normalizePath = function (path) {
        return this.ts.normalizePath(path);
    };
    State.prototype.resolve = function (resolver, fileName, defPath) {
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
    return State;
})();
exports.State = State;
function TypeScriptCompilationError(diagnostics) {
    this.diagnostics = diagnostics;
}
exports.TypeScriptCompilationError = TypeScriptCompilationError;
util.inherits(TypeScriptCompilationError, Error);
var ResolutionError = (function () {
    function ResolutionError() {
    }
    return ResolutionError;
})();
exports.ResolutionError = ResolutionError;
util.inherits(ResolutionError, Error);
//# sourceMappingURL=host.js.map