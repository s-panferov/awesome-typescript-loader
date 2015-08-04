var fs = require('fs');
var path = require('path');
function isFileEmit(fileName, outputFileName, sourceFileName) {
    return sourceFileName === fileName
        && (outputFileName.substr(-3) === '.js' || outputFileName.substr(-4) === '.jsx');
}
function isSourceMapEmit(fileName, outputFileName, sourceFileName) {
    return sourceFileName === fileName
        && (outputFileName.substr(-7) === '.js.map' || outputFileName.substr(-8) === '.jsx.map');
}
function findResultFor(output, fileName) {
    var text;
    var sourceMap;
    fileName = path.normalize(fileName);
    for (var i = 0; i < output.outputFiles.length; i++) {
        var o = output.outputFiles[i];
        var outputFileName = path.normalize(o.name);
        var sourceFileName = path.normalize(o.sourceName);
        if (isFileEmit(fileName, outputFileName, sourceFileName)) {
            text = o.text;
        }
        if (isSourceMapEmit(fileName, outputFileName, sourceFileName)) {
            sourceMap = o.text;
        }
    }
    return {
        text: text,
        sourceMap: sourceMap
    };
}
exports.findResultFor = findResultFor;
function parseOptionTarget(target, tsInst) {
    target = target.toLowerCase();
    switch (target) {
        case 'es3':
            return 0;
        case 'es5':
            return 1;
        case 'es6':
            return 2;
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
    return ':' + (lineChar.line + 1) + ':' + lineChar.character;
}
exports.formatLineChar = formatLineChar;
function loadLib(moduleId) {
    var fileName = require.resolve(moduleId);
    var text = fs.readFileSync(fileName, 'utf8');
    return {
        fileName: fileName,
        text: text
    };
}
exports.loadLib = loadLib;
//# sourceMappingURL=helpers.js.map