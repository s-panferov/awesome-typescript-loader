/// <reference path="./defines.d.ts" />

import * as $ from 'jquery';
import * as React from 'react';
import { PageClass } from './page';

export function run() {
    $(() => {
        React.render(React.createElement(PageClass, {}), document.body)
    })
}

run();