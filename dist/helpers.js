/// <reference path="../node_modules/typescript/bin/typescriptServices.d.ts" />
var fs = require('fs');
var path = require('path');
function findResultFor(output, filename) {
    var text;
    var sourceMap;
    filename = path.normalize(filename);
    for (var i = 0; i < output.outputFiles.length; i++) {
        var o = output.outputFiles[i];
        var outputFileName = path.normalize(o.name);
        if (outputFileName.replace(/\.js$/, '.ts') === filename) {
            text = o.text;
        }
        if (outputFileName.replace(/\.js.map$/, '.ts') === filename) {
            sourceMap = o.text;
        }
    }
    return {
        text: text,
        sourceMap: sourceMap
    };
}
exports.findResultFor = findResultFor;
function parseOptionTarget(target, ts) {
    target = target.toLowerCase();
    switch (target) {
        case 'es3':
            return ts.ScriptTarget.ES3;
        case 'es5':
            return ts.ScriptTarget.ES5;
        case 'es6':
            return ts.ScriptTarget.ES6;
    }
}
exports.parseOptionTarget = parseOptionTarget;
function codegenErrorReport(errors) {
    return errors
        .map(function (error) {
        return 'console.error(' + JSON.stringify(error) + ');';
    })
        .join('\n');
}
exports.codegenErrorReport = codegenErrorReport;
function formatErrors(errors) {
    return errors.map(function (diagnostic) {
        var lineChar;
        if (diagnostic.file) {
            lineChar = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        }
        return ((diagnostic.file ? diagnostic.file.fileName : '')
            + (lineChar ? formatLineChar(lineChar) + ' ' : '') + "\n"
            + (typeof diagnostic.messageText == "string" ?
                diagnostic.messageText :
                formatMessageChain(diagnostic.messageText)));
    });
}
exports.formatErrors = formatErrors;
function formatMessageChain(chain) {
    var result = "";
    var separator = "\n  ";
    var current = chain;
    while (current) {
        result += current.messageText;
        if (!!current.next) {
            result += separator;
            separator += "  ";
        }
        current = current.next;
    }
    return result;
}
exports.formatMessageChain = formatMessageChain;
function formatLineChar(lineChar) {
    return ':' + lineChar.line + ':' + lineChar.character;
}
exports.formatLineChar = formatLineChar;
function loadLib(moduleId) {
    var filename = require.resolve(moduleId);
    var text = fs.readFileSync(filename, 'utf8');
    return {
        fileName: filename,
        text: text
    };
}
exports.loadLib = loadLib;
//# sourceMappingURL=helpers.js.map