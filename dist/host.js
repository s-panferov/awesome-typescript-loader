var fs = require('fs');
var util = require('util');
var Promise = require('bluebird');
var deps_1 = require('./deps');
var helpers_1 = require('./helpers');
var objectAssign = require('object-assign');
var RUNTIME = helpers_1.loadLib('../lib/runtime.d.ts');
var Host = (function () {
    function Host(state) {
        this.state = state;
    }
    Host.prototype.getScriptFileNames = function () {
        return Object.keys(this.state.files);
    };
    Host.prototype.getScriptVersion = function (fileName) {
        if (this.state.files[fileName]) {
            return this.state.files[fileName].version.toString();
        }
    };
    Host.prototype.getScriptSnapshot = function (fileName) {
        var file = this.state.files[fileName];
        if (file) {
            return this.state.ts.ScriptSnapshot.fromString(file.text);
        }
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
        return options.target === 2 ?
            this.state.compilerInfo.lib6.fileName :
            this.state.compilerInfo.lib5.fileName;
    };
    Host.prototype.log = function (message) {
    };
    return Host;
})();
exports.Host = Host;
var State = (function () {
    function State(options, fsImpl, compilerInfo) {
        this.files = {};
        this.ts = compilerInfo.tsImpl;
        this.compilerInfo = compilerInfo;
        this.fs = fsImpl;
        this.host = new Host(this);
        this.services = this.ts.createLanguageService(this.host, this.ts.createDocumentRegistry());
        this.fileAnalyzer = new deps_1.FileAnalyzer(this);
        this.options = {};
        objectAssign(this.options, {
            target: 1,
            sourceMap: true,
            verbose: false
        });
        objectAssign(this.options, options);
        if (this.options.emitRequireType) {
            this.addFile(RUNTIME.fileName, RUNTIME.text);
        }
        if (!this.options.noLib) {
            if (this.options.target === 2 || this.options.library === 'es6') {
                this.addFile(this.compilerInfo.lib6.fileName, this.compilerInfo.lib6.text);
            }
            else {
                this.addFile(this.compilerInfo.lib5.fileName, this.compilerInfo.lib5.text);
            }
        }
        this.updateProgram();
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
        if (!this.program) {
            this.program = this.services.getProgram();
        }
        var outputFiles = [];
        var normalizedFileName = this.normalizePath(fileName);
        function writeFile(fileName, data, writeByteOrderMark) {
            outputFiles.push({
                sourceName: normalizedFileName,
                name: fileName,
                writeByteOrderMark: writeByteOrderMark,
                text: data
            });
        }
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
    return State;
})();
exports.State = State;
function TypeScriptCompilationError(diagnostics) {
    this.diagnostics = diagnostics;
}
exports.TypeScriptCompilationError = TypeScriptCompilationError;
util.inherits(TypeScriptCompilationError, Error);
//# sourceMappingURL=host.js.map