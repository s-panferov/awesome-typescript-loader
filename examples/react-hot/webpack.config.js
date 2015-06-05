var webpack = require('webpack');
var path = require('path');

module.exports = {

  entry: {
    app: './index.ts',
    vendor: [
      'webpack/hot/only-dev-server',
      'react'
    ]
  },

  devServer: {
    contentBase: './dist'
  },

  output:{
    path: path.join(__dirname, 'dist'),
    publicPath: '/assets/',
    filename: '[name].js'
  },

  resolveLoader: { fallback: __dirname + '/node_modules' },

  resolve: {
    extensions: ['', '.ts', '.js']
  },

  node: {
    fs: 'empty'
  },

  // Source maps support (or 'inline-source-map' also works)
  devtool: 'source-map',

  module: {
    loaders: [
      {
        test: /\.ts$/,
        loaders: ['react-hot', 'awesome-typescript-loader']
      }
    ]
  },

  plugins: [
    new webpack.HotModuleReplacementPlugin(),
    new webpack.optimize.CommonsChunkPlugin(/* chunkName= */'vendor', /* filename= */'vendor.bundle.js')
  ]
};
