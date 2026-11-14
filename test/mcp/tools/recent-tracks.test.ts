// ABOUTME: Tests get_recent_tracks: the now-playing row in range and later-page queries, and the artist scan output.
// ABOUTME: Drives the registered handler through a stub server and a stubbed Last.fm client.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { z } from 'zod'

import type { CachedLastfmClient } from '../../../src/clients/cachedLastfm'
import type { LastfmTrack } from '../../../src/clients/lastfm'
import { registerAuthenticatedTools } from '../../../src/mcp/tools/authenticated'
import { formatTimestamp } from '../../../src/utils/dateFormat'

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>

interface ToolMeta {
	inputSchema: z.ZodType
}

type GetRecentTracks = (user: string, limit: number, from?: number, to?: number, page?: number) => Promise<unknown>

const FROM = 1356998400 // 2013-01-01 UTC
const TO = 1388534399 // 2013-12-31 UTC
const KITES = 'The Paper Kites'

function scrobble(index: number, artist = 'Filler', name = `Track ${index}`): LastfmTrack {
	return { name, artist: { '#text': artist }, url: '', streamable: '0', date: { uts: String(TO - index * 60), '#text': '' } }
}

const nowPlayingRow: LastfmTrack = {
	name: 'On Air',
	artist: { '#text': 'Current Band' },
	url: '',
	streamable: '0',
	'@attr': { nowplaying: 'true' },
}

/** A range of `total` dated scrobbles in 1,000-row pages (or `limit`-row pages), with the now-playing row on top of every page. */
function rangeStub(total: number, artistAt: Record<number, [string, string]> = {}): GetRecentTracks {
	return async (_user, limit, _from, _to, page = 1) => {
		const totalPages = Math.ceil(total / limit)
		const rows: LastfmTrack[] = []
		for (let i = (page - 1) * limit + 1; i <= Math.min(page * limit, total); i++) {
			const [artist, name] = artistAt[i] ?? ['Filler', `Track ${i}`]
			rows.push(scrobble(i, artist, name))
		}
		return {
			recenttracks: {
				track: [nowPlayingRow, ...rows],
				'@attr': { user: 'rj', page: String(page), perPage: String(limit), total: String(total), totalPages: String(totalPages) },
			},
		}
	}
}

describe('get_recent_tracks', () => {
	let tool: { meta: ToolMeta; handler: ToolHandler }
	let getRecentTracks: ReturnType<typeof vi.fn<GetRecentTracks>>

	beforeEach(() => {
		getRecentTracks = vi.fn<GetRecentTracks>()
		const server = {
			registerTool: (name: string, meta: ToolMeta, handler: ToolHandler) => {
				if (name === 'get_recent_tracks') tool = { meta, handler }
			},
		}
		const client = { getRecentTracks } as unknown as CachedLastfmClient
		registerAuthenticatedTools(server as never, client, () => ({ username: 'rj', sessionKey: 'key' }))
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	/** Calls the handler with arguments parsed by the tool's own schema, as the SDK does. */
	async function textOf(args: Record<string, unknown> = {}): Promise<string> {
		const result = await tool.handler(tool.meta.inputSchema.parse(args) as Record<string, unknown>)
		return result.content[0].text
	}

	describe('now-playing row', () => {
		// Nine scrobbles in pages of `limit: 3`; each page arrives as 4 rows with the now-playing row on top.
		beforeEach(() => {
			getRecentTracks.mockImplementation(rangeStub(9))
		})

		it('keeps it for the plain recent-tracks call', async () => {
			const text = await textOf({ limit: 3 })
			expect(text).toContain('Current Band - On Air 🎵 Now Playing')
		})

		it.each([
			['from and to', { from: FROM, to: TO }],
			['date', { date: '2013-06-01' }],
			['page 2', { page: 2 }],
		])('drops it when %s is given and counts dated rows only', async (_label, args) => {
			const text = await textOf({ limit: 3, ...args })
			expect(text).not.toContain('On Air')
			expect(text).not.toContain('Now Playing')
			expect(text).toContain('Showing 3 tracks out of 9 total')
			expect(text.match(/^• Filler - Track \d+ \(/gm)).toHaveLength(3)
		})
	})

	describe('artist scan', () => {
		it('lists every match with its date and says the scan was complete', async () => {
			getRecentTracks.mockImplementation(rangeStub(1240, { 12: [KITES, 'Bloom'], 800: ['the paper kites', 'Featherstone'] }))

			const text = await textOf({ from: FROM, to: TO, artist: KITES })

			expect(text).toContain(`• The Paper Kites - Bloom (${formatTimestamp(TO - 12 * 60, 'UTC')})`)
			expect(text).toContain(`• the paper kites - Featherstone (${formatTimestamp(TO - 800 * 60, 'UTC')})`)
			expect(text).not.toContain('Filler')
			expect(text).not.toContain('On Air')
			expect(text).toContain('Scanned 1,240 of 1,240 scrobbles in range (complete)')
		})

		it('says there are no scrobbles by the artist after a complete scan with no match', async () => {
			getRecentTracks.mockImplementation(rangeStub(1240))

			const text = await textOf({ from: FROM, to: TO, artist: KITES })

			expect(text).toContain('No scrobbles by The Paper Kites in this range')
		})

		it('never claims no scrobbles after an incomplete scan, and says how to continue', async () => {
			getRecentTracks.mockImplementation(rangeStub(18400))

			const text = await textOf({ from: FROM, to: TO, artist: KITES })

			expect(text).not.toContain('No scrobbles by')
			expect(text).toContain('Scanned 5,000 of 18,400 scrobbles in range (incomplete)')
			expect(text).toContain('page: 2')
			expect(text).toContain('narrow from/to')
		})

		it('says nothing is left to scan when the block starts past the end of the range', async () => {
			getRecentTracks.mockImplementation(rangeStub(6500))

			const text = await textOf({ from: FROM, to: TO, artist: KITES, page: 3 })

			expect(text).toMatch(/nothing left to scan in this range/i)
			expect(text).not.toContain('No scrobbles by')
		})

		describe('range end', () => {
			const NOW = 1763100000

			beforeEach(() => {
				vi.useFakeTimers({ toFake: ['Date'] })
				vi.setSystemTime(NOW * 1000 + 400)
			})

			it('pins an open-ended range to the time of the call, for every page and the continuation', async () => {
				getRecentTracks.mockImplementation(rangeStub(18400))

				const text = await textOf({ from: FROM, artist: KITES })

				expect(getRecentTracks).toHaveBeenCalledTimes(5)
				for (const call of getRecentTracks.mock.calls) expect(call[3]).toBe(NOW)
				expect(text).toContain(`to: ${NOW}`)
				expect(text).toContain(`\`page: 2, to: ${NOW}\``)
			})

			it('uses the given to as is and continues with page alone', async () => {
				getRecentTracks.mockImplementation(rangeStub(18400))

				const text = await textOf({ from: FROM, to: TO, artist: KITES })

				for (const call of getRecentTracks.mock.calls) expect(call[3]).toBe(TO)
				expect(text).toContain('`page: 2`')
			})

			it('makes no completeness claim or definitive negative when the total changes between pages', async () => {
				const before = rangeStub(1240)
				const after = rangeStub(1241)
				getRecentTracks.mockImplementation(async (user, limit, from, to, page) =>
					(page === 1 ? before : after)(user, limit, from, to, page),
				)

				const text = await textOf({ artist: KITES })

				expect(text).not.toContain('(complete)')
				expect(text).not.toContain('No scrobbles by')
				expect(text).toMatch(/changed during the scan/)
				expect(text).toContain(`\`page: 1, to: ${NOW}\``)
			})
		})

		it('returns a tool error, not partial matches, when a page fails mid-scan', async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {})
			const serve = rangeStub(6500, { 10: [KITES, 'Bloom'] })
			getRecentTracks.mockImplementation(async (user, limit, from, to, page) => {
				if (page === 3) throw new Error('Last.fm API error: 8 - Operation failed')
				return serve(user, limit, from, to, page)
			})

			const text = await textOf({ from: FROM, to: TO, artist: KITES })

			expect(text).toMatch(/^Error in get_recent_tracks: /)
			expect(text).not.toContain('Bloom')
		})
	})
})
