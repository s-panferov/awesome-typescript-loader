/// <reference path="../node_modules/typescript/bin/typescriptServices.d.ts" />

import fs = require('fs');
import path = require('path');

export function findResultFor(output: ts.EmitOutput, filename: string) {
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

export function parseOptionTarget(target: string, ts: typeof ts) {
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

export function codegenErrorReport(errors) {
    return errors
        .map(function (error) {
            return 'console.error(' + JSON.stringify(error) + ');';
        })
        .join('\n');
}

export function formatErrors(errors: ts.Diagnostic[]) {
    return errors.map(function (diagnostic) {
        var lineChar;
        if (diagnostic.file) {
            lineChar = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        }
        return (
            (diagnostic.file ? diagnostic.file.fileName : '')
            + (lineChar ? formatLineChar(lineChar) + ' ' : '') + "\n"
            + (typeof diagnostic.messageText == "string" ?
                diagnostic.messageText :
                formatMessageChain(<ts.DiagnosticMessageChain>diagnostic.messageText))
        );
    });
}

export function formatMessageChain(chain: ts.DiagnosticMessageChain) {
    var result = "";
    var separator = "\n  ";
    var current = chain;

    while (current) {
        result += current.messageText;
        console.log(result);

        if (!!current.next) {
            result += separator;
            separator += "  ";
        }

        current = current.next;
    }

    return result;
}

export function formatLineChar(lineChar) {
    return ':' + lineChar.line + ':' + lineChar.character;
}

export function loadLib(moduleId) {
    var filename = require.resolve(moduleId);
    var text = fs.readFileSync(filename, 'utf8');
    return {
        fileName: filename,
        text: text
    };
}