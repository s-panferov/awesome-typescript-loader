import {
    clear, src, webpackConfig, tsconfig,
    watch, expectErrors, xrun
} from './utils';

xrun(__filename, async function() {
    clear();
    const index = src('index.ts', `
        import sum from './sum'
        import mul from './mul'

        sum(1, 1)
        mul(1, 1)
    `);

    src('sum.ts', `
        export default function sum(a: number, b: number) {
            return a + b;
        }
    `);

    const mul = src('mul.ts', `
        // function with error
        export default function mul(a: number, b: number) {
            return a * c;
        }
    `);

    tsconfig();
    const watcher = await watch(webpackConfig());

    await watcher.wait();

    expectErrors(1, [
        `Cannot find name 'c'`
    ]);

    index.update(() => `
        import sum from './sum'
        sum(1, 1)
    `);

    mul.remove();

    await watcher.wait();
    expectErrors(0);
});
