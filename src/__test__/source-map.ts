import {
    src, webpackConfig, tsconfig,
    compile, checkOutput, expectErrors, spec
} from './utils';

spec(__filename, async function() {
    src('index.ts', `
        class HiThere {
            constructor(a: number, b: string) {
                const t = a + b;
            }
        }
    `);

    tsconfig();

    const config = webpackConfig();
    config.devtool = 'source-map';

    let stats = await compile(config);

    expectErrors(stats, 0);
    checkOutput('index.js.map', `"file":"index.js"`);
    checkOutput('index.js.map', `"sourcesContent":`);
    checkOutput('index.js.map', `"mappings":";AAAA;AACA;;AAEA;AACA;;AAEA;AACA;AACA;;AAEA;AACA;AACA;AACA;AACA;AACA;;AAEA;AACA;;AAEA;AACA;;AAEA;AACA;AACA;;;AAGA;AACA;;AAEA;AACA;;AAEA;AACA,mDAA2C,cAAc;;AAEzD;AACA;AACA;AACA;AACA;AACA;AACA;AACA,aAAK;AACL;AACA;;AAEA;AACA;AACA;AACA,mCAA2B,0BAA0B,EAAE;AACvD,yCAAiC,eAAe;AAChD;AACA;AACA;;AAEA;AACA,8DAAsD,+DAA+D;;AAErH;AACA;;AAEA;AACA;;;;;;;AC/DQ;IACI,YAAY,CAAS,EAAE,CAAS;QAC5B,MAAM,CAAC,GAAG,CAAC,GAAG,CAAC,CAAC;IACpB,CAAC;CACJ"`);
});
