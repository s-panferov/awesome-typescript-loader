# The best TypeScript loader for Webpack 

[![Join the chat at https://gitter.im/s-panferov/awesome-typescript-loader](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/s-panferov/awesome-typescript-loader?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

TypeScript loader for Webpack. This project was started as a fork of https://github.com/andreypopp/typescript-loader.
Thanks @andreypopp for the great project.

The main goal of this loader is to support the **watch** mode and *webpack-dev-server* with **incremental** compilation.
Also there are a lot of problems in other TypeScript loaders that were fixed here.

## Unstable TypeScript warning

Right now this library works only with the **TypeScript 1.5-alfa** compiler.

## Installation

```
npm install awesome-typescript-loader
```

## Configuration

1. Add `.ts` as a resolvable extension.
2. Configure all files with a `.ts` extension to be handled by `awesome-typescript-loader`.

**webpack.config.js**

```javascript
module.exports = {

  // Currently we need to add '.ts' to resolve.extensions array.
  resolve: {
    extensions: ['', '.ts', '.webpack.js', '.web.js', '.js']
  },

  // Source maps support (or 'inline-source-map' also works)
  devtool: 'source-map',

  // Add loader for .ts files.
  module: {
    loaders: [
      {
        test: /\.ts$/,
        loader: 'awesome-typescript-loader'
      }
    ]
  }
};
```

After that, you would be able to build TypeScript files with webpack.

## Options

### target

Specify the TypeScript output target.

- ES3
- **ES5 (default)**
- ES6

### module

Specify the type of modules that TypeScript emits.

- **CommonJS (default)**
- AMD

### sourceMap *(boolean) (default=false)*

Specify whether or not TypeScript emits source maps. 

### noImplicitAny *(boolean) (default=false)*

Specify whether or not TypeScript will allow inferring the `any` type.

### compiler *(string) (default='typescript')*

Allows use of TypeScript compilers other than the official one. Should be
set to the NPM name of the compiler.

## Using with --watch or webpack-dev-server

This loader has support of both `--watch` and `webpack-dev-server` modes. It handles file dependencies
using internal webpack dependency markers. When you change a file, the loader recompiles all dependencies.

## Using with JSX-TypeScript compiler

You can use `typescript-loader` together with
[jsx-typscript](https://github.com/fdecampredon/jsx-typescript) compiler which
has support for JSX syntax (used in React.js).

For that you need to install `jsx-typescript`:

    % npm install jsx-typescript

And specify `compiler` loader option:

```javascript
module.exports = {

  module: {
    loaders: [
      {
        test: /\.ts$/,
        loader: 'typescript-loader?compiler=jsx-typescript'
      }
    ]
  }
};
```

## External Modules

The most natural way to structure your code with TypeScript and webpack is to use [external modules](https://github.com/Microsoft/TypeScript/wiki/Modules#going-external), and these work as you would expect. 

```
npm install --save react
```

```typescript
import React = require('react');
```

## Internal Modules

This project doesn't aim to support internal modules, because it's hard to resolve dependencies for the watch
mode if you use such modules. Of course, you can still use them without watch, but this function is **unstable**.

## Declaration files

All declaration files should be resolvable from the entry file. 
The easiest way to do this is to create a `references.d.ts` file which contains 
references to all of your declaration files. Then reference 
`references.d.ts` from your entry file.
