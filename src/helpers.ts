import * as fs from 'fs';
import * as path from 'path';

function isFileEmit(fileName, outputFileName)  {
    return (outputFileName.replace(/\.js$/, '.ts') === fileName) ||
           (outputFileName.replace(/\.js$/, '.tsx') === fileName);
}

function isSourceMapEmit(fileName, outputFileName)  {
    return (outputFileName.replace(/\.js\.map$/, '.ts') === fileName) ||
           (outputFileName.replace(/\.js\.map$/, '.tsx') === fileName);
}

export function findResultFor(output: ts.EmitOutput, fileName: string) {
    let text;
    let sourceMap;
    fileName = path.normalize(fileName);
    for (let i = 0; i < output.outputFiles.length; i++) {
        let o = output.outputFiles[i];
        let outputFileName = path.normalize(o.name);
        if (isFileEmit(fileName, outputFileName)) {
            text = o.text;
        }
        if (isSourceMapEmit(fileName, outputFileName)) {
            sourceMap = o.text;
        }
    }
    return {
        text: text,
        sourceMap: sourceMap
    };
}

export function parseOptionTarget(target: string, tsInst: typeof ts): ts.ScriptTarget {
    target = target.toLowerCase();
    switch (target) {
        case 'es3':
            return tsInst.ScriptTarget.ES3;
        case 'es5':
            return tsInst.ScriptTarget.ES5;
        case 'es6':
            return tsInst.ScriptTarget.ES6;
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
        let lineChar;
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
    let result = "";
    let separator = "\n  ";
    let current = chain;

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

export function formatLineChar(lineChar) {
    return ':' + (lineChar.line + 1) + ':' + lineChar.character;
}

export function loadLib(moduleId) {
    let fileName = require.resolve(moduleId);
    let text = fs.readFileSync(fileName, 'utf8');
    return {
        fileName: fileName,
        text: text
    };
}
