import { ChildProcess } from 'child_process';

export interface QueuedSender {
    send: (msg: any) => void;
}

const isWindows = /^win/.test(process.platform);

// Wrapper around process.send() that will queue any messages if the internal node.js
// queue is filled with messages and only continue sending messages when the internal
// queue is free again to consume messages.
// On Windows we always wait for the send() method to return before sending the next message
// to workaround https://github.com/nodejs/node/issues/7657 (IPC can freeze process)
export function createQueuedSender(childProcess: ChildProcess | NodeJS.Process): QueuedSender {
    let msgQueue = [];
    let useQueue = false;

    const send = function (msg: any): void {
        if (useQueue) {
            msgQueue.push(msg); // add to the queue if the process cannot handle more messages
            return;
        }

        let result = childProcess.send(msg, error => {
            if (error) {
                console.error(error); // unlikely to happen, best we can do is log this error
            }

            useQueue = false; // we are good again to send directly without queue

            // now send all the messages that we have in our queue and did not send yet
            if (msgQueue.length > 0) {
                const msgQueueCopy = msgQueue.slice(0);
                msgQueue = [];
                msgQueueCopy.forEach(entry => send(entry));
            }
        });

        if (!result || isWindows /* workaround https://github.com/nodejs/node/issues/7657 */) {
            useQueue = true;
        }
    };

    return { send };
}
