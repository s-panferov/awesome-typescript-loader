import * as _ from 'lodash';
import * as childProcess from 'child_process';
import * as path from 'path';
import { ICompilerInfo } from './host';
import { LoaderPluginDef, LoaderConfig } from './instance';

interface ChildProcess extends childProcess.ChildProcess {
    inProgress?: boolean;
    compilerInfo?: ICompilerInfo;
    loaderConfig?: LoaderConfig;
    compilerOptions?: ts.CompilerOptions;
    defaultLib?: string;
    webpackOptions?: any;
    plugins?: LoaderPluginDef[];
}

export function createChecker(
    compilerInfo: ICompilerInfo,
    loaderConfig: LoaderConfig,
    compilerOptions: ts.CompilerOptions,
    webpackOptions: any,
    defaultLib: string,
    plugins: LoaderPluginDef[]
): ChildProcess {
    let checker: ChildProcess = childProcess.fork(path.join(__dirname, 'checker-runtime.js'));

    checker.send({
        messageType: 'init',
        payload: {
            compilerInfo: _.omit(compilerInfo, 'tsImpl'),
            loaderConfig,
            compilerOptions,
            webpackOptions,
            defaultLib,
            plugins
        }
    }, null);

    checker.inProgress = false;
    checker.compilerInfo = compilerInfo;
    checker.loaderConfig = loaderConfig;
    checker.compilerOptions = compilerOptions;
    checker.webpackOptions = webpackOptions;
    checker.on('message', function(msg) {
        if (msg.messageType == 'progress') {
            checker.inProgress = msg.payload.inProgress;
        }
    });

    return checker;
}

export function resetChecker(checker: ChildProcess) {
    if (checker.inProgress) {
        checker.kill('SIGKILL');
        return createChecker(
            checker.compilerInfo,
            checker.loaderConfig,
            checker.compilerOptions,
            checker.webpackOptions,
            checker.defaultLib,
            checker.plugins
        );
    } else {
        return checker;
    }
}
