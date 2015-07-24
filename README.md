# The best TypeScript loader for Webpack

[![Join the chat at https://gitter.im/s-panferov/awesome-typescript-loader](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/s-panferov/awesome-typescript-loader?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

TypeScript loader for Webpack. This project was started as a fork of https://github.com/andreypopp/typescript-loader.
Thanks @andreypopp for the great project.

The main goal of this loader is to support the **watch** mode and *webpack-dev-server* with **incremental** compilation.
Also there are a lot of problems in other TypeScript loaders that were fixed here.

## Unstable TypeScript warning

Right now this library works only with the **TypeScript 1.5-beta** compiler or with *ntypescript*.

## Installation

```
npm install awesome-typescript-loader --save-dev
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

## TS defaults

* target = 'es5'
* module = 'commonjs'

## tsconfig.json

You can use .tsconfig.json file to configure your compiler and loader:

```
{
    "compilerOptions": {
        "noImplicitAny": true,
        "removeComments": true,
    },
    "awesomeTypescriptLoaderOptions": {
        /* ... */
    }
}
```

## Loader Options

### compiler *(string) (default='typescript')*

Allows use of TypeScript compilers other than the official one. Should be
set to the NPM name of the compiler, e.g. *ntypescript* or path to a `tsc` file.

### emitRequireType *(boolean) (default=true)*

Specify whether or not the loader emits webpacks's require type. You might use `emitRequireType=false` with Node, because it already has own require type in `node.d.ts` file.

### library *(string) (default='es5' possible='es6')*

Allows use of library other than the `target`'s default one. Useful when you want to use ES6 library with ES5 target. Also you might use `library=es6` with Node.

### instanceName *(string) (default='default')*

Allows to use several TypeScript compilers with different settings in one app. Just override `instanceName` to initialize another instance.

### reEmitDependentFiles *(string) (default=false')*

Collect files dependency graph and re-emit all dependent files along with changed file.

### tsconfig *(string) (default='tsconfig.json')*

Specify path to a TS config file. Useful when you have multiple config files. This setting is useless *inside* TS config file.

### useWebpackText *(string) (default=false)*

Use this setting to force loader to use webpack's way to load files. Useful only with ts-jsx-loader. Builds may become slower.

### rewriteImports *(string)*

Comma-separated list of modules that must be processed by webpack in imports. Useful if you want to use `some-lib`
with pure TS files inside your app.

### externals *(string)*

Comma-separated list of paths to .d.ts files that must be included in program. Useful with `rewriteImports`.

### doTypeCheck *(string) (default=true)*

Use this setting to disable type checking if you want.

### forkChecker *(string) (default=false)*

Do type checking in a separate process, so webpack don't need to wait. **Significantly** improves development workflow.

## Using with --watch or webpack-dev-server

This loader has support of both `--watch` and `webpack-dev-server` modes. It handles file dependencies
using internal webpack dependency markers. When you change a file, the loader recompiles all dependencies.

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
