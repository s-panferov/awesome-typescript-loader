import {Item} from './folder/ind';

var React;
var test: Item = {test: ""};

export default React.render(React.jsx(`
    <div>
        <span>{2 + 2}</span>
    </div>
`), document.body)