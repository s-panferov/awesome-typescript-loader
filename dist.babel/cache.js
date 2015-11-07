'use strict';

var fs = require('fs');
var crypto = require('crypto');
var os = require('os');
var path = require('path');
var zlib = require('zlib');
function findCompiledModule(fileName) {
    let baseFileName = fileName.replace(/(\.ts|\.tsx)$/, '');
    let compiledFileName = `${ baseFileName }.js`;
    if (fs.existsSync(compiledFileName)) {
        let mapFileName = `${ baseFileName }.js.map`;
        let isMapExists = fs.existsSync(mapFileName);
        let result = {
            fileName: compiledFileName,
            text: fs.readFileSync(compiledFileName).toString(),
            mapName: isMapExists ? mapFileName : null,
            map: isMapExists ? fs.readFileSync(mapFileName).toString() : null
        };
        return result;
    } else {
        return null;
    }
}
exports.findCompiledModule = findCompiledModule;
function read(filename, callback) {
    return fs.readFile(filename, function (err, data) {
        if (err) {
            return callback(err);
        }
        return zlib.gunzip(data, function (err, content) {
            let result = {};
            if (err) {
                return callback(err);
            }
            try {
                result = JSON.parse(content);
            } catch (e) {
                return callback(e);
            }
            return callback(null, result);
        });
    });
}
;
function write(filename, result, callback) {
    let content = JSON.stringify(result);
    return zlib.gzip(content, function (err, data) {
        if (err) {
            return callback(err);
        }
        return fs.writeFile(filename, data, callback);
    });
}
;
function filename(source, identifier, options) {
    let hash = crypto.createHash('sha512');
    let contents = JSON.stringify({
        identifier: identifier,
        options: options,
        source: source
    });
    hash.end(contents);
    return hash.read().toString('hex') + '.json.gzip';
}
;
function cache(params, callback) {
    let source = params.source;
    let options = params.options || {};
    let transform = params.transform;
    let identifier = params.identifier;
    let directory = typeof params.directory === 'string' ? params.directory : os.tmpdir();
    let file = path.join(directory, filename(source, identifier, options));
    return read(file, function (err, content) {
        let result = {};
        if (!err) {
            return callback(null, content);
        }
        try {
            result = transform(source, options);
        } catch (error) {
            return callback(error);
        }
        return write(file, result, function (err) {
            return callback(err, result);
        });
    });
}
exports.cache = cache;
;
//# sourceMappingURL=cache.js.map