// ABOUTME: Tests scanArtistScrobbles, which pages through a range's scrobbles and keeps one artist's rows.
// ABOUTME: Uses a stubbed client that serves a range as 1,000-row Last.fm pages, with a now-playing row on page 1.
import { describe, it, expect, vi } from 'vitest'

import type { CachedLastfmClient } from '../../../src/clients/cachedLastfm'
import type { LastfmTrack } from '../../../src/clients/lastfm'
import { SCAN_PAGE_SIZE, scanArtistScrobbles } from '../../../src/mcp/tools/artistScan'

const FROM = 1300000000
const TO = 1400000000
const KITES = 'The Paper Kites'

/** The dated scrobble at 1-based position `index` of the range (newest first). */
function scrobble(index: number, artist = 'Filler'): LastfmTrack {
	return {
		name: `Track ${index}`,
		artist: { '#text': artist },
		url: '',
		streamable: '0',
		date: { uts: String(TO - index), '#text': '' },
	}
}

const nowPlayingRow: LastfmTrack = { name: 'On Air', artist: { '#text': KITES }, url: '', streamable: '0', '@attr': { nowplaying: 'true' } }

/**
 * A client whose range holds `total` dated scrobbles, served `SCAN_PAGE_SIZE` per page, with `artistAt` overriding
 * the artist at given positions. Page 1 also starts with a now-playing row, as Last.fm does even for past ranges.
 */
function rangeClient(total: number, artistAt: Record<number, string> = {}, failOnPage?: number) {
	const totalPages = Math.ceil(total / SCAN_PAGE_SIZE)
	const getRecentTracks = vi.fn(async (_user: string, limit: number, _from?: number, _to?: number, page = 1) => {
		if (page === failOnPage) throw new Error('Last.fm API error: 8 - Operation failed')
		const first = (page - 1) * limit + 1
		const last = Math.min(page * limit, total)
		const rows: LastfmTrack[] = []
		for (let i = first; i <= last; i++) rows.push(scrobble(i, artistAt[i]))
		const track = page === 1 ? [nowPlayingRow, ...rows] : rows
		return {
			recenttracks: {
				track,
				'@attr': { user: 'rj', page: String(page), perPage: String(limit), total: String(total), totalPages: String(totalPages) },
			},
		}
	})
	return { client: { getRecentTracks } as unknown as CachedLastfmClient, getRecentTracks }
}

const pagesRequested = (mock: ReturnType<typeof rangeClient>['getRecentTracks']) => mock.mock.calls.map((call) => call[4])

describe('scanArtistScrobbles', () => {
	// 6,500 scrobbles = 7 Last.fm pages; Kites at positions 10 (page 1), 2,500 (page 3) and 6,400 (page 7).
	const kitesAt = { 10: KITES, 2500: 'the paper kites ', 6400: KITES }

	it('scans Last.fm pages 1-5 for block 1 and reports an incomplete scan', async () => {
		const { client, getRecentTracks } = rangeClient(6500, kitesAt)

		const result = await scanArtistScrobbles(client, 'rj', KITES, { from: FROM, to: TO, page: 1 })

		expect(pagesRequested(getRecentTracks)).toEqual([1, 2, 3, 4, 5])
		for (const call of getRecentTracks.mock.calls) expect(call.slice(0, 4)).toEqual(['rj', 1000, FROM, TO])
		expect(result.matches.map((t) => t.name)).toEqual(['Track 10', 'Track 2500'])
		expect(result).toMatchObject({ scannedFrom: 1, scannedTo: 5000, totalInRange: 6500, complete: false, nextPage: 2 })
	})

	it('excludes the now-playing row even when it is by the same artist', async () => {
		const { client } = rangeClient(6500, kitesAt)

		const result = await scanArtistScrobbles(client, 'rj', KITES, { from: FROM, to: TO, page: 1 })

		expect(result.matches.map((t) => t.name)).not.toContain('On Air')
		expect(result.matches.every((t) => t.date)).toBe(true)
	})

	it('scans only the remaining pages for block 2 and reports a complete scan', async () => {
		const { client, getRecentTracks } = rangeClient(6500, kitesAt)

		const result = await scanArtistScrobbles(client, 'rj', KITES, { from: FROM, to: TO, page: 2 })

		expect(pagesRequested(getRecentTracks)).toEqual([6, 7])
		expect(result.matches.map((t) => t.name)).toEqual(['Track 6400'])
		expect(result).toMatchObject({ scannedFrom: 5001, scannedTo: 6500, totalInRange: 6500, complete: true, nextPage: null })
	})

	it('makes one call for a range of one page', async () => {
		const { client, getRecentTracks } = rangeClient(300, { 7: KITES })

		const result = await scanArtistScrobbles(client, 'rj', KITES, { from: FROM, to: TO, page: 1 })

		expect(getRecentTracks).toHaveBeenCalledTimes(1)
		expect(result.matches.map((t) => t.name)).toEqual(['Track 7'])
		expect(result).toMatchObject({ scannedFrom: 1, scannedTo: 300, totalInRange: 300, complete: true, nextPage: null })
	})

	it('matches a page that Last.fm returns as a single track object', async () => {
		const getRecentTracks = vi.fn(async () => ({
			recenttracks: {
				track: scrobble(1, KITES),
				'@attr': { user: 'rj', page: '1', perPage: '1000', total: '1', totalPages: '1' },
			},
		}))
		const client = { getRecentTracks } as unknown as CachedLastfmClient

		const result = await scanArtistScrobbles(client, 'rj', KITES, { from: FROM, to: TO, page: 1 })

		expect(result.matches.map((t) => t.name)).toEqual(['Track 1'])
		expect(result).toMatchObject({ scannedFrom: 1, scannedTo: 1, complete: true })
	})

	it('reports a complete scan with nothing scanned for an empty range', async () => {
		const { client } = rangeClient(0)

		const result = await scanArtistScrobbles(client, 'rj', KITES, { from: FROM, to: TO, page: 1 })

		expect(result).toMatchObject({ matches: [], scannedFrom: 0, totalInRange: 0, complete: true, nextPage: null })
	})

	it('fetches nothing past the end for a block that starts after the last page', async () => {
		const { client, getRecentTracks } = rangeClient(6500, kitesAt)

		const result = await scanArtistScrobbles(client, 'rj', KITES, { from: FROM, to: TO, page: 3 })

		// Page 11 (the block's first page) may be fetched to learn totalPages; nothing after it.
		expect(pagesRequested(getRecentTracks).every((page) => page === 11)).toBe(true)
		expect(getRecentTracks.mock.calls.length).toBeLessThanOrEqual(1)
		expect(result).toMatchObject({ matches: [], scannedFrom: 0, totalInRange: 6500, complete: true, nextPage: null })
	})

	it('rejects when a page fails partway through the scan', async () => {
		const { client } = rangeClient(6500, kitesAt, 3)

		await expect(scanArtistScrobbles(client, 'rj', KITES, { from: FROM, to: TO, page: 1 })).rejects.toThrow('Operation failed')
	})
})
