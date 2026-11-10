// ABOUTME: Tests that get_album_info and get_artist_info results carry one ListenToMore link line.
// ABOUTME: Calls the registered public tool handlers directly with a stub server and Last.fm client.
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { CachedLastfmClient } from '../../../src/clients/cachedLastfm'
import { registerPublicTools } from '../../../src/mcp/tools/public'

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>

const LOOKUP = 'listentomore.com/lookup'

function albumInfo(overrides: Record<string, unknown> = {}) {
	return {
		album: {
			name: 'OK Computer',
			artist: 'Radiohead',
			playcount: '1000',
			listeners: '500',
			tags: { tag: [{ name: 'alternative' }] },
			tracks: { track: [{ name: 'Airbag' }] },
			wiki: { summary: 'An album.' },
			...overrides,
		},
	}
}

function artistInfo(overrides: Record<string, unknown> = {}) {
	return {
		artist: {
			name: 'Radiohead',
			stats: { playcount: '1000', listeners: '500' },
			tags: { tag: [{ name: 'alternative' }] },
			similar: { artist: [{ name: 'Muse' }] },
			bio: { summary: 'A band.' },
			...overrides,
		},
	}
}

describe('ListenToMore link in public tool results', () => {
	const handlers = new Map<string, ToolHandler>()
	const client = {
		getAlbumInfo: vi.fn(),
		getArtistInfo: vi.fn(),
		getTrackInfo: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
		handlers.clear()
		const server = {
			registerTool: (name: string, _meta: unknown, handler: ToolHandler) => {
				handlers.set(name, handler)
			},
		}
		registerPublicTools(server as never, client as unknown as CachedLastfmClient, () => 'https://example.com')
		client.getAlbumInfo.mockResolvedValue(albumInfo())
		client.getArtistInfo.mockResolvedValue(artistInfo())
		client.getTrackInfo.mockResolvedValue({
			track: {
				name: 'Airbag',
				artist: { '#text': 'Radiohead' },
				album: { '#text': 'OK Computer' },
				playcount: '10',
				listeners: '5',
				toptags: { tag: [] },
			},
		})
	})

	async function textOf(tool: string, args: Record<string, unknown>) {
		const result = await handlers.get(tool)!(args)
		return result.content[0].text
	}

	it('get_album_info includes one link built from the names Last.fm returned', async () => {
		const text = await textOf('get_album_info', { artist: 'radiohead', album: 'ok computer' })
		expect(text.split(LOOKUP).length - 1).toBe(1)
		expect(text).toContain('https://listentomore.com/lookup?artist=Radiohead&album=OK+Computer&ref=lastfm-mcp')
	})

	it('get_artist_info includes one link', async () => {
		const text = await textOf('get_artist_info', { artist: 'radiohead' })
		expect(text.split(LOOKUP).length - 1).toBe(1)
		expect(text).toContain('https://listentomore.com/lookup?artist=Radiohead&ref=lastfm-mcp')
	})

	it('puts the link before the Next steps block', async () => {
		for (const [tool, args] of [
			['get_album_info', { artist: 'radiohead', album: 'ok computer' }],
			['get_artist_info', { artist: 'radiohead' }],
		] as const) {
			const text = await textOf(tool, args)
			expect(text.indexOf(LOOKUP)).toBeGreaterThan(-1)
			expect(text.indexOf(LOOKUP)).toBeLessThan(text.indexOf('**Next steps:**'))
		}
	})

	it('still includes the link when there is no description or bio', async () => {
		client.getAlbumInfo.mockResolvedValue(albumInfo({ wiki: undefined }))
		client.getArtistInfo.mockResolvedValue(artistInfo({ bio: undefined }))
		expect(await textOf('get_album_info', { artist: 'radiohead', album: 'ok computer' })).toContain(LOOKUP)
		expect(await textOf('get_artist_info', { artist: 'radiohead' })).toContain(LOOKUP)
	})

	it('other public tools carry no ListenToMore link', async () => {
		const text = await textOf('get_track_info', { artist: 'radiohead', track: 'airbag' })
		expect(text).not.toContain('listentomore.com')
	})
})
