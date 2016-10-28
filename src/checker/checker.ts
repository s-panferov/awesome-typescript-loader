import * as _ from 'lodash';
import * as childProcess from 'child_process';
import * as path from 'path';

import {
    CompilerInfo,
    LoaderConfig,
    Req,
    Res,
    Init,
    EmitFile,
    Files,
    Diagnostics,
    UpdateFile,
    TsConfig
} from './protocol';

interface Resolve {
    resolve: (...args: any[]) => void;
    reject: (e: Error) => void;
}

export class Checker {
    seq: number = 0;
    checker: childProcess.ChildProcess;
    pending: Map<number, Resolve> = new Map();

    compilerInfo?: CompilerInfo;
    loaderConfig?: LoaderConfig;
    compilerConfig?: TsConfig;
    webpackOptions?: any;

    constructor(
        compilerInfo: CompilerInfo,
        loaderConfig: LoaderConfig,
        compilerConfig: TsConfig,
        webpackOptions: any
    ) {
        const checker: childProcess.ChildProcess
            = childProcess.fork(path.join(__dirname, 'runtime.js'));

        this.checker = checker;
        this.compilerInfo = compilerInfo;
        this.loaderConfig = loaderConfig;
        this.compilerConfig = compilerConfig;
        this.webpackOptions = webpackOptions;

        this.req({
            type: 'Init',
            payload: {
                compilerInfo: _.omit(compilerInfo, 'tsImpl'),
                loaderConfig,
                compilerConfig,
                webpackOptions
            }
        } as Init.Request);

        checker.on('message', (res: Res) => {
            const {seq, success, payload} = res;
            if (seq && this.pending.has(seq)) {
                const resolver = this.pending.get(seq);
                if (success) {
                    resolver.resolve(payload);
                } else {
                    resolver.reject(payload);
                }

                this.pending.delete(seq);
            } else {
                console.warn('Unknown message: ', payload);
            }
        });
    }

    req<T>(message: Req): Promise<T> {
        message.seq = ++this.seq;
        this.checker.send(message);
        return new Promise<T>((resolve, reject) => {
            let resolver: Resolve = {
                resolve, reject
            };

            this.pending.set(message.seq, resolver);
        });
    }

    emitFile(fileName: string, text: string): Promise<EmitFile.ResPayload> {
       return this.req({
            type: 'EmitFile',
            payload: {
                fileName,
                text
            }
        } as EmitFile.Request);
    }

    updateFile(fileName: string, text: string) {
       return this.req({
            type: 'UpdateFile',
            payload: {
                fileName,
                text
            }
        } as UpdateFile.Request);
    }

    getDiagnostics(): any {
        return this.req({
            type: 'Diagnostics'
        } as Diagnostics.Request);
    }

    getFiles(): any {
        return this.req({
            type: 'Files'
        } as Files.Request);
    }

    kill() {
        this.checker.kill('SIGKILL');
    }
}
