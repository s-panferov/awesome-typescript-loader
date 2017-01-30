import * as path from 'path';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as child from 'child_process';

import { LoaderConfig } from '../interfaces';

require('source-map-support').install();

import { expect } from 'chai';
export { expect };

const webpack = require('webpack');
const BPromise = require('bluebird');

const mkdirp = BPromise.promisify(require('mkdirp'));
// const rimraf = BPromise.promisify(require('rimraf'));
const readFile = BPromise.promisify(fs.readFile);
const writeFile = BPromise.promisify(fs.writeFile);

export const defaultOutputDir = path.join(process.cwd(), '.test');
export const defaultFixturesDir = path.join(process.cwd(), 'fixtures');

export interface ConfigOptions {
    loaderQuery?: LoaderConfig;
    watch?: boolean;
    include?: (string | RegExp)[];
    exclude?: (string | RegExp)[];
}

const TEST_DIR = path.join(process.cwd(), '.test');
const SRC_DIR = './src';
const OUT_DIR = './out';

mkdirp.sync(TEST_DIR);

const LOADER = path.join(process.cwd(), 'index.js');

export function entry(file: string) {
    return config => {
        config.entry.index = path.join(process.cwd(), SRC_DIR, file);
    };
}

export function query(q: any) {
    return config => {
        _.merge(
            config.module.loaders.find(loader =>
                loader.loader === LOADER).query,
            q
        );
    };
}

export function webpackConfig(...enchance: any[]) {
    const config = {
        entry: { index: path.join(process.cwd(), SRC_DIR, 'index.ts') },
        output: {
            path: path.join(process.cwd(), OUT_DIR),
            filename: '[name].js'
        },
        resolve: {
            extensions: ['.ts', '.tsx', '.js', '.jsx'],
        },
        module: {
            loaders: [
                {
                    test: /\.(tsx?|jsx?)/,
                    loader: LOADER,
                    include: [ path.join(process.cwd(), SRC_DIR) ],
                    query: {
                        silent: true
                    }
                }
            ]
        }
    };

    enchance.forEach(e => e(config));
    return config;
}

export function expectErrors(stats: any, count: number, errors: string[] = []) {
    stats.compilation.errors.every(err => {
        const str = err.toString();
        expect(errors.some(e => str.indexOf(e) !== -1), 'Error is not covered: \n' + str).true;
    });

    expect(stats.compilation.errors.length).eq(count);
}

export function tsconfig(compilerOptions?: any, config?: any) {
    const res = _.merge({
        compilerOptions: _.merge({
            target: 'es6'
        }, compilerOptions)
    }, config);
    return file('tsconfig.json', json(res));
}

export function install(...name: string[]) {
    return child.execSync(`yarn add ${name.join(' ')}`);
}

export function json(obj) {
    return JSON.stringify(obj, null, 4);
}

export function checkOutput(fileName: string, fragment: string) {
    const source = readOutput(fileName);

    if (!source) { process.exit() }

    expect(source.replace(/\s/g, '')).include(fragment.replace(/\s/g, ''));
}

export function readOutput(fileName: string) {
    return fs.readFileSync(path.join(OUT_DIR, fileName || 'index.js')).toString();
}

export function touchFile(fileName: string): Promise<any> {
    return readFile(fileName)
        .then(buf => buf.toString())
        .then(source => writeFile(fileName, source));
}

export function compile(config?): Promise<any> {
    return new Promise((resolve, reject) => {
        const compiler = webpack(config);

        compiler.run((err, stats) => {
            if (err) {
                reject(err);
            } else {
                resolve(stats);
            }
        });
    });
}

export function run<T>(name: string, cb: () => Promise<T>, disable = false) {
    const runner = () => {
        const temp = path.join(
            TEST_DIR,
            path.basename(name).replace('.', '') + '-' +
                (new Date()).toTimeString()
                    .replace(/.*(\d{2}:\d{2}:\d{2}).*/, "$1")
                    .replace(/:/g, "-")
        );

        mkdirp.sync(temp);
        let cwd = process.cwd();
        process.chdir(temp);
        pkg();
        const promise = cb();
        return promise
            .then(a => {
                process.chdir(cwd);
                return a;
            })
            .catch(e => {
                process.chdir(cwd);
                throw e;
            });
    };

    if (disable) {
        xit(name, runner);
    } else {
        it(name, runner);
    }
}

export function xrun<T>(name: string, cb: () => Promise<T>) {
    return run(name, cb, true);
}

export function watch(config, cb?: (err, stats) => void): Watch {
    let compiler = webpack(config);
    let watch = new Watch();
    let webpackWatcher = compiler.watch({}, (err, stats) => {
        watch.invoke(err, stats);
        if (cb) {
            cb(err, stats);
        }
    });

    watch.close = webpackWatcher.close;
    return watch;
}

export class Watch {
    close: () => void;

    private resolves: {resolve: any, reject: any}[] = [];

    invoke(err, stats) {
        this.resolves.forEach(({resolve, reject}) => {
            if (err) {
                reject(err);
            } else {
                resolve(stats);
            }
        });
        this.resolves = [];
    }

    wait(): Promise<any> {
        return new Promise((resolve, reject) => {
            this.resolves.push({resolve, reject});
        });
    }
}

export function pkg() {
    file('package.json', `
        {
            "name": "test",
            "license": "MIT"
        }
    `);
}

export function src(fileName: string, text: string) {
    return new Fixture(path.join(SRC_DIR, fileName), text);
}

export function file(fileName: string, text: string) {
    return new Fixture(fileName, text);
}

export class Fixture {
    private text: string;
    private fileName: string;
    constructor(fileName: string, text: string) {
        this.text = text;
        this.fileName = fileName;
        mkdirp.sync(path.dirname(this.fileName));
        fs.writeFileSync(this.fileName, text);
    }

    path() {
        return this.fileName;
    }

    toString() {
        return this.path();
    }

    touch() {
        touchFile(this.fileName);
    }

    update(updater: (text: string) => string) {
        let newText = updater(this.text);
        this.text = newText;
        fs.writeFileSync(this.fileName, newText);
    }

    remove() {
        fs.unlinkSync(this.fileName);
    }
}
