var HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
    resolve: {
        extensions: ['', '.ts', '.tsx', '.js']
    },
    devtool: 'source-map',
    module: {
        loaders: [
            {
                test: /\.tsx?$/,
                loader: '../../dist/index.js?+useCache&+useBabel&module=common&jsx=preserve'
            }
        ]
    },
    entry: {
        index: ['./index.tsx']
    },
    output: {
        path: './dist',
        filename: './[name].js'
    },
    plugins: [new HtmlWebpackPlugin()]
};
