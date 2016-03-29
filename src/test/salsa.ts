import {
    cleanAndCompile, expect,
    fixturePath, createConfig
} from './utils';

describe('salsa test', function() {
    it('should compile js file', async function() {
        let config =  {
            entry: fixturePath(['salsa', 'index.ts'])
        };

        let tsconfig = fixturePath(['salsa', 'tsconfig.json']);
        let loaderQuery = { tsconfig };
        let exclude = [ /exclude/ ];

        let stats = await cleanAndCompile(createConfig(config, { loaderQuery, exclude }));

        console.log(stats.compilation.errors);

        expect(stats.compilation.errors.length).eq(2);
        expect(stats.compilation.errors[0].toString()).include('Cannot find module');
        expect(stats.compilation.errors[1].toString()).include(`Argument of type 'string'`);
    });
});
