"use strict";

var __awaiter = undefined && undefined.__awaiter || function (thisArg, _arguments, Promise, generator) {
    return new Promise(function (resolve, reject) {
        generator = generator.call(thisArg, _arguments);
        function cast(value) {
            return value instanceof Promise && value.constructor === Promise ? value : new Promise(function (resolve) {
                resolve(value);
            });
        }
        function onfulfill(value) {
            try {
                step("next", value);
            } catch (e) {
                reject(e);
            }
        }
        function onreject(value) {
            try {
                step("throw", value);
            } catch (e) {
                reject(e);
            }
        }
        function step(verb, value) {
            var result = generator[verb](value);
            result.done ? resolve(result.value) : cast(result.value).then(onfulfill, onreject);
        }
        step("next", void 0);
    });
};
var _ = require('lodash');
var childProcess = require('child_process');
var path = require('path');
function createChecker(compilerInfo, compilerOptions) {
    let checker = childProcess.fork(path.join(__dirname, 'checker-runtime.js'));
    checker.send({
        messageType: 'init',
        payload: {
            compilerInfo: _.omit(compilerInfo, 'tsImpl'),
            compilerOptions
        }
    }, null);
    checker.inProgress = false;
    checker.compilerInfo = compilerInfo;
    checker.compilerOptions = compilerOptions;
    checker.on('message', function (msg) {
        if (msg.messageType == 'progress') {
            checker.inProgress = msg.payload.inProgress;
        }
    });
    return checker;
}
exports.createChecker = createChecker;
function resetChecker(checker) {
    if (checker.inProgress) {
        checker.kill('SIGKILL');
        return createChecker(checker.compilerInfo, checker.compilerOptions);
    } else {
        return checker;
    }
}
exports.resetChecker = resetChecker;
//# sourceMappingURL=checker.js.map