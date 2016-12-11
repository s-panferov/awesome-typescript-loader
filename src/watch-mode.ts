export const WatchModeSymbol = Symbol('WatchMode');

export class CheckerPlugin {
    apply(compiler) {
        compiler.plugin("run", function(params, callback) {
            compiler[WatchModeSymbol] = false;
            callback();
        });

        compiler.plugin("watch-run", function(params, callback) {
            compiler[WatchModeSymbol] = true;
            callback();
        });
    }
}
