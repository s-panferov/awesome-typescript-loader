import {
    src, webpackConfig, tsconfig, watch,
    expectErrors, spec
} from './utils';

spec(__filename, async function() {
    src('Index.ts', `
        import { a } from './MyFile'
    `);

    const file = src('MyFIle.ts', `
        export let a: number = '10'
    `);

    tsconfig();

    const watcher = watch(webpackConfig());

    {
        let stats = await watcher.wait();
        expectErrors(stats, 1, [
            `Type '"10"' is not assignable to type 'number'`
        ]);
    }

    file.move('MyFile.ts');
    file.update(text => {
        return `
            export let a: number = 10
        `;
    });

    {
        let stats = await watcher.wait();
        expectErrors(stats, 0);
    }
});
