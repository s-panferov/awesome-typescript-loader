import {
    cleanAndCompile, expect, readOutputFile,
    fixturePath, readFixture, expectSource, createConfig
} from './utils';

describe('main test', function() {

    it('should compile simple file', async function() {
        let config =  {
            entry: fixturePath(['basic', 'basic.ts'])
        };

        let stats = await cleanAndCompile(createConfig(config));
        expect(stats.compilation.errors.length).eq(0);

        let result = await readOutputFile();
        let expectation = await readFixture(['basic', 'basic.js']);

        expectSource(result, expectation);
    });

    it('should check typing', async function() {
        let config = {
            entry: fixturePath(['errors', 'with-type-errors.ts'])
        };

        let stats = await cleanAndCompile(createConfig(config));
        expect(stats.compilation.errors.length).eq(1);
    });

    it('should ignore diagnostics', async function() {
        let config = {
            entry: fixturePath(['errors', 'with-type-errors.ts'])
        };

        let loaderQuery = { ignoreDiagnostics: [2345] };

        let stats = await cleanAndCompile(createConfig(config, { loaderQuery }));
        expect(stats.compilation.errors.length).eq(0);
    });

    it('should load tsx files and use tsconfig', async function() {
        let tsconfig = fixturePath(['tsx', 'tsconfig.json']);
        let config = {
            entry: fixturePath(['tsx', 'basic.tsx'])
        };

        let loaderQuery = { tsconfig };

        let stats = await cleanAndCompile(createConfig(config, { loaderQuery }));
        expect(stats.compilation.errors.length).eq(1);

        let result = await readOutputFile();
        let expectation = 'return React.createElement("div", null, "hi there");';

        expectSource(result, expectation);
    });
});
