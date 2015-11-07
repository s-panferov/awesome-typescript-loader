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
var colors = require('colors');
(function (MessageType) {
    MessageType[MessageType["Init"] = 'init'] = "Init";
    MessageType[MessageType["Compile"] = 'compile'] = "Compile";
})(exports.MessageType || (exports.MessageType = {}));
var MessageType = exports.MessageType;
let env = {};
class Host {
    getScriptFileNames() {
        return Object.keys(env.files);
    }
    getScriptVersion(fileName) {
        if (env.files[fileName]) {
            return env.files[fileName].version.toString();
        }
    }
    getScriptSnapshot(fileName) {
        let file = env.files[fileName];
        if (file) {
            return env.compiler.ScriptSnapshot.fromString(file.text);
        }
    }
    getCurrentDirectory() {
        return process.cwd();
    }
    getScriptIsOpen() {
        return true;
    }
    getCompilationSettings() {
        return env.options;
    }
    resolveModuleNames(moduleNames, containingFile) {
        let resolvedModules = [];
        for (let moduleName of moduleNames) {
            resolvedModules.push(env.resolutionCache[`${ containingFile }::${ moduleName }`]);
        }
        return resolvedModules;
    }
    getDefaultLibFileName(options) {
        return options.target === env.compiler.ScriptTarget.ES6 ? env.compilerInfo.lib6.fileName : env.compilerInfo.lib5.fileName;
    }
    log(message) {}
}
exports.Host = Host;
function processInit(payload) {
    env.compiler = require(payload.compilerInfo.compilerName);
    env.host = new Host();
    env.compilerInfo = payload.compilerInfo;
    env.options = payload.compilerOptions;
    env.service = env.compiler.createLanguageService(env.host, env.compiler.createDocumentRegistry());
}
function processCompile(payload) {
    let instanceName = env.options.instanceName || 'default';
    let silent = !!env.options.forkCheckerSilent;
    if (!silent) {
        console.log(colors.cyan(`[${ instanceName }] Checking started in a separate process...`));
    }
    let timeStart = +new Date();
    process.send({
        messageType: 'progress',
        payload: {
            inProgress: true
        }
    });
    env.files = payload.files;
    env.resolutionCache = payload.resolutionCache;
    let program = env.program = env.service.getProgram();
    let allDiagnostics = env.compiler.getPreEmitDiagnostics(program);
    if (allDiagnostics.length) {
        allDiagnostics.forEach(diagnostic => {
            let message = env.compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            if (diagnostic.file) {
                var _diagnostic$file$getL = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);

                let line = _diagnostic$file$getL.line;
                let character = _diagnostic$file$getL.character;

                console.error(`[${ instanceName }] ${ colors.red(diagnostic.file.fileName) } (${ line + 1 },${ character + 1 }):\n    ${ colors.red(message) }`);
            } else {
                console.error(colors.red(`[${ instanceName }] ${ message }`));
            }
        });
    } else {
        if (!silent) {
            let timeEnd = +new Date();
            console.log(colors.green(`[${ instanceName }] Ok, ${ (timeEnd - timeStart) / 1000 } sec.`));
        }
    }
    process.send({
        messageType: 'progress',
        payload: {
            inProgress: false
        }
    });
}
process.on('message', function (msg) {
    switch (msg.messageType) {
        case MessageType.Init:
            processInit(msg.payload);
            break;
        case MessageType.Compile:
            processCompile(msg.payload);
            break;
    }
});
//# sourceMappingURL=checker-runtime.js.map