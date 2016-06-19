import {
    cleanAndCompile, expect, readOutputFile,
    fixturePath, readFixture, expectSource, createConfig
} from './utils';

describe('main test', function() {

    it('should emit declaration files', async function() {
        // babel need some time to init
        this.timeout(10000);

        let config =  {
            entry: fixturePath(['declaration', 'basic.ts'])
        };

        let loaderQuery = {
            declaration: true
        };

        let stats = await cleanAndCompile(createConfig(config, { loaderQuery }));
        expect(stats.compilation.errors.length).eq(0);
        let assets = Object.keys(stats.compilation.assets);

        expect(assets).to.include('src/test/fixtures/declaration/basic.d.ts');

        // elided import
        expect(assets).to.include('src/test/fixtures/declaration/iface.d.ts');
    });

    it('should emit declaration files in context', async function() {
        this.timeout(10000);

        let config = {
            context: fixturePath(['declaration']),
            entry: {
                'basic': fixturePath(['declaration', 'basic.ts'])
            }
        };

        let loaderQuery = {
            declaration: true
        };

        let stats = await cleanAndCompile(createConfig(config, { loaderQuery }));
        expect(stats.compilation.errors.length).eq(0);

        let assets = Object.keys(stats.compilation.assets);

        expect(assets).to.include('basic.d.ts');
        expect(assets).to.include('basic.js');

        // TODO: Code should be changed to output elided import into the correct location
        expect(assets).to.include('src/test/fixtures/declaration/iface.d.ts');
    });
});
