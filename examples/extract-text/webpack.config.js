var ExtractTextPlugin = require("extract-text-webpack-plugin")

module.exports = {
    resolve: {
        extensions: ['', '.ts', '.js']
    },
    devtool: 'source-map',
    plugins: [
        //new ExtractTextPlugin("[name].css")
    ],
    module: {
        loaders: [
            {
                test: /\.ts$/,
                loader: 'awesome-typescript-loader'
            },
            {
                test: /\.css$/,
                loader: "style-loader!css-loader"
                //loader: ExtractTextPlugin.extract("style-loader", "css-loader")
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