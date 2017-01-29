import {
    clear, src, webpackConfig, tsconfig,
    watch, expectErrors, run
} from './utils';

run(__filename, async function() {
    clear();

    const sum = src('sum.ts', `
        export default function sum(a: number, b: number) {
            return a + b;
        }
    `);

    const index = src('index.ts', `
        import sum from './sum'
        sum(1, 1);
    `);

    tsconfig();

    const watcher = watch(webpackConfig());

    await watcher.wait();
    expectErrors(0);

    sum.update(() => `
        export default function sum(a: number, b: string) {
            return a + b;
        }
    `);

    await watcher.wait();

    expectErrors(1, [
        `Argument of type '1' is not assignable to parameter of type 'string'`
    ]);

    index.update(() => `
        import sum from './sum'
        sum(1, '1');
    `);

    await watcher.wait();

    expectErrors(0);
});
