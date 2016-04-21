import {
    cleanAndCompile, expect, readOutputFile,
    fixturePath, readFixture, expectSource, createConfig
} from './utils';

describe('main test', function() {
    it('should transpile without sourceamps', async function() {
        // babel need some time to init
        this.timeout(10000);

        let config =  {
            entry: fixturePath(['babel', 'babel.ts'])
        };

        let loaderQuery = {
            sourceMap: false,
            useBabel: true,
            babelOptions: {
              "presets": ["es2015"]
            }
        };

        let stats = await cleanAndCompile(createConfig(config, { loaderQuery }));
        expect(stats.compilation.errors.length).eq(0);
    });
});
