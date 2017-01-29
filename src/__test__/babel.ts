import {
    clear, src, webpackConfig, tsconfig, install,
    watch, checkOutput, expectErrors, query, run
} from './utils';

run(__filename, async function() {
    clear();
    const index = src('index.ts', `
        class HiThere {
            constructor(a: number, b: string) {
                const t = a + b;
            }
        }
    `);

    install('babel-core', 'babel-preset-es2015');
    tsconfig();

    const watcher = await watch(webpackConfig(query({
        useBabel: true,
        babelOptions: {
            "presets": ["es2015"]
        }
    })));

    await watcher.wait();

    expectErrors(0);
    checkOutput('index.js', `
        var HiThere = function HiThere(a, b) {
            _classCallCheck(this, HiThere);
            var t = a + b;
        }
    `);

    index.update(() => `
        function sum(...items: number[]) {
            return items.reduce((a,b) => a + b, 0);
        }
    `);

    await watcher.wait();

    expectErrors(0);
    checkOutput('index.js', `
        function sum() {
            for(var _len = arguments.length,
                items = Array(_len),
                _key = 0;
                _key < _len;
                _key++
            ) {
                items[_key] = arguments[_key];
            }
            return items.reduce(function(a,b){ return a + b; }, 0);
        }
    `);
});
