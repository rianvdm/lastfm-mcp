// ABOUTME: Tests for toDataPoint, which maps a tool-call event to a Workers Analytics Engine data point.
// ABOUTME: Pins the index, blob and double layout that the usage dashboard's SQL reads.
import { describe, it, expect } from 'vitest'

import { toDataPoint } from '../../src/analytics/toolEvents'

describe('toDataPoint', () => {
	it('should lay out tool, client, outcome, cache and version as blob1..blob5, duration as double1 and Last.fm requests as double2', () => {
		const point = toDataPoint(
			{ tool: 'get_top_artists', outcome: 'ok', cache: 'hit', durationMs: 12.5, lastfmRequests: 7 },
			'Claude',
			'2.8.0',
		)

		expect(point).toEqual({
			indexes: ['get_top_artists'],
			blobs: ['get_top_artists', 'Claude', 'ok', 'hit', '2.8.0'],
			doubles: [12.5, 7],
		})
	})
})
