import {
    cleanAndCompile, expect, readOutputFile,
    fixturePath, readFixture, expectSource, createConfig
} from './utils';

describe('main test', function() {

    it('should transpile file with babel', async function() {
        // babel need some time to init
        this.timeout(10000);

        let config =  {
            entry: fixturePath(['babel', 'babel.ts'])
        };

        let loaderQuery = {
            useBabel: true,
            babelOptions: {
              "presets": ["es2015"]
            }
        };

        let stats = await cleanAndCompile(createConfig(config, { loaderQuery }));
        expect(stats.compilation.errors.length).eq(0);

        let result = await readOutputFile();
        let expectation = await readFixture(['babel', 'babel.js']);

        expectSource(result, expectation);
    });

    it('should use options from query', async function() {
        // babel need some time to init
        this.timeout(10000);

        let config =  {
            entry: fixturePath(['babel', 'babel.ts'])
        };

        let loaderQuery = {
            useBabel: true,
            babelOptions: {
              "presets": ["unknown-preset"]
            }
        };

        let throws = false;
        try {
            let stats = await cleanAndCompile(createConfig(config, { loaderQuery }));
            expect(stats.compilation.errors.length).eq(0);
        } catch (e) {
            throws = true;
        }

        expect(throws).to.true;
    });
});
