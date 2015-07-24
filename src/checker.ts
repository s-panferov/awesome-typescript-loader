import { ICompilerOptions, ICompilerInfo, IFile } from './host';
import * as colors from 'colors';
import * as _ from 'lodash';

const AWESOME_SYNONYMS = [
    'awesome',
    'impressive',
    'amazing',
    'grand',
    'majestic',
    'magnificent',
    'wonderful',
    'great',
    'marvellous',
    'incredible',
    'fabulous',
    'outstanding',
    'unbelievable',
    'beautiful',
    'excellent',
    'mind-blowing',
    'superb',
    'badass',
    'brilliant',
    'exciting',
    'eye-opening',
    'fucking good',
    'fine',
    'perfect',
    'cool',
    'fantastical',
    'five-star'
];

export enum MessageType {
    Init = <any>'init',
    Compile = <any>'compile'
}

export interface IMessage {
    messageType: MessageType,
    payload: any
}

export interface IInitPayload {
    compilerOptions: ICompilerOptions;
    compilerInfo: ICompilerInfo
}

export interface ICompilePayload {
    files: {[fileName: string]: IFile};
}

export interface IEnv {
    options?: ICompilerOptions;
    compiler?: typeof ts;
    compilerInfo?: ICompilerInfo;
    host?: Host;
    files?: {[fileName: string]: IFile};
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
    env.service = env.compiler.createLanguageService(env.host, env.compiler.createDocumentRegistry());
}

function processCompile(payload: ICompilePayload) {
    env.files = payload.files;
    let program = env.program = env.service.getProgram();
    let allDiagnostics = env.compiler.getPreEmitDiagnostics(program);
    if (allDiagnostics.length) {
        console.error(colors.yellow('Checker diagnostics:'))
        allDiagnostics.forEach(diagnostic => {
            let message = env.compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

            if (diagnostic.file) {
                let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
                console.error(`${colors.cyan(diagnostic.file.fileName)} (${line + 1},${character + 1}):\n    ${colors.red(message)}`);
            } else {
                console.error(colors.red(message));
            }
        });
    } else {
        console.error(colors.green('Your program is ' + AWESOME_SYNONYMS[_.random(AWESOME_SYNONYMS.length - 1)] + '!'));
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
