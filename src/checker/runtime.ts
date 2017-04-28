if (!module.parent) {
    process.on('uncaughtException', function (err) {
        console.log("UNCAUGHT EXCEPTION in awesome-typescript-loader");
        console.log("[Inside 'uncaughtException' event] ", err.message, err.stack);
    });

    process.on('disconnect', function() {
        process.exit();
    });

    process.on('exit', () => {
        console.log('EXIT RUNTIME');
    });

    createChecker(
        process.on.bind(process, 'message'),
        process.send.bind(process)
    );
} else {
    module.exports.run = function run() {
        let send: (msg: Req, cb: (err?: Error) => void) => void;
        let receive = (msg) => {};

        createChecker(
            (receive: (msg: Req) => void) => {
                send = (msg: Req, cb: (err?: Error) => void) => {
                    receive(msg);
                    if (cb) { cb(); }
                };
            },
            (msg) => receive(msg)
        );

        return {
            on: (type: string, cb) => {
                if (type === 'message') {
                    receive = cb;
                }
            },
            send,
            kill: () => {}
        };
    };
}

import * as ts from 'typescript';
import * as path from 'path';
import * as colors from 'colors';
import { findResultFor, toUnix } from '../helpers';
import {
    Req,
    Res,
    LoaderConfig,
    CompilerInfo,
    Init,
    EmitFile,
    UpdateFile,
    Diagnostics,
    RemoveFile,
    Files,
    MessageType,
    TsConfig
} from './protocol';

interface File {
    text: string;
    version: number;
    snapshot: ts.IScriptSnapshot;
}

function createChecker(receive: (cb: (msg: Req) => void) => void, send: (msg: Res) => void) {
    let projectVersion = 0;
    let loaderConfig: LoaderConfig;
    let compilerConfig: TsConfig;
    let compilerOptions: ts.CompilerOptions;
    let webpackOptions: any;
    let compiler: typeof ts;
    let compilerInfo: CompilerInfo;
    let files: {[fileName: string]: File} = {};
    let host: ts.LanguageServiceHost;
    let service: ts.LanguageService;
    let ignoreDiagnostics: {[id: number]: boolean} = {};
    let instanceName: string;
    let context: string;

    function ensureFile(fileName: string) {
        if (!files[fileName]) {
            const text = compiler.sys.readFile(fileName);
            if (text) {
                files[fileName] = {
                    text,
                    version: 0,
                    snapshot: compiler.ScriptSnapshot.fromString(text)
                };
            }
        }
    }

    class FileDeps {
        files: {[fileName: string]: string[]} = {};

        add(containingFile: string, ...dep: string[]) {
            if (!this.files[containingFile]) {
                this.files[containingFile] = Array.from(dep);
            } else {
                const deps = this.files[containingFile];
                deps.push.apply(deps, dep);
            }
        }

        getDeps(containingFile: string): string[] {
            return this.files[containingFile] || [];
        }

        getAllDeps(containingFile: string, allDeps: {[key: string]: boolean} = {}, initial = true): string[] {
            const deps = this.getDeps(containingFile);
            deps.forEach(dep => {
                if (!allDeps[dep]) {
                    allDeps[dep] = true;
                    this.getAllDeps(dep, allDeps, false);
                }
            });

            if (initial) {
                return Object.keys(allDeps);
            } else {
                return [];
            }
        }
    }

    const fileDeps = new FileDeps();

    const TS_AND_JS_FILES = /\.tsx?$|\.jsx?$/i;
    const TS_FILES = /\.tsx?$/i;

    class Host implements ts.LanguageServiceHost {
        filesRegex: RegExp;

        constructor(filesRegex: RegExp) {
            this.filesRegex = filesRegex;
        }

        getProjectVersion() { return projectVersion.toString(); }

        getScriptFileNames() {
            return Object.keys(files).filter(filePath => this.filesRegex.test(filePath));
        }

        getScriptVersion(fileName: string) {
            ensureFile(fileName);
            if (files[fileName]) {
                return files[fileName].version.toString();
            }
        }

        getScriptSnapshot(fileName: string) {
            ensureFile(fileName);
            if (files[fileName]) {
                return files[fileName].snapshot;
            }
        }

        getCurrentDirectory() {
            return context;
        }

        getScriptIsOpen() {
            return true;
        }

        getCompilationSettings() {
            return compilerOptions;
        }

        resolveTypeReferenceDirectives(typeDirectiveNames: string[], containingFile: string) {
            const resolved = typeDirectiveNames.map(directive =>
                compiler.resolveTypeReferenceDirective(directive, containingFile, compilerOptions, compiler.sys)
                    .resolvedTypeReferenceDirective);

            resolved.forEach(res => {
                if (res && res.resolvedFileName) {
                    fileDeps.add(containingFile, res.resolvedFileName);
                }
            });

            return resolved;
        }

        resolveModuleNames(moduleNames: string[], containingFile: string) {
            const resolved =  moduleNames.map(module =>
                compiler.resolveModuleName(module, containingFile, compilerOptions, compiler.sys).resolvedModule);

            resolved.forEach(res => {
                if (res && res.resolvedFileName) {
                    fileDeps.add(containingFile, res.resolvedFileName);
                }
            });

            return resolved;
        }

        log(message) {
            console.log(message);
        }

        fileExists(...args) {
            return compiler.sys.fileExists.apply(compiler.sys, args);
        }

        readFile(...args) {
            return compiler.sys.readFile.apply(compiler.sys, args);
        }

        readDirectory(...args) {
            return compiler.sys.readDirectory.apply(compiler.sys, args);
        }

        getDefaultLibFileName(options: ts.CompilerOptions) {
        return compiler.getDefaultLibFilePath(options);
        }

        useCaseSensitiveFileNames() {
            return compiler.sys.useCaseSensitiveFileNames;
        }

        getDirectories(...args) {
            return compiler.sys.getDirectories.apply(compiler.sys, args);
        }

        directoryExists(path: string) {
            return compiler.sys.directoryExists(path);
        }
        getCustomTransformers=loaderConfig.getCustomTransformers
    }

    function processInit({seq, payload}: Init.Request) {
        compiler = require(payload.compilerInfo.compilerPath);
        compilerInfo = payload.compilerInfo;
        loaderConfig = payload.loaderConfig;
        compilerConfig = payload.compilerConfig;
        compilerOptions = compilerConfig.options;
        webpackOptions = payload.webpackOptions;
        context = payload.context;

        instanceName = loaderConfig.instance || 'at-loader';

        host = new Host(compilerOptions.allowJs
            ? TS_AND_JS_FILES
            : TS_FILES
        );

        service = compiler.createLanguageService(host);

        compilerConfig.fileNames.forEach(fileName => {
            const text = compiler.sys.readFile(fileName);
            if (!text) { return; }
            files[fileName] = {
                text,
                version: 0,
                snapshot: compiler.ScriptSnapshot.fromString(text)
            };
        });


        const program = service.getProgram();
        program.getSourceFiles().forEach(file => {
            files[file.fileName] = {
                text: file.text,
                version: 0,
                snapshot: compiler.ScriptSnapshot.fromString(file.text)
            };
        });


        if (loaderConfig.debug) {
            console.log(`[${instanceName}] @DEBUG Initial files`, Object.keys(files));
        }

        if (loaderConfig.ignoreDiagnostics) {
            loaderConfig.ignoreDiagnostics.forEach(diag => {
                ignoreDiagnostics[diag] = true;
            });
        }

        replyOk(seq, null);
    }

    function updateFile(fileName: string, text: string, ifExist = false) {
        const file = files[fileName];
        if (file) {
            if (file.text === text) { return; }
            projectVersion++;
            file.version++;
            file.text = text;
            file.snapshot = compiler.ScriptSnapshot.fromString(text);
        } else if (!ifExist) {
            projectVersion++;
            files[fileName] = {
                text,
                version: 0,
                snapshot: compiler.ScriptSnapshot.fromString(text)
            };
        }
    }

    function removeFile(fileName: string) {
        const file = files[fileName];
        if (file) {
            delete files[fileName];
        }
    }

    function emit(fileName: string) {
        if (loaderConfig.useTranspileModule || loaderConfig.transpileOnly) {
            return fastEmit(fileName);
        } else {
            const output = service.getEmitOutput(fileName, false);
            if (output.outputFiles.length > 0) {
                return findResultFor(fileName, output);
            } else {
                // Use fast emit in case of errors
                return fastEmit(fileName);
            }
        }
    }

    function fastEmit(fileName: string) {
        const trans = compiler.transpileModule(files[fileName].text, {
            compilerOptions: compilerOptions,
            fileName,
            reportDiagnostics: false
        });

        return {
            text: trans.outputText,
            sourceMap: trans.sourceMapText
        };
    }

    function processUpdate({seq, payload}: UpdateFile.Request) {
        updateFile(payload.fileName, payload.text, payload.ifExist);
        replyOk(seq, null);
    }

    function processRemove({seq, payload}: RemoveFile.Request) {
        removeFile(payload.fileName);
        replyOk(seq, null);
    }

    function processEmit({seq, payload}: EmitFile.Request) {
        updateFile(payload.fileName, payload.text);
        const emitResult = emit(payload.fileName);
        const deps = fileDeps.getAllDeps(payload.fileName);

        replyOk(seq, {emitResult, deps});
    }

    function processFiles({seq}: Files.Request) {
        replyOk(seq, {
            files: service.getProgram().getSourceFiles().map(f => f.fileName)
        });
    }

    function processDiagnostics({seq}: Diagnostics.Request) {
        let silent = !!loaderConfig.silent;

        const timeStart = +new Date();

        if (!silent) {
            console.log(colors.cyan(`\n[${ instanceName }] Checking started in a separate process...`));
        }

        const program = service.getProgram();

        const allDiagnostics = program
            .getOptionsDiagnostics().concat(
                program.getGlobalDiagnostics()
            );

        const nativeGetter = program.getSourceFiles;
        if (compilerConfig.options.skipLibCheck) {
            program.getSourceFiles = () => nativeGetter().filter(file => {
                return !file.isDeclarationFile;
            });
        }

        allDiagnostics.push(...program.getSyntacticDiagnostics());
        allDiagnostics.push(...program.getSemanticDiagnostics());

        if (loaderConfig.debug) {
            console.log(`[${instanceName}] @DEBUG Typechecked files`, program.getSourceFiles());
        }

        program.getSourceFiles = nativeGetter;

        if (allDiagnostics.length) {
            console.error(colors.red(`\n[${ instanceName }] Checking finished with ${ allDiagnostics.length } errors`));
        } else {
            if (!silent) {
                let timeEnd = +new Date();
                console.log(
                    colors.green(`\n[${ instanceName }] Ok, ${(timeEnd - timeStart) / 1000} sec.`)
                );
            }
        }

        const processedDiagnostics = allDiagnostics
            .filter(diag => !ignoreDiagnostics[diag.code])
            .map(diagnostic => {
                const message = compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
                let fileName = diagnostic.file && path.relative(context, diagnostic.file.fileName);

                if (fileName && fileName[0] !== '.') {
                    fileName = './' + toUnix(fileName);
                }

                let pretty = '';
                let line = 0;
                let character = 0;
                let code = diagnostic.code;

                if (diagnostic.file) {
                    const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
                    line = pos.line;
                    character = pos.character;
                    pretty = (`[${ instanceName }] ${colors.red(fileName)}:${line + 1}:${character + 1} \n    TS${code}: ${colors.red(message)}`);
                } else {
                    pretty = (colors.red(`[${ instanceName }] TS${code}: ${ message }`));
                }

                return {
                    category: diagnostic.category,
                    code: diagnostic.code,
                    fileName,
                    start: diagnostic.start,
                    message,
                    pretty,
                    line,
                    character
                };
            });

        replyOk(seq, processedDiagnostics);
    }

    function replyOk(seq: number, payload: any) {
        send({
            seq,
            success: true,
            payload
        } as Res);
    }

    function replyErr(seq: number, payload: any) {
        send({
            seq,
            success: false,
            payload
        } as Res);
    }

    receive(function(req: Req) {
        try {
            switch (req.type) {
                case MessageType.Init:
                    processInit(req);
                    break;
                case MessageType.UpdateFile:
                    processUpdate(req);
                    break;
                case MessageType.EmitFile:
                    processEmit(req);
                    break;
                case MessageType.Diagnostics:
                    processDiagnostics(req);
                    break;
                case MessageType.Files:
                    processFiles(req);
                    break;
                case MessageType.RemoveFile:
                    processRemove(req);
                    break;
            }
        } catch (e) {
            console.error(`[${instanceName}]: Child process failed to process the request: `, e);
            replyErr(req.seq, null);
        }
    });
}

