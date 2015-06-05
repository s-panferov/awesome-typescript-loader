import * as React from 'react';

interface PageProps {}

var { div, h1 } = React.DOM;

export class PageClass extends React.Component<PageProps, {}> {
    render() {
        return div({className: 'page'},
            h1(null, "Demo page")
        )
    }
}