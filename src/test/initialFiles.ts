import {
    cleanAndCompile, expect,
    fixturePath, createConfig, chroot
} from './utils';

describe('main test', function() {
    it('should compile proejct with initialFiles', async function() {
        const config = createConfig(
            {
                entry: fixturePath(['initialFiles', 'Client', 'src', 'main.ts'])
            },
            {
                loaderQuery: {
                    tsconfigContent: undefined,
                    tsconfig: fixturePath(['initialFiles', 'Client', 'tsconfig.json'])
                }
            }
        );

        let stats = await chroot(fixturePath('initialFiles'), async () => {
            return await cleanAndCompile(config);
        });

        console.log(stats.compilation.errors)

        expect(stats.compilation.errors.length).eq(1);
        expect(stats.compilation.errors[0].toString().indexOf('ModuleNotFoundError: Module not found:')).eq(0);
    });
});
