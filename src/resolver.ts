let enhancedResolve = require('enhanced-resolve');

function createSyncResolver(options) {
	return enhancedResolve.create.sync(options.resolve);
}

export default createSyncResolver;
