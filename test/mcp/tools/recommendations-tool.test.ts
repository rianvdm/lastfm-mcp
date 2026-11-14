// ABOUTME: Tests for the get_music_recommendations tool registration: input schema, auth check, engine call and errors.
// ABOUTME: Captures the schema and handler from a stub server and drives them with a stubbed Last.fm client.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { z } from 'zod'

import type { CachedLastfmClient } from '../../../src/clients/cachedLastfm'
import type { CandidateList } from '../../../src/recommendations/types'
import { AUTH_REQUIRED_HEADING, registerAuthenticatedTools, type AuthSession } from '../../../src/mcp/tools/authenticated'

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>

interface ToolMeta {
	description: string
	inputSchema: z.ZodType
}

function topArtists(names: string[]) {
	return { topartists: { artist: names.map((name) => ({ name, playcount: '1', url: '' })), '@attr': { total: String(names.length) } } }
}

function stubClient() {
	return {
		getTopArtists: vi.fn(async (_username: string, _period: string) => topArtists(['Slowdive'])),
		getSimilarArtists: vi.fn(async () => ({
			similarartists: {
				artist: [
					{ name: 'Mojave 3', match: '0.9', url: '' },
					{ name: 'Chapterhouse', match: '0.5', url: '' },
				],
			},
		})),
		getTagTopArtists: vi.fn(async () => ({ topartists: { artist: [{ name: 'Mojave 3', url: '' }] } })),
		getArtistTopAlbums: vi.fn(async (artist: string) => ({ topalbums: { album: [{ name: `${artist} LP` }] } })),
		getArtistTopTracks: vi.fn(async (artist: string) => ({ toptracks: { track: [{ name: `${artist} T1` }] } })),
		getRecommendationCandidates: vi.fn((_username: string, _genre: string | undefined, build: () => Promise<CandidateList>) => build()),
	}
}

describe('get_music_recommendations tool', () => {
	let meta: ToolMeta
	let handler: ToolHandler
	let client: ReturnType<typeof stubClient>
	let session: AuthSession | null

	beforeEach(() => {
		client = stubClient()
		session = { username: 'rj', sessionKey: 'key' }
		const server = {
			registerTool: (name: string, toolMeta: ToolMeta, toolHandler: ToolHandler) => {
				if (name !== 'get_music_recommendations') return
				meta = toolMeta
				handler = toolHandler
			},
		}
		registerAuthenticatedTools(server as never, client as unknown as CachedLastfmClient, () => session)
	})

	/** Calls the handler with arguments parsed by the tool's own schema, as the SDK does. */
	async function call(args: Record<string, unknown> = {}): Promise<string> {
		const result = await handler(meta.inputSchema.parse(args) as Record<string, unknown>)
		return result.content[0].text
	}

	describe('input schema', () => {
		it('should default limit to 8 and exclude to an empty list', () => {
			expect(meta.inputSchema.safeParse({})).toMatchObject({ success: true, data: { limit: 8, exclude: [] } })
		})

		it('should accept a limit from 1 to 15 and reject anything outside it', () => {
			expect(meta.inputSchema.safeParse({ limit: 15 }).success).toBe(true)
			expect(meta.inputSchema.safeParse({ limit: '3' })).toMatchObject({ success: true, data: { limit: 3 } })
			expect(meta.inputSchema.safeParse({ limit: 16 }).success).toBe(false)
			expect(meta.inputSchema.safeParse({ limit: 0 }).success).toBe(false)
			expect(meta.inputSchema.safeParse({ limit: 2.5 }).success).toBe(false)
		})

		it('should trim exclude names, reject blank ones and cap the list at 50', () => {
			expect(meta.inputSchema.safeParse({ exclude: [' Slowdive '] })).toMatchObject({ success: true, data: { exclude: ['Slowdive'] } })
			expect(meta.inputSchema.safeParse({ exclude: ['  '] }).success).toBe(false)
			expect(meta.inputSchema.safeParse({ exclude: Array.from({ length: 50 }, (_, i) => `a${i}`) }).success).toBe(true)
			expect(meta.inputSchema.safeParse({ exclude: Array.from({ length: 51 }, (_, i) => `a${i}`) }).success).toBe(false)
		})

		it('should trim the genre', () => {
			expect(meta.inputSchema.safeParse({ genre: ' Shoegaze ' })).toMatchObject({ success: true, data: { genre: 'Shoegaze' } })
		})
	})

	it('should carry the description agents choose it by', () => {
		expect(meta.description).toBe(
			'Find new music for the signed-in user: artists they don\'t already listen to, ranked by how strongly their recent and long-term listening points to them, each with the reason from their own Last.fm data plus a starter album and tracks. Use this for "what should I listen to?", "recommend something", "find me new music" or "like X but new to me", instead of chaining get_similar_artists calls. Optional genre filter; pass exclude with earlier picks to get different ones. REQUIRES AUTHENTICATION',
		)
	})

	it('should ask for sign-in without a session', async () => {
		session = null
		const text = await call()
		expect(text.startsWith(AUTH_REQUIRED_HEADING)).toBe(true)
		expect(client.getTopArtists).not.toHaveBeenCalled()
	})

	it("should recommend for the session's user and honour limit and exclude", async () => {
		const text = await call({ limit: 1, exclude: ['mojave 3'] })
		expect(client.getTopArtists).toHaveBeenCalledWith('rj', '7day', expect.any(Number), { forceRefresh: true })
		expect(text.startsWith('🎯 **New music for rj**\n')).toBe(true)
		expect(text).toContain('**1. Chapterhouse**')
		expect(text).not.toContain('**1. Mojave 3**')
		expect(text).not.toContain('**2.')
	})

	it('should recommend for another user when a username is given', async () => {
		const text = await call({ username: 'friend' })
		expect(client.getTopArtists).toHaveBeenCalledWith('friend', '7day', expect.any(Number), { forceRefresh: true })
		expect(text).toContain('🎯 **New music for friend**')
	})

	it("should build the next exclude list from the request and this call's picks", async () => {
		const text = await call({ limit: 1, exclude: ['Mojave 3'] })
		expect(text).toContain('- `get_music_recommendations(exclude=["Mojave 3","Chapterhouse"])` — different picks')
	})

	it('should carry an explicit username into Next steps, and leave it out otherwise', async () => {
		expect(await call({ username: 'friend', limit: 1 })).toContain('get_music_recommendations(username="friend", exclude=')
		expect(await call({ limit: 1 })).toContain('get_music_recommendations(exclude=["Mojave 3"])')
	})

	it('should pass a genre through and treat a blank one as unset', async () => {
		expect(await call({ genre: ' Shoegaze ' })).toContain('🎯 **New music for rj** · Shoegaze')
		expect(client.getTagTopArtists).toHaveBeenCalledWith('shoegaze', expect.any(Number))

		client.getTagTopArtists.mockClear()
		const text = await call({ genre: '   ' })
		expect(text.split('\n')[0]).toBe('🎯 **New music for rj**')
		expect(client.getTagTopArtists).not.toHaveBeenCalled()
		expect(client.getRecommendationCandidates).toHaveBeenLastCalledWith('rj', undefined, expect.any(Function))
	})

	it('should return a tool error when the engine throws', async () => {
		client.getTopArtists.mockRejectedValue(new Error('Last.fm API error 8: Operation failed'))
		const text = await call()
		expect(text.startsWith('Error in get_music_recommendations: Last.fm API error 8: Operation failed')).toBe(true)
	})
})
