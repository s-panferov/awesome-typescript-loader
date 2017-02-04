import {
    src, tsconfig, stdout, stderr,
    spec, file, exec
} from './utils';

function config(env) {
    file(`webpack.config.js`, `
        const path = require('path')
        module.exports = {
            entry: { index: './src/index.ts' },
            output: {
                path: path.join(process.cwd(), '${env.OUT_DIR}'),
                filename: '[name].js'
            },
            resolve: {
                extensions: ['.ts', '.tsx', '.js', '.jsx'],
            },
            module: {
                loaders: [
                    {
                        test: /\.(tsx?|jsx?)/,
                        loader: '${env.LOADER}',
                        include: [ path.join(process.cwd(), '${env.SRC_DIR}') ],
                        query: {
                            silent: true
                        }
                    }
                ]
            }
        }
    `);
}

describe(__filename, () => {
    spec('compile', async function(env, done) {
        src('index.ts', `
            export default function sum(a: number, b: number) {
                return a + b;
            }

            sum(1, '1');
        `);

        tsconfig();
        config(env);

        const webpack = exec('webpack');

        await webpack.wait(
            stderr('Checking finished with 1 errors'),
            stdout([
                '[0] ./src/index.ts',
                'ERROR in [at-loader] src/index.ts:6:20'
            ])
        );

        webpack.close();
        done();
    });

    spec('watch', async function(env, done) {
        const index = src('index.ts', `
            export default function sum(a: number, b: number) {
                return a + b;
            }

            sum(1, '1');
        `);

        tsconfig();
        config(env);

        const webpack = exec('webpack', ['--watch']);

        await webpack.wait(
            stdout('Webpack is watching the files…'),
            stderr('Checking finished with 1 errors'),
            stdout('ERROR in [at-loader] src/index.ts:6:20'),
        );

        index.update(() => `
            export default function sum(a: number, b: number) {
                return a + b;
            }

            sum(1, 1);
        `);

        await webpack.wait(
            stdout([
                [true, '[0] ./src/index.ts'], [false, 'ERROR']
            ])
        );

        webpack.close();
        done();
    });
});

