import {
    cleanAndCompile, expect, readOutputFile,
    fixturePath, readFixture, expectSource, createConfig
} from './utils';

describe('salsa test', function() {
    it('should compile js file', async function() {
        let config =  {
            entry: fixturePath(['salsa', 'index.js'])
        };

        let tsconfig = fixturePath(['salsa', 'tsconfig.json']);
        let loaderParams = `&tsconfig=${tsconfig}`;

        let stats = await cleanAndCompile(createConfig(config, { loaderParams }));
        expect(stats.compilation.errors.length).eq(1);
    });
});
