module.exports = {
    resolve: {
        extensions: ['', '.ts', '.js']
    },
    devtool: 'source-map',
    module: {
        loaders: [{
            test: /\.ts$/,
            loader: 'awesome-typescript-loader!ts-jsx-loader'
        }]
    },
    entry: {
        index: ['./index.ts']
    },
    output: {
        path: './dist',
        filename: './[name].js'
    }
};