// ABOUTME: Tests that listening-history and similar-artist tool results suggest get_music_recommendations as a next step.
// ABOUTME: Drives the registered tool handlers through a stub server and a stubbed Last.fm client.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { z } from 'zod'

import type { CachedLastfmClient } from '../../../src/clients/cachedLastfm'
import { registerAuthenticatedTools } from '../../../src/mcp/tools/authenticated'
import { registerPublicTools } from '../../../src/mcp/tools/public'

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>

interface ToolMeta {
	inputSchema: z.ZodType
}

const HINT = '- `get_music_recommendations()` — new-to-you artists based on your listening, with starter tracks'

const track = { name: 'Alison', artist: { '#text': 'Slowdive' }, album: { '#text': 'Souvlaki' }, date: { uts: '1700000000' } }

function stubClient() {
	return {
		getRecentTracks: vi.fn(async () => ({ recenttracks: { track: [track], '@attr': { page: '1', totalPages: '1', total: '1' } } })),
		getTopArtists: vi.fn(async () => ({
			topartists: { artist: [{ name: 'Slowdive', playcount: '10', url: '' }], '@attr': { total: '1' } },
		})),
		getLovedTracks: vi.fn(async () => ({ lovedtracks: { track: [track], '@attr': { total: '1' } } })),
		getSimilarArtists: vi.fn(async () => ({ similarartists: { artist: [{ name: 'Mojave 3', match: '0.9', url: '' }] } })),
	}
}

describe('get_music_recommendations next-step hint', () => {
	const tools = new Map<string, { meta: ToolMeta; handler: ToolHandler }>()

	beforeEach(() => {
		tools.clear()
		const server = {
			registerTool: (name: string, meta: ToolMeta, handler: ToolHandler) => {
				tools.set(name, { meta, handler })
			},
		}
		const client = stubClient() as unknown as CachedLastfmClient
		registerAuthenticatedTools(server as never, client, () => ({ username: 'rj', sessionKey: 'key' }))
		registerPublicTools(server as never, client, () => ({ username: 'rj', sessionKey: 'key' }))
	})

	/** Calls a handler with arguments parsed by the tool's own schema, as the SDK does. */
	async function textOf(name: string, args: Record<string, unknown> = {}): Promise<string> {
		const { meta, handler } = tools.get(name)!
		const result = await handler(meta.inputSchema.parse(args) as Record<string, unknown>)
		return result.content[0].text
	}

	it.each([
		['lastfm_auth_status', {}],
		['get_recent_tracks', {}],
		['get_top_artists', {}],
		['get_loved_tracks', {}],
		['get_similar_artists', { artist: 'Slowdive' }],
	])('%s suggests get_music_recommendations', async (name, args) => {
		expect(await textOf(name, args)).toContain(HINT)
	})

	it('get_similar_artists adds the hint after its existing next steps', async () => {
		const steps = (await textOf('get_similar_artists', { artist: 'Slowdive' })).split('**Next steps:**\n')[1].split('\n')
		expect(steps.map((line) => line.match(/`(\w+)\(/)?.[1])).toEqual([
			'get_artist_info',
			'get_artist_top_tracks',
			'get_music_recommendations',
		])
	})
})
