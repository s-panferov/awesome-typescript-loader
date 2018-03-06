export const WatchModeSymbol = Symbol('WatchMode')

export class CheckerPlugin {
	apply(compiler) {
		compiler.hooks.run.tap('at-loader', function (params, callback) {
			compiler[WatchModeSymbol] = false
			callback()
		})

		compiler.hooks.watchRun.tap('at-loader', function (params, callback) {
			compiler[WatchModeSymbol] = true
			callback()
		})
	}
}
