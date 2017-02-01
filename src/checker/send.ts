import { ChildProcess } from 'child_process';

export interface QueuedSender {
    send: (msg: any) => void;
}

// Wrapper around process.send() that will queue any messages if the internal node.js
// queue is filled with messages and only continue sending messages when the internal
// queue is free again to consume messages.
// On Windows we always wait for the send() method to return before sending the next message
// to workaround https://github.com/nodejs/node/issues/7657 (IPC can freeze process)
export function createQueuedSender(childProcess: ChildProcess | NodeJS.Process): QueuedSender {
    let msgQueue = [];
    let isSending = false;

    const doSendLoop = function(): void {
        const msg = msgQueue.shift();

        childProcess.send(msg, error => {
            if (error) {
                console.error(error);
            }

            if (msgQueue.length > 0) {
                setImmediate(doSendLoop);
            } else {
                isSending = false;
            }
        });
    };

    const send = function (msg: any): void {
        msgQueue.push(msg); // add to the queue if the process cannot handle more messages

        if (isSending) {
            return;
        }

        isSending = true;

        doSendLoop();
    };

    return { send };
}
