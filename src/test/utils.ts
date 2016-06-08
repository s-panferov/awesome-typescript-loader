import * as path from 'path';
import * as fs from 'fs';
import * as _ from 'lodash';

const temp = require('temp').track();

require('babel-polyfill');
require('source-map-support').install();

import { expect } from 'chai';
export { expect };

const webpack = require('webpack');
const BPromise = require('bluebird');

const mkdirp = BPromise.promisify(require('mkdirp'));
const rimraf = BPromise.promisify(require('rimraf'));
const readFile = BPromise.promisify(fs.readFile);
const writeFile = BPromise.promisify(fs.writeFile);
const loaderDir = path.join(process.cwd(), 'dist.babel');
const ForkCheckerPlugin = require(loaderDir).ForkCheckerPlugin;

export const defaultOutputDir = path.join(process.cwd(), 'src', 'test', 'output');
export const defaultFixturesDir = path.join(process.cwd(), 'src', 'test', 'fixtures');

export interface ConfigOptions {
    loaderQuery?: any;
    watch?: boolean;
    forkChecker?: boolean;
    include?: (string | RegExp)[];
    exclude?: (string | RegExp)[];
}

let defaultOptions: ConfigOptions = {
    watch: false,
    forkChecker: false,
};

export function createConfig(conf, _options: ConfigOptions = defaultOptions) {
    let options: ConfigOptions = _.merge({}, defaultOptions, _options);
    const defaultConfig = {
        watch: false,
        output: {
            path: defaultOutputDir,
            filename: '[name].js'
        },
        resolve: {
            extensions: ['', '.ts', '.tsx', '.js', '.jsx'],
        },
        module: {
            loaders: [
                {
                    test: /\.(tsx?|jsx?)/,
                    loader: loaderDir,
                    query: Object.assign({ target: 'es6' }, options.loaderQuery)
                },
            ],
        },
        plugins: []
    };

    if (options.include) {
        (defaultConfig.module.loaders[0] as any).include = options.include;
    }

    if (options.exclude) {
        (defaultConfig.module.loaders[0] as any).exclude = options.exclude;
    }

    if (options.watch) {
        defaultConfig.watch = true;
    }

    if (options.forkChecker) {
        defaultConfig.plugins.push(
            new ForkCheckerPlugin()
        );
    }

    return _.merge(defaultConfig, conf);
}

export function expectSource(source: string, fragment: string) {
    expect(source.replace(/\s/g, '')).include(fragment.replace(/\s/g, ''));
}

export function fixturePath(fileName: string | string[], fixturesDir: string = defaultFixturesDir): string {
    return path.join.apply(path, [fixturesDir].concat(fileName));
}

export function readFixture(fileName: string | string[], fixturesDir: string = defaultFixturesDir): Promise<string> {
    let filePath = fixturePath(fileName, fixturesDir);
    return readFile(filePath).then(buf => buf.toString());
}

export function writeFixture(fileName: string | string[], text: string, fixturesDir: string = defaultFixturesDir): Promise<any> {
    let filePath = fixturePath(fileName, fixturesDir);
    return writeFile(filePath, text);
}

export function touchFile(fileName: string): Promise<any> {
    return readFile(fileName)
        .then(buf => buf.toString())
        .then(source => writeFile(fileName, source));
}

export function outputFileName(fileName: string, outputDir: string = defaultOutputDir): string {
    return path.join(defaultOutputDir, fileName);
}

export function readOutputFile(fileName?: string, outputDir: string = defaultOutputDir): Promise<string> {
    return readFile(outputFileName(fileName || 'main.js', outputDir)).then(buf => buf.toString());
}

export function cleanOutputDir(outputDir: string = defaultOutputDir): Promise<any> {
    return rimraf(outputDir)
        .then(() => mkdirp(outputDir));
}

export function cleanAndCompile(config, outputDir: string = defaultOutputDir): Promise<any> {
    return cleanOutputDir(outputDir)
        .then(() => compile(config));
}

export function compile(config): Promise<any> {
    return new Promise((resolve, reject) => {
        let compiler = webpack(config);
        compiler.run((err, stats) => {
            if (err) {
                reject(err);
            } else {
                resolve(stats);
            }
        });
    });
}

export function watch(config, cb?: (err, stats) => void): Watch {
    let compiler = webpack(config);
    let watch = new Watch();
    let webpackWatcher = compiler.watch({}, (err, stats) => {
        watch.call(err, stats);
        if (cb) {
            cb(err, stats);
        }
    });

    watch.close = webpackWatcher.close;
    return watch;
}

class Watch {
    resolves: ((arg: any[]) => void)[] = [];
    close: () => void;

    call(err, stats) {
        this.resolves.forEach(resolver => {
            resolver([err, stats]);
        });
        this.resolves = [];
    }

    wait(): Promise<any> {
        return new Promise((resolve, reject) => {
            this.resolves.push(resolve);
        });
    }
}

export class Fixture {
    private text: string;
    private fileName: string;
    constructor(text: string, ext = '.tsx') {
        this.text = text;
        let tmpobj = temp.openSync({
            prefix: 'atl-',
            suffix: '.tsx'
        });

        this.fileName = tmpobj.path;

        fs.writeFileSync(this.fileName, text);
    }

    path() {
        return this.fileName;
    }

    touch() {
        touchFile(this.fileName);
    }

    update(updater: (text: string) => string) {
        let newText = updater(this.text);
        this.text = newText;
        fs.writeFileSync(this.fileName, newText);
    }
}
