import {
    expect, Fixture, createConfig, cleanOutputDir, watch
} from './utils';

describe('checker test', function() {
    this.timeout(5000);

    let fixture = new Fixture(`
        let a: string;
        function check(arg1: string) { }
        check(a);
    `, '.ts');

    let config = createConfig(
        {
            entry: fixture.path(),
        },
        {
            watch: true,
        }
    );

    it('should watch changes', async function() {
        await cleanOutputDir();
        let watcher = await watch(config);

        {
            const [err, stats] = await watcher.wait();
            expect(err).not.ok;
            expect(stats.compilation.errors).lengthOf(0);
        }

        {
            fixture.update(text => text.replace('let a: string;', 'let a: number;'));

            const [err, stats] = await watcher.wait();
            expect(err).not.ok;
            expect(stats.compilation.errors).lengthOf(0);
        }

        watcher.close();
    });
});
