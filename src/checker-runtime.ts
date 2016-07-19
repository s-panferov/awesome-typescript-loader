import { ICompilerInfo, IFile, TSCONFIG_INFERRED } from './host';
import * as path from 'path';
import { LoaderPlugin, LoaderPluginDef, LoaderConfig } from './instance';

let colors = require('colors/safe');

export enum MessageType {
    Init = <any>'init',
    Compile = <any>'compile'
}

export interface IMessage {
    messageType: MessageType;
    payload: any;
}

export interface IInitPayload {
    loaderConfig: LoaderConfig;
    compilerOptions: ts.CompilerOptions;
    compilerInfo: ICompilerInfo;
    webpackOptions: any;
    defaultLib: string;
    plugins: LoaderPluginDef[];
}

export interface ICompilePayload {
    files: {[fileName: string]: IFile};
    moduleResolutionCache: {[fileName: string]: ts.ResolvedModule};
    typeReferenceResolutionCache: {[fileName: string]: ts.ResolvedTypeReferenceDirective};
}

export interface IEnv {
    loaderConfig?: LoaderConfig;
    compilerOptions?: ts.CompilerOptions;
    webpackOptions?: any;
    compiler?: typeof ts;
    compilerInfo?: ICompilerInfo;
    host?: Host;
    files?: {[fileName: string]: IFile};
    moduleResolutionCache?: {[fileName: string]: ts.ResolvedModule};
    typeReferenceResolutionCache?: {[fileName: string]: ts.ResolvedTypeReferenceDirective};
    program?: ts.Program;
    service?: ts.LanguageService;
    plugins?: LoaderPluginDef[];
    defaultLib?: string;
    initedPlugins?: LoaderPlugin[];
}

export interface SyncResolver {
    (context: string, fileName: string): string;
}

let env: IEnv = {};

export class ModuleResolutionHost implements ts.ModuleResolutionHost {
    servicesHost: Host;

    constructor(servicesHost: Host) {
        this.servicesHost = servicesHost;
    }

    fileExists(fileName: string)  {
        return this.servicesHost.getScriptSnapshot(fileName) !== undefined;
    }

    readFile(fileName: string): string {
        let snapshot = this.servicesHost.getScriptSnapshot(fileName);
        return snapshot && snapshot.getText(0, snapshot.getLength());
    }
}

export class Host implements ts.LanguageServiceHost {
    moduleResolutionHost: ModuleResolutionHost;
    resolver: SyncResolver;

    constructor() {
        this.moduleResolutionHost = new ModuleResolutionHost(this);
    }

    getScriptFileNames() {
        return Object.keys(env.files);
    }

    getScriptVersion(fileName: string) {
        if (env.files[fileName]) {
            return env.files[fileName].version.toString();
        }
    }

    getScriptSnapshot(fileName: string) {
        let file = env.files[fileName];
        if (!file) {
            return null;
        }
        return env.compiler.ScriptSnapshot.fromString(file.text);
    }

    getCurrentDirectory() {
        return process.cwd();
    }

    getScriptIsOpen() {
        return true;
    }

    getCompilationSettings() {
        return env.compilerOptions;
    }

    resolveTypeReferenceDirectives(typeDirectiveNames: string[], containingFile: string) {
        if (containingFile.indexOf(TSCONFIG_INFERRED) !== -1) {
            containingFile = TSCONFIG_INFERRED;
        }

        return typeDirectiveNames.map(moduleName => {
            return env.typeReferenceResolutionCache[`${containingFile}::${moduleName}`];
        });
    }

    resolveModuleNames(moduleNames: string[], containingFile: string) {
        return moduleNames.map(moduleName => {
            return env.moduleResolutionCache[`${containingFile}::${moduleName}`];
        });
    }

    getDefaultLibFileName(options: ts.CompilerOptions) {
        return env.defaultLib;
    }

    log(message) {

    }
}

function processInit(payload: IInitPayload) {
    env.compiler = require(payload.compilerInfo.compilerPath);
    env.compilerInfo = payload.compilerInfo;
    env.loaderConfig = payload.loaderConfig;
    env.compilerOptions = payload.compilerOptions;
    env.webpackOptions = payload.webpackOptions;
    env.defaultLib = payload.defaultLib;
    env.host = new Host();
    env.service = env.compiler.createLanguageService(env.host, env.compiler.createDocumentRegistry());
    env.plugins = payload.plugins;
    env.initedPlugins = env.plugins.map(plugin => {
        return require(plugin.file)(plugin.options);
    });
}

let DECLARATION_FILE = /\.d\.ts/;

function processCompile(payload: ICompilePayload) {
    let instanceName = env.loaderConfig.instanceName || 'default';
    let silent = !!env.loaderConfig.forkCheckerSilent;
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
    env.moduleResolutionCache = payload.moduleResolutionCache;
    env.typeReferenceResolutionCache = payload.typeReferenceResolutionCache;

    let program = env.program = env.service.getProgram();

    let allDiagnostics: ts.Diagnostic[] = [];
    if (env.loaderConfig.skipDeclarationFilesCheck) {
        let sourceFiles = program.getSourceFiles();
        sourceFiles.forEach(sourceFile => {
            if (!sourceFile.fileName.match(DECLARATION_FILE)) {
                allDiagnostics = allDiagnostics.concat(env.compiler.getPreEmitDiagnostics(program, sourceFile));
            }
        });
        // FIXME internal API
        allDiagnostics = (env.compiler as any).sortAndDeduplicateDiagnostics(allDiagnostics);
    } else {
        allDiagnostics = env.compiler.getPreEmitDiagnostics(program);
    }

    if (allDiagnostics.length) {
        allDiagnostics.forEach(diagnostic => {
            let message = env.compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            if (diagnostic.file) {
                let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
                console.error(`[${ instanceName }] ${colors.red(path.normalize(diagnostic.file.fileName))}:${line + 1}:${character + 1} \n    ${colors.red(message)}`);
            } else {
                console.error(colors.red(`[${ instanceName }] ${ message }`));
            }
        });
        console.error(colors.red(`[${ instanceName }] Checking finished with ${ allDiagnostics.length } errors`));
    } else {
        if (!silent) {
            let timeEnd = +new Date();
            console.log(
                colors.green(`[${ instanceName }] Ok, ${(timeEnd - timeStart) / 1000} sec.`)
            );
        }
    }

    env.initedPlugins.forEach(plugin => {
        plugin.processProgram(program);
    });

    process.send({
        messageType: 'progress',
        payload: {
            inProgress: false
        }
    });
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
