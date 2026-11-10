// ABOUTME: Tests for the ListenToMore link line appended to album and artist results.
// ABOUTME: Checks the lookup URL, the ref parameter, and encoding of awkward names.
import { describe, it, expect } from 'vitest'

import { buildListenToMoreLine } from '../../src/utils/listentomore-link'

describe('buildListenToMoreLine', () => {
	it('links an album through the lookup route with ref', () => {
		expect(buildListenToMoreLine({ type: 'album', artist: 'Radiohead', album: 'OK Computer' })).toBe(
			'**ListenToMore:** streaming links and an AI summary for this album → https://listentomore.com/lookup?artist=Radiohead&album=OK+Computer&ref=lastfm-mcp',
		)
	})

	it('links an artist', () => {
		expect(buildListenToMoreLine({ type: 'artist', artist: 'Sigur Rós' })).toBe(
			'**ListenToMore:** streaming links and an AI summary for this artist → https://listentomore.com/lookup?artist=Sigur+R%C3%B3s&ref=lastfm-mcp',
		)
	})

	it('omits the line when a name is longer than the lookup route accepts', () => {
		const long = 'x'.repeat(301)
		expect(buildListenToMoreLine({ type: 'album', artist: 'Fiona Apple', album: long })).toBe('')
		expect(buildListenToMoreLine({ type: 'artist', artist: long })).toBe('')
		expect(buildListenToMoreLine({ type: 'artist', artist: 'x'.repeat(300) })).toContain('listentomore.com/lookup')
	})

	it('encodes ampersands, slashes and quotes', () => {
		expect(buildListenToMoreLine({ type: 'album', artist: 'AC/DC', album: 'Rock & "Roll"' })).toContain(
			'artist=AC%2FDC&album=Rock+%26+%22Roll%22',
		)
	})
})
