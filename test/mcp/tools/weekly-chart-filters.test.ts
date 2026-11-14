// ABOUTME: Tests the artist and limit filters on get_weekly_artist_chart and get_weekly_track_chart.
// ABOUTME: Drives the registered handlers through a stub server and a stubbed Last.fm client.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { z } from 'zod'

import type { CachedLastfmClient } from '../../../src/clients/cachedLastfm'
import { registerAuthenticatedTools } from '../../../src/mcp/tools/authenticated'

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>

interface ToolMeta {
	inputSchema: z.ZodType
}

const FROM = 1700000000
const TO = 1700600000

/** 40 artists; The Paper Kites sits at position 35 with a single play. */
function artistChart() {
	return Array.from({ length: 40 }, (_, i) =>
		i === 34 ? { name: 'The Paper Kites', playcount: '1' } : { name: `Artist ${i + 1}`, playcount: String(100 - i) },
	)
}

const trackChart = [
	{ name: 'Alison', artist: { '#text': 'Slowdive' }, playcount: '9' },
	{ name: 'Holocene', artist: { '#text': 'Bon Iver' }, playcount: '8' },
	{ name: 'When the Sun Hits', artist: { '#text': 'Slowdive' }, playcount: '7' },
	{ name: 'Wasteland', artist: { '#text': 'Slowdive Tribute' }, playcount: '6' },
]

describe('weekly chart artist and limit filters', () => {
	const tools = new Map<string, { meta: ToolMeta; handler: ToolHandler }>()
	let artists: unknown
	let hasArtistKey: boolean

	beforeEach(() => {
		tools.clear()
		artists = artistChart()
		hasArtistKey = true
		const server = {
			registerTool: (name: string, meta: ToolMeta, handler: ToolHandler) => {
				tools.set(name, { meta, handler })
			},
		}
		const client = {
			getWeeklyArtistChart: vi.fn(async () => ({ weeklyartistchart: hasArtistKey ? { artist: artists } : {} })),
			getWeeklyTrackChart: vi.fn(async () => ({ weeklytrackchart: { track: trackChart } })),
		} as unknown as CachedLastfmClient
		registerAuthenticatedTools(server as never, client, () => ({ username: 'rj', sessionKey: 'key' }))
	})

	/** Calls a handler with arguments parsed by the tool's own schema, as the SDK does. */
	async function textOf(name: string, args: Record<string, unknown> = {}): Promise<string> {
		const { meta, handler } = tools.get(name)!
		const result = await handler(meta.inputSchema.parse({ from: FROM, to: TO, ...args }) as Record<string, unknown>)
		return result.content[0].text
	}

	const numberedRows = (text: string) => text.split('\n').filter((line) => /^\d+\. /.test(line))
	const nextSteps = (text: string) => text.split('**Next steps:**')[1] ?? ''

	describe('get_weekly_artist_chart', () => {
		it('shows the top 30 by default with a note', async () => {
			const text = await textOf('get_weekly_artist_chart')
			expect(numberedRows(text)).toHaveLength(30)
			expect(text).toContain('Showing top 30')
		})

		it('respects limit', async () => {
			const text = await textOf('get_weekly_artist_chart', { limit: 5 })
			expect(numberedRows(text)).toHaveLength(5)
			expect(text).toContain('Showing top 5')
		})

		it('finds an artist past the limit, case-insensitively, and lists no other artist', async () => {
			const text = await textOf('get_weekly_artist_chart', { artist: 'the paper kites' })
			expect(text).toContain('#35 of 40')
			expect(text).toContain('The Paper Kites (1 play)')
			expect(text).not.toContain('Artist 1 ')
			expect(numberedRows(text)).toHaveLength(0)
		})

		it('suggests expanding the matched artist and keeps the filter on the track chart step', async () => {
			const steps = nextSteps(await textOf('get_weekly_artist_chart', { artist: 'the paper kites' }))
			expect(steps).toContain('- `get_artist_info(artist="The Paper Kites")`')
			expect(steps).not.toContain('Artist 1')
			expect(steps).toContain(`- \`get_weekly_track_chart(from=${FROM}, to=${TO}, artist="the paper kites")\``)
		})

		it('says the artist is absent and suggests near matches', async () => {
			const text = await textOf('get_weekly_artist_chart', { artist: 'Paper Kites' })
			expect(text).toContain("doesn't appear in this period")
			expect(text).toContain('The Paper Kites')
		})

		it('finds the artist when Last.fm returns a single object instead of an array', async () => {
			artists = { name: 'The Paper Kites', playcount: '3' }
			const text = await textOf('get_weekly_artist_chart', { artist: 'The Paper Kites' })
			expect(text).toContain('#1 of 1')
			expect(text).toContain('The Paper Kites (3 plays)')
		})

		it.each([
			['an empty array', () => (artists = [])],
			['a missing artist key', () => (hasArtistKey = false)],
		])('treats %s as an empty chart', async (_label, arrange) => {
			arrange()
			const text = await textOf('get_weekly_artist_chart', { artist: 'The Paper Kites' })
			expect(text).toContain("doesn't appear in this period")
			expect(text).not.toContain('Did you mean')
		})

		it('rejects limit 0 and 1001', () => {
			const { meta } = tools.get('get_weekly_artist_chart')!
			expect(meta.inputSchema.safeParse({ limit: 0 }).success).toBe(false)
			expect(meta.inputSchema.safeParse({ limit: 1001 }).success).toBe(false)
		})
	})

	describe('get_weekly_track_chart', () => {
		it("lists every track by the artist with its chart position and no other artist's", async () => {
			const text = await textOf('get_weekly_track_chart', { artist: 'slowdive', limit: 1 })
			expect(text).toContain('#1 ')
			expect(text).toContain('Alison')
			expect(text).toContain('#3 ')
			expect(text).toContain('When the Sun Hits')
			expect(text).not.toContain('Holocene')
			expect(text).not.toContain('Wasteland')
		})

		it('suggests expanding the first matched track and keeps the filter on the artist chart step', async () => {
			const steps = nextSteps(await textOf('get_weekly_track_chart', { artist: 'bon iver' }))
			expect(steps).toContain('- `get_track_info(artist="Bon Iver", track="Holocene")`')
			expect(steps).not.toContain('Alison')
			expect(steps).toContain(`- \`get_weekly_artist_chart(from=${FROM}, to=${TO}, artist="bon iver")\``)
		})

		it('suggests chart artists when there is no exact match', async () => {
			const text = await textOf('get_weekly_track_chart', { artist: 'Slow' })
			expect(text).toContain("doesn't appear in this period")
			expect(text).toContain('Slowdive')
			expect(text).toContain('Slowdive Tribute')
		})

		it('respects limit', async () => {
			const text = await textOf('get_weekly_track_chart', { limit: 2 })
			expect(numberedRows(text)).toHaveLength(2)
			expect(text).toContain('Showing top 2')
		})

		it('rejects limit 0 and 1001', () => {
			const { meta } = tools.get('get_weekly_track_chart')!
			expect(meta.inputSchema.safeParse({ limit: 0 }).success).toBe(false)
			expect(meta.inputSchema.safeParse({ limit: 1001 }).success).toBe(false)
		})
	})
})
