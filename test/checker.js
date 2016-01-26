var webpack = require('webpack');
var Promise = require('bluebird');
var ps = Promise.promisifyAll(require('ps-node'));
var fs = Promise.promisifyAll(require('fs'));
var expect = require('expect');

var path = require('path');
var loader = path.resolve(__dirname, '../dist.babel');
var ForkCheckerPlugin = require(loader).ForkCheckerPlugin;
var globalConfig = {
    watch: true,
    module: {
        loaders: [
            {
                test: /\.ts?/,
                loader: loader + '?doTypeCheck&+forkChecker',
            },
        ],
    },
    plugins: [
        new ForkCheckerPlugin(),
    ],
};

var outputDir = path.resolve(__dirname, './output/');

describe('checker test', function() {
    var toCheckFilename = './test/fixtures/to-check.ts';

    this.timeout(5000);

    var outputFile = path.resolve(outputDir, toCheckFilename);
    var config =  {
        output: {
            path: outputDir,
            filename: toCheckFilename,
        },
        entry: toCheckFilename,
    };
    var getCheckerRuntimeProcess = () => {
        return ps.lookupAsync({
            command: new RegExp('node'),
            arguments: new RegExp('checker-runtime'),
            psargs: 'aux'
        }).then(res => {
            return res[0];
        });
    };

    var utilizeProcess = (p) => {
        expect(p).toExist();

        return ps.killAsync(p.pid);
    };

    it('should fork checker in separate process', function(done) {
        // assert that checker starts on startup
        new Promise((resolve, reject) => {
            webpack(Object.assign(globalConfig, config), function(err, stat) {
                resolve();
            });
        })
        .then(getCheckerRuntimeProcess)
        .then(p => {
            expect(p).toExist();
            return utilizeProcess(p);
        })
        .then(() => {
            done();
        })
    });

    it('should fork only one checker after multiple changes', function(done) {
        // I didn't get how to test it more precise, so it's more like a proof of work
        var fileContent = fs.readFileSync(toCheckFilename);
        var updateFile = () => fs.writeFileAsync(toCheckFilename, Date.now());
        var timeoutAsync = (ms) => {
            return new Promise((resolve, reject) => {
                setTimeout(resolve, ms);
            });
        };

        new Promise((resolve, reject) => {
            webpack(Object.assign(globalConfig, config), function(err, stat) {
                resolve();
            });
        })
        .then(getCheckerRuntimeProcess)
        .then(p => {
            expect(p).toExist();
            var times = [];
            var i = 10;
            while(i--) { times.push(i); }

            return Promise.each(times, () => {
                return updateFile().then(() => timeoutAsync(50));
            }).then(() => fs.writeFileAsync(toCheckFilename, fileContent));
        })
        .then(() => timeoutAsync(2000))
        .then(() => { done(); });
    });
});
