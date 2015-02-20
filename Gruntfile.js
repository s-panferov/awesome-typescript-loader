module.exports = function(grunt) {
    require('load-grunt-tasks')(grunt);

    grunt.initConfig({
        clean: ['dist'],
        ts: {
            default : {
                options: {
                    module: "commonjs"
                },
                src: 'src/index.ts',
                outDir: 'dist'
            }
        },
        copy: {
            main: {
                src: './src/runtime.d.ts',
                dest: './dist/runtime.d.ts'
            }
        }
    });

    grunt.registerTask('default', ['ts', 'copy']);
};