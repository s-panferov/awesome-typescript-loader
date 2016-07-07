import {
    cleanAndCompile, expect,
    fixturePath, createConfig
} from './utils';

describe('salsa test', function() {
    it('should compile ts file with js invoke', async function() {
        let config =  {
            entry: fixturePath(['salsa', 'index.ts'])
        };

        let tsconfig = fixturePath(['salsa', 'tsconfig.json']);
        let loaderQuery = { tsconfig, tsconfigContent: null };

        let stats = await cleanAndCompile(createConfig(config, { loaderQuery }));
        console.log(stats.compilation.errors)
        expect(stats.compilation.errors.length).eq(1);
    });

    xit('should compile js file as entry point', async function() {
        let config =  {
            entry: fixturePath(['salsa', 'index.js'])
        };

        let tsconfig = fixturePath(['salsa', 'tsconfig.json']);
        let loaderQuery = { tsconfig, tsconfigContent: null };

        let stats = await cleanAndCompile(createConfig(config, { loaderQuery }));
        console.log(stats.compilation.errors)
        expect(stats.compilation.errors.length).eq(1);
    });
});
