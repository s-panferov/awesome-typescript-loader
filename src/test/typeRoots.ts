import {
    cleanAndCompile, expect,
    fixturePath, createConfig, chroot
} from './utils';

describe('main test', function() {
    it('should compile proejct with typeRoots', async function() {
        const config = createConfig(
            {
                entry: fixturePath(['typeRoots', 'index.ts'])
            },
            {
                loaderQuery: {
                    tsconfigContent: undefined,
                    tsconfig: fixturePath(['typeRoots', 'tsconfig.json'])
                }
            }
        );

        let stats = await chroot(fixturePath('typeRoots'), async () => {
            return await cleanAndCompile(config);
        });

        expect(stats.compilation.errors.length).eq(0);
    });
});
