require('source-map-support').install();

if (!global._babelPolyfill) {
    require('babel-polyfill');
}

module.exports = require('./index');
