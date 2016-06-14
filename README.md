# The best TypeScript loader for Webpack

[![Join the chat at https://gitter.im/s-panferov/awesome-typescript-loader](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/s-panferov/awesome-typescript-loader?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
[![Build Status](https://travis-ci.org/s-panferov/awesome-typescript-loader.svg?branch=master)](https://travis-ci.org/s-panferov/awesome-typescript-loader)

TypeScript loader for Webpack. This project was started as a fork of https://github.com/andreypopp/typescript-loader.
Thanks to @andreypopp for the great project.

The main goal of this loader is to support the **watch** mode and *webpack-dev-server* with **incremental** compilation.
There are a lot of problems in other TypeScript loaders that are fixed here.

## Installation

```
npm install awesome-typescript-loader --save-dev
```

## Differences between [`ts-loader`](https://github.com/TypeStrong/ts-loader)

`awesome-typescript-loader` loader was created mostly to speed-up compilation in my own projects.
Some of them are quite big and I wanted to have full control on how my files are compiled. There are three major points:

1) awesome-typescript-loader (atl) uses dependency resolution to build modules dependency graph at early stages.
This speeds up build process in some corner cases (minimizes module resolutions, minimizes `createProgram` calls),
but adds a lot of additional complexity. Also it can re-emit all related files which is also useful in some corner cases.

2) atl has first-class integration with Babel and enables caching possibilities. This can be useful for those who use Typescript with Babel.
When `useBabel` and `useCache` flags are enabled, typescript's emit will be transpiled with Babel and cached.
So next time if source file (+environment) has the same checksum we can totally skip typescript's and babel's transpiling.
This significantly reduces build time in this scenario.

3) atl is able to fork type-checker to a separate process, which also speeds-up some development scenarios (e.g. react with react-hot-loader)
So your webpack compilation will end earlier and you can explore compiled version in your browser while your files are typecheked.

## Configuration

1. Add `.ts` as a resolvable extension.
2. Configure all files with a `.ts` extension to be handled by `awesome-typescript-loader`.

**webpack.config.js**

```javascript
module.exports = {

  // Currently we need to add '.ts' to the resolve.extensions array.
  resolve: {
    extensions: ['', '.ts', '.webpack.js', '.web.js', '.js']
  },

  // Source maps support ('inline-source-map' also works)
  devtool: 'source-map',

  // Add the loader for .ts files.
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

After that, you will be able to build TypeScript files with webpack.

## TS defaults

* target = 'es5'

## tsconfig.json

You can use the tsconfig.json file to configure your compiler and loader:

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

## Loader options

### compiler *(string) (default='typescript')*

Allows use of TypeScript compilers other than the official one. Must be
set to the NPM name of the compiler, e.g. *ntypescript* or the path to a package folder.
Note that the compiler must be installed in **your** project. You can also use
nightly versions.

### emitRequireType *(boolean) (default=false)*

Specify whether or not the loader emits webpacks's require type.

### library *(string) (default='es5' possible='es6')*

Allows the use of libraries other than the `target`'s default one. Useful when you want to use ES6 library with ES5 target. Additionally you might use `library=es6` with Node.

### instanceName *(string) (default='default')*

Allows the use of several TypeScript compilers with different settings in one app. Override `instanceName` to initialize another instance.

### reEmitDependentFiles *(boolean) (default=false')*

Collect file dependency graph and re-emit all dependent files along with the changed file.

### tsconfig *(string) (default='tsconfig.json')*

Specifies the path to a TS config file. This is useful when you have multiple config files. This setting is useless *inside* a TS config file.

### useWebpackText *(boolean) (default=false)*

Use this setting to force the loader to use webpack's method of loading files. Useful only with ts-jsx-loader. Builds may become slower.

### externals *(array)*

Array of paths to .d.ts files that must be included in program. Useful with `rewriteImports`.

### doTypeCheck *(boolean) (default=true)*

Use this setting to disable type checking.

### ignoreDiagnostics *(number[]) (default=[])*

You can squelch certain TypeScript errors by specifying an array of [diagnostic codes](https://github.com/Microsoft/TypeScript/blob/master/src/compiler/diagnosticMessages.json) to ignore.
For example, you can transpile [stage 1 properties](https://github.com/jeffmo/es-class-fields-and-static-properties) from `*.js` using `"ignoreDiagnostics": [8014]`.

### forkChecker *(boolean) (default=false)*

Do type checking in a separate process, so webpack doesn't need to wait. **Significantly** improves development workflow with tools like [react-hot-loader](https://github.com/gaearon/react-hot-loader).

Works only with `ForkCheckerPlugin`:

```js
var ForkCheckerPlugin = require('awesome-typescript-loader').ForkCheckerPlugin;

plugins: [
    new ForkCheckerPlugin(),
]
```

### forkCheckerSilent *(boolean) (default=false)*

Less logging from the checker.

### useBabel *(boolean) (default=false)*

Invoke Babel to transpile files. Useful with ES6 target. Please see `useCache` option
which can improve warm-up time.

### babelOptions *(object) (default=null)*

Use this option to pass some options to Babel (e.g. presets). Please note that
[`.babelrc` file](https://babeljs.io/docs/usage/babelrc/) is more universal way to do this.

### useCache *(boolean) (default=false)*

Use internal file cache. This is useful with Babel, when processing takes a long time to complete. Improves warm-up time.

### usePrecompiledFiles *(boolean) (default=false)*

Use pre-compiled files if any. Files must be named as `{filename}.js` and `{filename}.map`.

### cacheDirectory *(string) (default='.awcache')*

Directory when cache is stored.

### resolveGlobs *(string) (default=true)*

Invoke glob resolver using 'filesGlob' and 'exclude' sections of `tsconfig`.

### skipDeclarationFilesCheck *(string) (default=false)*

Skip declaration files typechecking. Use this only if you understand consequences.

## Compiler options

You can pass compiler options inside loader query string or in tsconfig file.

## Using with --watch or webpack-dev-server

This loader supports both `--watch` and `webpack-dev-server` modes. It handles file dependencies
using internal webpack dependency markers. When you change a file, the loader recompiles all the dependencies.

## External Modules

The most natural way to structure your code with TypeScript and webpack is to use [external modules](https://github.com/Microsoft/TypeScript/wiki/Modules#going-external), and these work as you would expect.

```
npm install --save react
```

```typescript
import * as React from 'react';
```

## Internal Modules

This project doesn't aim to support internal modules, because it's hard to resolve dependencies for the watch mode. Of course, you can still use them without watch, but this function is **unstable**.

## Declaration files

All declaration files should be resolvable from the entry file.
The easiest way to do this is to create a `references.d.ts` file which contains
references to all of your declaration files. Then reference
`references.d.ts` from your entry file.
