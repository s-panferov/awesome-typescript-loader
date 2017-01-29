import {
    clear, src, webpackConfig, tsconfig,
    compile, checkOutput, expectErrors, run
} from './utils';

run(__filename, async function() {
    clear();
    src('index.ts', `
        function sum(a: number, b: number) {
            return a + b;
        }

        sum('test', 1);
    `);

    tsconfig();

    await compile(webpackConfig());

    expectErrors(1, [
        `Argument of type '"test"' is not assignable to parameter of type 'number'`
    ]);

    checkOutput('index.js', `
        function sum(a, b) {
            return a + b;
        }

        sum('test', 1);
    `);
});
