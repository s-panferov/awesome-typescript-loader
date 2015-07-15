var HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
    resolve: {
        extensions: ['', '.ts', '.tsx', '.js']
    },
    devtool: 'source-map',
    module: {
        loaders: [
            {
                test: /\.tsx$/,
                loader: 'babel-loader!awesome-typescript-loader?compiler=ntypescript&module=common&jsx=react'
            },
            {
                test: /\.ts$/,
                loader: 'awesome-typescript-loader?compiler=ntypescript&module=common'
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
