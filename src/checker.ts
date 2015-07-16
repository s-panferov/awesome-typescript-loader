import { CompilerOptions, CompilerInfo, File } from './host';
import * as colors from 'colors';

export enum MessageType {
    Init = <any>'init',
    Compile = <any>'compile'
}

export interface IMessage {
    messageType: MessageType,
    payload: any
}

export interface IInitPayload {
    compilerOptions: CompilerOptions;
    compilerInfo: CompilerInfo
}

export interface ICompilePayload {
    files: {[fileName: string]: File};
}

export interface IEnv {
    options?: CompilerOptions;
    compiler?: typeof ts;
    compilerInfo?: CompilerInfo;
    host?: Host;
    files?: {[fileName: string]: File};
    program?: ts.Program;
    service?: ts.LanguageService;
}

let env: IEnv = {};

export class Host implements ts.LanguageServiceHost {

    getScriptFileNames() {
        return Object.keys(env.files);
    }

    getScriptVersion(fileName: string) {
        if (env.files[fileName]) {
            return env.files[fileName].version.toString();
        }
    }

    getScriptSnapshot(fileName) {
        var file = env.files[fileName];
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

    getDefaultLibFileName(options) {
        return options.target === ts.ScriptTarget.ES6 ?
            env.compilerInfo.lib6.fileName :
            env.compilerInfo.lib5.fileName;
    }

    log(message) {
        //console.log(message);
    }

}

function processInit(payload: IInitPayload) {
    env.compiler = require(payload.compilerInfo.compilerName);
    env.host = new Host();
    env.compilerInfo = payload.compilerInfo;
    env.options = payload.compilerOptions;
    env.service = this.ts.createLanguageService(env.host, env.compiler.createDocumentRegistry());
}

function processCompile(payload: ICompilePayload) {
    env.files = payload.files;
    let program = env.program = env.service.getProgram();
    var allDiagnostics = env.compiler.getPreEmitDiagnostics(program);
    if (allDiagnostics.length) {
        console.error(colors.yellow('Checker diagnostics:'))
        allDiagnostics.forEach(diagnostic => {
            var { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
            var message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            console.error(`${colors.cyan(diagnostic.file.fileName)} (${line + 1},${character + 1}):\n    ${colors.red(message)}`);
        });
    } else {
        console.error(colors.green('Your program is fine!'))
    }

}

process.on('message', function(msg: IMessage) {
    switch (msg.messageType) {
        case MessageType.Init:
            processInit(msg.payload);
            break;
        case MessageType.Compile:
            processCompile(msg.payload);
            break;
    }
});
