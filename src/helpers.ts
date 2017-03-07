import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { OutputFile } from './interfaces';

const double = /\/\//;
export function toUnix(fileName: string): string {
    let res: string = fileName.replace(/\\/g, '/');
    while (res.match(double)) {
        res = res.replace(double, '/');
    }

    return res;
}

function withoutExt(fileName: string): string {
    return path.basename(fileName).split('.')[0];
}

function isFileEmit(fileName, outputFileName, sourceFileName) {
    return sourceFileName === fileName
        // typescript now emits .jsx files for .tsx files.
        && (outputFileName.substr(-3) === '.js' ||  outputFileName.substr(-4) === '.jsx');
}

function isSourceMapEmit(fileName, outputFileName, sourceFileName) {
    return sourceFileName === fileName
        // typescript now emits .jsx files for .tsx files.
        && (outputFileName.substr(-7) === '.js.map' || outputFileName.substr(-8) === '.jsx.map');
}

function isDeclarationEmit(fileName, outputFileName, sourceFileName) {
    return sourceFileName === fileName
        && (outputFileName.substr(-5) === '.d.ts');
}

export function findResultFor(fileName: string, output: ts.EmitOutput): OutputFile {
    let text;
    let sourceMap;
    let declaration: ts.OutputFile;
    fileName = withoutExt(fileName);

    for (let i = 0; i < output.outputFiles.length; i++) {
        let o = output.outputFiles[i];
        let outputFileName = o.name;
        let sourceFileName = withoutExt(o.name);
        if (isFileEmit(fileName, outputFileName, sourceFileName)) {
            text = o.text;
        }
        if (isSourceMapEmit(fileName, outputFileName, sourceFileName)) {
            sourceMap = o.text;
        }
        if (isDeclarationEmit(fileName, outputFileName, sourceFileName)) {
            declaration = o;
        }
    }

    return {
        text: text,
        sourceMap: sourceMap,
        declaration
    };
}

export function codegenErrorReport(errors) {
    return errors
        .map(function (error) {
            return 'console.error(' + JSON.stringify(error) + ');';
        })
        .join('\n');
}

export function formatError(diagnostic) {
    let lineChar;
    if (diagnostic.file) {
        lineChar = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    }
    return (
        (diagnostic.file ? path.normalize(diagnostic.file.fileName) : '')
        + (lineChar ? formatLineChar(lineChar) + ' ' : '') + "\n"
        + (typeof diagnostic.messageText == "string" ?
            diagnostic.messageText :
            formatMessageChain(<ts.DiagnosticMessageChain>diagnostic.messageText))
    );
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

const TYPESCRIPT_EXTENSION = /\.(d\.)?(t|j)s$/;

export function withoutTypeScriptExtension(fileName: string): string {
    return fileName.replace(TYPESCRIPT_EXTENSION, '');
}
