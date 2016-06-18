let enhancedResolve = require('enhanced-resolve');

function makeResolver(options) {
	return enhancedResolve.create.sync(options.resolve);
}

export default makeResolver;
