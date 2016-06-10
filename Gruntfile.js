module.exports = function(grunt) {
    require('load-grunt-tasks')(grunt);

    var options = {
        compiler: './node_modules/typescript/bin/tsc',
        module: "commonjs",
        fast: 'never',
        preserveConstEnums: true,
        target: 'es6'
    };

    var src = ['src/**/*.ts', '!src/test/fixtures/**/*'];

    grunt.initConfig({
        clean: ['dist'],
        copy: {
            main: {
                src: './lib/runtime.d.ts',
                dest: './dist/runtime.d.ts'
            }
        },
        bump : {
            options : {
                files : ['package.json'],
                updateConfigs : [],
                commit : true,
                commitMessage : 'chore(ver): v%VERSION%',
                commitFiles : ['package.json', 'CHANGELOG.md'],
                createTag : true,
                tagName : 'v%VERSION%',
                tagMessage : 'chore(ver): v%VERSION%',
                push : true,
                pushTo : 'origin',
                gitDescribeOptions : '--tags --always --abbrev=1 --dirty=-d',
                globalReplace : false,
                prereleaseName : "rc",
                regExp : false
            }
        },
        shell : {
            addChangelog : {
                command : 'git add CHANGELOG.md'
            }
        },
        conventionalChangelog : {
            options: {
                changelogOpts: {
                    // conventional-changelog options go here
                    preset: 'angular'
                }
            },
            release: {
            	src: 'CHANGELOG.md'
            }
        }
    });

    grunt.registerTask("release", "Release a new version", function(target) {
        if(!target) {
            target = "minor";
        }
        return grunt.task.run("bump-only:" + target, "conventionalChangelog", "shell:addChangelog", "bump-commit");
    });

    grunt.registerTask('default', ['copy']);
};
