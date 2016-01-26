var webpack = require('webpack');
var path = require('path');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var expect = require('expect');

var outputDir = path.resolve(__dirname, './output/');
var loader = path.resolve(__dirname, '../dist.babel');
var fs = require('fs');
var Promise = require('bluebird');
var readFile = Promise.promisify(fs.readFile);

var globalConfig = {
    module: {
        loaders: [
            {
                test: /\.ts?/,
                loader: loader + '?-doTypeCheck',
            },
        ],
    }
};

describe('main test', function() {
    beforeEach(function(done) {
        rimraf(outputDir, function(err) {
            if (err) { return done(err); }
            mkdirp(outputDir, done);
        });
    });

    it('should be ok', function(done) {
        var filename = 'basic.js';
        var outputFile = path.resolve(outputDir, filename);
        var config =  {
            output: {
                path: outputDir,
                filename: filename,
            },
            entry: './test/fixtures/basic.ts',
        };
        var testStringParts = [
            'var HiThere = (function () {',
            'function HiThere(a, b) {',
            'var t = a + b;',
            'return HiThere;'
        ];

        webpack(Object.assign(globalConfig, config), function(err, stats) {
            expect(err).toNotExist();
            expect(stats.compilation.errors.length).toBe(0);
            readFile(outputFile).then(function(data) {
                var res = data.toString();
                testStringParts.forEach(function(p) {
                    expect(res.indexOf(p)).toNotEqual(-1);
                });
                done();
            });
        });
    });

    it('should check typing', function(done) {
        var config = {
            output: {
                path: outputDir
            },
            entry: './test/fixtures/with-type-errors.ts',
            module: {
                loaders: [
                    {
                        test: /\.ts?/,
                        loader: loader + '?doTypeCheck',
                    },
                ],
            }
        };

        webpack(config, function(err, stats) {
            expect(stats.compilation.errors).toExist();
            done();
        });
    });

    it('should load tsx files and use tsconfig', function(done) {
        var tsConfig = path.resolve(__dirname, 'fixtures/tsconfig.json');
        var outputFilename = 'basic.jsx';
        var config = {
            entry: './test/fixtures/basic.tsx',
            module: {
                loaders: [
                    {
                        test: /\.tsx?/,
                        loader: loader + '?tsconfig=' + tsConfig
                    },
                ],
            },
            output: {
                path: outputDir,
                filename: 'basic.jsx',
            },
        };

        webpack(config, function(err, stats) {
            readFile(path.resolve(outputDir, outputFilename)).then(function(res) {
                var testString = 'return React.createElement("div", null, "hi there");';
                expect(res.toString().indexOf(testString)).toNotEqual(-1);
                done();
            });
        });
    });
});
