import {
    clear, src, webpackConfig, tsconfig,
    compile, checkOutput, expectErrors, run
} from './utils';

run(__filename, async function() {
    clear();
    src('index.ts', `
        class HiThere {
            constructor(a: number, b: string) {
                const t = a + b;
            }
        }
    `);

    tsconfig();
    await compile(webpackConfig());

    expectErrors(0);
    checkOutput('index.js', `
        class HiThere {
            constructor(a, b) {
                const t = a + b;
            }
        }
    `);
});
