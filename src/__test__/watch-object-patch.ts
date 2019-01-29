import {
    src, webpackConfig, tsconfig,
    watch, expectErrors, spec
} from './utils';

spec('just patch Object interface', async function() {
    src('index.ts', `
        interface Object {
            hasOwnProperty<K extends PropertyKey>(k: K): this is {[_ in K]: any }
        }

        interface TypeA {}
        interface TypeB {
            bar: boolean;
        }

        type UnionType = TypeA | TypeB;

        const foo: UnionType = {
            bar: true
        }

        if (!foo.hasOwnProperty('bar')) {
            throw new Error();
        }

        foo.bar
    `);

    tsconfig();

    const watcher = watch(webpackConfig());

    let stats = await watcher.wait();
    expectErrors(stats, 0);
});

spec('patch Object interface and recompile (remove empty line)', async function() {
    const index = src('index.ts', `
        interface Object {
            hasOwnProperty<K extends PropertyKey>(k: K): this is {[_ in K]: any }
        }

        interface TypeA {}
        interface TypeB {
            bar: boolean;
        }

        type UnionType = TypeA | TypeB;

        const foo: UnionType = {
            bar: true
        }

        if (!foo.hasOwnProperty('bar')) {
            throw new Error();
        }

        foo.bar
    `);

    tsconfig();

    const watcher = watch(webpackConfig());

    let stats = await watcher.wait();
    expectErrors(stats, 0);

    index.update(() => `
        interface Object {
            hasOwnProperty<K extends PropertyKey>(k: K): this is {[_ in K]: any }
        }

        interface TypeA {}
        interface TypeB {
            bar: boolean;
        }

        type UnionType = TypeA | TypeB;

        const foo: UnionType = {
            bar: true
        }

        if (!foo.hasOwnProperty('bar')) {
            throw new Error();
        }
        foo.bar
    `);

    stats = await watcher.wait();

    expectErrors(stats, 0);
});
