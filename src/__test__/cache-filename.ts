/*!
 * Copyright 2018 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2018-08-02 10:40:34
 */

import { filename } from '../cache'
import { LoaderConfig } from '../interfaces'
import { expect, spec } from './utils'

spec(__filename, async () => {
	const optA: LoaderConfig = {
		useCache: true
	}
	const optB: LoaderConfig = {
		...optA,
		getCustomTransformers: () => ({
			before: []
		})
	}
	expect(filename('', '', optA)).not.equal(filename('', '', optB))
})
