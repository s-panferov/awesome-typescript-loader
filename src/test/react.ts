import {
    cleanAndCompile, expect,
    fixturePath, createConfig, chroot
} from './utils';

describe('react test', function() {
    it('should compile proejct with react typings', async function() {
        const config = createConfig(
            {
                entry: fixturePath(['react', 'index.tsx'])
            },
            {
                loaderQuery: {
                    configFileContent: undefined,
                    configFileName: fixturePath(['react', 'tsconfig.json'])
                }
            }
        );

        let stats = await chroot(fixturePath('react'), async () => {
            return await cleanAndCompile(config);
        });

        expect(stats.compilation.errors.length).eq(2);
        expect(stats.compilation.errors[0].toString().indexOf('ModuleNotFoundError: Module not found:')).eq(0);
        expect(stats.compilation.errors[1].toString().indexOf('ModuleNotFoundError: Module not found:')).eq(0);
    });
});
