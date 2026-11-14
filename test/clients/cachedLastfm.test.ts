// ABOUTME: Tests for CachedLastfmClient, the caching decorator around LastfmClient.
// ABOUTME: Checks tally counting, shared tag top-artist lookups, and that partial recommendation candidate lists are not cached.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { CachedLastfmClient } from '../../src/clients/cachedLastfm'
import type { LastfmClient } from '../../src/clients/lastfm'
import type { CandidateList } from '../../src/recommendations/types'
import { runWithCacheTally, type CacheTally } from '../../src/utils/cacheTally'

/** A Map-backed KV with just the methods SmartCache calls. */
function memoryKV(): KVNamespace {
	const store = new Map<string, string>()
	return {
		get: async (key: string) => store.get(key) ?? null,
		put: async (key: string, value: string) => {
			store.set(key, value)
		},
		delete: async (key: string) => {
			store.delete(key)
		},
		list: async () => ({ keys: [...store.keys()].map((name) => ({ name })) }),
	} as unknown as KVNamespace
}

describe('CachedLastfmClient', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('cache tally', () => {
		it('should count lookups into the current tally', async () => {
			const getArtistInfo = vi.fn().mockResolvedValue({ artist: { name: 'Radiohead' } })
			const tally: CacheTally = { hits: 0, misses: 0, requests: 0 }
			const client = new CachedLastfmClient({ getArtistInfo } as unknown as LastfmClient, memoryKV())

			await runWithCacheTally(tally, async () => {
				await client.getArtistInfo('Radiohead')
				await client.getArtistInfo('Radiohead')
			})

			expect(getArtistInfo).toHaveBeenCalledTimes(1)
			expect(tally).toEqual({ hits: 1, misses: 1, requests: 0 })
		})
	})

	describe('getTagTopArtists', () => {
		it('should share one lookup across tag spellings that differ only in case', async () => {
			const getTagTopArtists = vi.fn().mockResolvedValue({ topartists: { artist: [] } })
			const client = new CachedLastfmClient({ getTagTopArtists } as unknown as LastfmClient, memoryKV())

			await client.getTagTopArtists('Shoegaze')
			await client.getTagTopArtists('shoegaze')

			expect(getTagTopArtists).toHaveBeenCalledTimes(1)
			expect(getTagTopArtists).toHaveBeenCalledWith('Shoegaze', 500)
		})
	})

	describe('getRecommendationCandidates', () => {
		const list = (partial: boolean): CandidateList => ({
			candidates: [{ name: 'Slowdive', score: 1.5, seeds: [], source: 'similar' }],
			libraryComplete: false,
			libraryPageSize: 1000,
			partial,
			genreNotFound: false,
			emptyHistory: false,
		})

		it('should build again after a partial list', async () => {
			const build = vi.fn().mockResolvedValue(list(true))
			const client = new CachedLastfmClient({} as LastfmClient, memoryKV())

			await expect(client.getRecommendationCandidates('u', undefined, build)).resolves.toEqual(list(true))
			await client.getRecommendationCandidates('u', undefined, build)

			expect(build).toHaveBeenCalledTimes(2)
		})

		it('should cache a complete list per user and genre', async () => {
			const build = vi.fn().mockResolvedValue(list(false))
			const client = new CachedLastfmClient({} as LastfmClient, memoryKV())

			await client.getRecommendationCandidates('u', 'Shoegaze', build)
			await expect(client.getRecommendationCandidates('u', ' shoegaze ', build)).resolves.toEqual(list(false))
			await client.getRecommendationCandidates('u', undefined, build)

			expect(build).toHaveBeenCalledTimes(2)
		})
	})
})
