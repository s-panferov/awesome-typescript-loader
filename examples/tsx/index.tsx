/// <reference path="./typings/react.d.ts" />

import * as React from 'react';

class Component extends React.Component<{ text: string }, void> {
	render() {
		return <div>{this.props.text}</div>
	}
}

React.render(<Component text="hello world!"/>, (document as any).body)
