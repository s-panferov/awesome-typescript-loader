var ExtractTextPlugin = require("extract-text-webpack-plugin")

module.exports = {
    resolve: {
        extensions: ['', '.ts', '.js'],
        alias: {
            common: './src/common/lib'
        }
    },
    devtool: 'source-map',
    module: {
        loaders: [
            {
                test: /\.ts$/,
                loader: '../../dist/index.js?module=common&rewriteImports=common'
            }
        ]
    },
    entry: {
        index: ['./index.ts']
    },
    output: {
        path: './dist',
        filename: './[name].js'
    }
};
