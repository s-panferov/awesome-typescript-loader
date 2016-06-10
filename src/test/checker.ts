import {
    expect, fixturePath,
    createConfig, cleanOutputDir, watch, touchFile
} from './utils';

let ps = require('ps-node');

function getCheckerRuntimeProcess(): Promise<any> {
    let opts = {
        command: /node/,
        arguments: /checker-runtime.js/,
    };
    return new Promise((resolve, reject) => {
        ps.lookup(opts, (err, resultList ) => {
            resolve(resultList[0]);
        });
    });
};

function kill(p): Promise<any> {
    return new Promise((resolve, reject) => {
        ps.kill(p.pid, resolve);
    });
};

function sleep(time: number): Promise<any> {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, time);
    });
};

describe('checker test', function() {
    this.timeout(5000);

    let fixture = fixturePath(['checker', 'to-check.ts']);
    let config = createConfig(
        {
            entry: fixture,
        },
        {
            watch: true,
            forkChecker: true,
            loaderQuery: {
                forkChecker: true
            }
        }
    );

    it('should fork checker in separate process', async function() {
        await cleanOutputDir();

        let watcher = watch(config);
        await watcher.wait();

        let pid = await getCheckerRuntimeProcess();
        expect(pid).ok;
        watcher.close();
        await kill(pid);
    });

    it('should fork only one checker after multiple changes', async function() {
        // I didn't get how to test it more precise, so it's more like a proof of work

        await cleanOutputDir();

        let watcher = watch(config, () => {});
        await watcher.wait();

        let pid = await getCheckerRuntimeProcess();

        expect(pid).ok;

        let i = 10;
        while(i--) {
            await touchFile(fixture);
            await sleep(50);
        }

        await sleep(2000);
        watcher.close();
        await kill(pid);
    });
});
