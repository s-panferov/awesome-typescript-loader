import {
    src, webpackConfig, tsconfig,
    watch, checkOutput, expectErrors, spec
} from './utils';

spec(__filename, async function() {
    const index = src('index.ts', `
        export { default as sum } from './utils/sum'
    `);

    src('utils/sum.ts', `
        export default function sum(a: number, b: number) {
            return a + b;
        }
    `);

    tsconfig({
        declaration: true
    });

    const watcher = watch(webpackConfig());

    let stats = await watcher.wait();

    expectErrors(stats, 0);

    checkOutput('src/index.d.ts', `
        export { default as sum } from './utils/sum'
    `);

    checkOutput('src/utils/sum.d.ts', `
        export default function sum(a: number, b: number): number
    `);

    src('utils/mul.ts', `
        export default function mul(a: number, b: number) {
            return a * b;
        }
    `);

    index.update(() => `
        export { default as sum } from './utils/sum'
        export { default as mul } from './utils/mul'
    `);

    await watcher.wait();

    checkOutput('src/utils/mul.d.ts', `
        export default function mul(a: number, b: number): number
    `);

    checkOutput('src/index.d.ts', `
        export { default as sum } from './utils/sum';
        export { default as mul } from './utils/mul';
    `);
});
