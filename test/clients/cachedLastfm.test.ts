// ABOUTME: Tests for CachedLastfmClient, the caching decorator around LastfmClient.
// ABOUTME: Checks that the per-request cache tally handed to the constructor counts the client's lookups.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { CachedLastfmClient } from '../../src/clients/cachedLastfm'
import type { LastfmClient } from '../../src/clients/lastfm'
import type { CacheTally } from '../../src/utils/cache'

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
		it('should count lookups on the tally it was given', async () => {
			const getArtistInfo = vi.fn().mockResolvedValue({ artist: { name: 'Radiohead' } })
			const tally: CacheTally = { hits: 0, misses: 0 }
			const client = new CachedLastfmClient({ getArtistInfo } as unknown as LastfmClient, memoryKV(), tally)

			await client.getArtistInfo('Radiohead')
			await client.getArtistInfo('Radiohead')

			expect(getArtistInfo).toHaveBeenCalledTimes(1)
			expect(tally).toEqual({ hits: 1, misses: 1 })
		})
	})
})
