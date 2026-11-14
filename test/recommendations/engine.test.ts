// ABOUTME: Tests for the recommendation engine, mostly with a stubbed CachedLastfmClient, some through the real clients and a fake Last.fm.
// ABOUTME: Covers seeds, fan-out, genre, exclude, starters, partial results on rate limits, budgets and the deadline, and the cache.

import { describe, it, expect, vi, afterEach } from 'vitest'

import { CachedLastfmClient } from '../../src/clients/cachedLastfm'
import { LastfmClient } from '../../src/clients/lastfm'
import type { CandidateList } from '../../src/recommendations/types'
import {
	LIBRARY_PAGE_SIZE,
	SEED_LIMITS,
	SIMILAR_LIMIT,
	STARTER_LIMIT,
	TAG_PAGE_SIZE,
	findRecommendations,
} from '../../src/recommendations/engine'
import { RECOMMENDATION_POLICY, RequestBudgetExceeded, withPolicy } from '../../src/utils/lastfmRequestPolicy'

type Period = '7day' | '1month' | '12month' | 'overall'

interface StubData {
	/** Each window's top artist names in rank order; a window left out comes back empty, an Error rejects. */
	windows?: Partial<Record<Period, string[] | Error>>
	/** `@attr.total` for the overall window; defaults to the number of overall names. */
	overallTotal?: number
	/** Similar artists per seed name as [name, match] pairs; an Error rejects that lookup. */
	similar?: Record<string, Array<[string, number]> | Error>
	/** The tag's top artist names in rank order, or an Error to reject. */
	tag?: string[] | Error
	/** Overrides for the starter lookups; by default every artist has albums and tracks. */
	albums?: (artist: string) => Promise<unknown>
	tracks?: (artist: string) => Promise<unknown>
}

function topArtists(names: string[], total = names.length) {
	return {
		topartists: {
			artist: names.map((name) => ({ name, playcount: '1', url: '' })),
			'@attr': { user: 'rj', totalPages: '1', page: '1', perPage: String(LIBRARY_PAGE_SIZE), total: String(total) },
		},
	}
}

function albumsFor(artist: string) {
	return { topalbums: { album: [{ name: `${artist} LP1` }, { name: `${artist} LP2` }], '@attr': { artist } } }
}

function tracksFor(artist: string) {
	return { toptracks: { track: [{ name: `${artist} T1` }, { name: `${artist} T2` }, { name: `${artist} T3` }], '@attr': { artist } } }
}

function stubClient(data: StubData = {}) {
	const getTopArtists = vi.fn(async (_username: string, period: Period) => {
		const window = data.windows?.[period] ?? []
		if (window instanceof Error) throw window
		return topArtists(window, period === 'overall' ? (data.overallTotal ?? window.length) : window.length)
	})
	const getSimilarArtists = vi.fn(async (artist: string) => {
		const similar = data.similar?.[artist] ?? []
		if (similar instanceof Error) throw similar
		return { similarartists: { artist: similar.map(([name, match]) => ({ name, match: String(match), url: '' })), '@attr': { artist } } }
	})
	const getTagTopArtists = vi.fn(async () => {
		const tag = data.tag ?? []
		if (tag instanceof Error) throw tag
		return { topartists: { artist: tag.map((name) => ({ name, url: '' })) } }
	})
	const getArtistTopAlbums = vi.fn(data.albums ?? (async (artist: string) => albumsFor(artist)))
	const getArtistTopTracks = vi.fn(data.tracks ?? (async (artist: string) => tracksFor(artist)))
	const getRecommendationCandidates = vi.fn((_username: string, _genre: string | undefined, build: () => Promise<CandidateList>) => build())

	const stub = { getTopArtists, getSimilarArtists, getTagTopArtists, getArtistTopAlbums, getArtistTopTracks, getRecommendationCandidates }
	return { client: stub as unknown as CachedLastfmClient, ...stub }
}

const BASE: StubData = {
	windows: { '7day': ['Slowdive'], overall: ['Slowdive', 'Ride'] },
	similar: {
		Slowdive: [
			['Mojave 3', 0.9],
			['Ride', 0.8],
			['Chapterhouse', 0.5],
		],
		Ride: [
			['Chapterhouse', 0.7],
			['Swervedriver', 0.6],
		],
	},
}

describe('findRecommendations', () => {
	it('should return picks with seeds, one album and two tracks', async () => {
		const { client, getTopArtists, getSimilarArtists, getArtistTopAlbums, getArtistTopTracks } = stubClient(BASE)

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result).toMatchObject({
			username: 'rj',
			partial: false,
			genreNotFound: false,
			emptyHistory: false,
			libraryChecked: true,
			libraryComplete: true,
			libraryPageSize: LIBRARY_PAGE_SIZE,
		})
		expect(result.genre).toBeUndefined()
		expect(result.picks.map((pick) => pick.name)).toEqual(['Mojave 3', 'Chapterhouse', 'Swervedriver'])
		expect(result.picks[0]).toEqual({
			name: 'Mojave 3',
			seeds: [{ name: 'Slowdive', window: '7day', rank: 1 }],
			source: 'similar',
			album: 'Mojave 3 LP1',
			tracks: ['Mojave 3 T1', 'Mojave 3 T2'],
		})
		expect(result.picks[1].seeds.map((seed) => seed.name)).toEqual(['Slowdive', 'Ride'])

		expect(getTopArtists).toHaveBeenCalledWith('rj', '7day', SEED_LIMITS['7day'], { forceRefresh: true })
		expect(getTopArtists).toHaveBeenCalledWith('rj', '1month', SEED_LIMITS['1month'], { forceRefresh: true })
		expect(getTopArtists).toHaveBeenCalledWith('rj', '12month', SEED_LIMITS['12month'], { forceRefresh: true })
		expect(getTopArtists).toHaveBeenCalledWith('rj', 'overall', LIBRARY_PAGE_SIZE, { forceRefresh: true })
		expect(getSimilarArtists).toHaveBeenCalledWith('Slowdive', SIMILAR_LIMIT)
		expect(getArtistTopAlbums).toHaveBeenCalledWith('Mojave 3', STARTER_LIMIT)
		expect(getArtistTopTracks).toHaveBeenCalledWith('Mojave 3', STARTER_LIMIT)
	})

	it('should run every Last.fm request under the recommendation policy', async () => {
		const seen: Array<{ maxRetries?: number; maxDelayMs?: number; signal: boolean }> = []
		const underPolicy = (artist: string) =>
			withPolicy(async (retry, signal) => {
				seen.push({ maxRetries: retry.maxRetries, maxDelayMs: retry.maxDelayMs, signal: signal !== undefined })
				return albumsFor(artist)
			})
		const { client } = stubClient({ ...BASE, albums: underPolicy })

		await findRecommendations(client, 'rj', { limit: 2, exclude: [] })

		expect(seen).toEqual([
			{ maxRetries: RECOMMENDATION_POLICY.maxRetries, maxDelayMs: RECOMMENDATION_POLICY.maxRetryDelayMs, signal: true },
			{ maxRetries: RECOMMENDATION_POLICY.maxRetries, maxDelayMs: RECOMMENDATION_POLICY.maxRetryDelayMs, signal: true },
		])
	})

	it('should cap picks at limit and fetch starters only for them', async () => {
		const { client, getArtistTopAlbums } = stubClient(BASE)

		const result = await findRecommendations(client, 'rj', { limit: 1, exclude: [] })

		expect(result.picks.map((pick) => pick.name)).toEqual(['Mojave 3'])
		expect(getArtistTopAlbums).toHaveBeenCalledTimes(1)
	})

	it('should report libraryComplete false when the overall list is longer than one page', async () => {
		const { client } = stubClient({ ...BASE, overallTotal: LIBRARY_PAGE_SIZE + 1 })

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result.libraryComplete).toBe(false)
	})

	it('should skip a seed whose similar lookup fails with error 6 and not mark partial', async () => {
		const { client } = stubClient({
			...BASE,
			similar: { ...BASE.similar, Slowdive: new Error('Last.fm API error 6: The artist you supplied could not be found') },
		})

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result.partial).toBe(false)
		expect(result.picks.map((pick) => pick.name)).toEqual(['Chapterhouse', 'Swervedriver'])
	})

	it('should mark partial and keep earlier picks when Last.fm rate-limits mid-way', async () => {
		const { client } = stubClient({
			...BASE,
			similar: { ...BASE.similar, Ride: new Error('Last.fm API error 29: Rate limit exceeded') },
		})

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result.partial).toBe(true)
		expect(result.picks.map((pick) => pick.name)).toEqual(['Mojave 3', 'Chapterhouse'])
	})

	it('should mark partial when a similar lookup runs out of budget', async () => {
		const { client } = stubClient({ ...BASE, similar: { ...BASE.similar, Ride: new RequestBudgetExceeded('budget') } })

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result.partial).toBe(true)
		expect(result.picks.map((pick) => pick.name)).toEqual(['Mojave 3', 'Chapterhouse'])
	})

	it('should mark partial when a similar lookup fails with a server error', async () => {
		const { client } = stubClient({ ...BASE, similar: { ...BASE.similar, Ride: new Error('HTTP 500: Internal Server Error') } })

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result.partial).toBe(true)
		expect(result.picks.map((pick) => pick.name)).toEqual(['Mojave 3', 'Chapterhouse'])
	})

	it('should mark partial when a starter lookup fails with a server error', async () => {
		const { client } = stubClient({
			...BASE,
			tracks: async () => {
				throw new Error('HTTP 500: Internal Server Error')
			},
		})

		const result = await findRecommendations(client, 'rj', { limit: 1, exclude: [] })

		expect(result.partial).toBe(true)
		expect(result.picks[0]).toMatchObject({ name: 'Mojave 3', album: 'Mojave 3 LP1', tracks: [] })
	})

	it('should return picks without starters when the budget runs out', async () => {
		const spent = async () => {
			throw new RequestBudgetExceeded('budget')
		}
		const { client } = stubClient({ ...BASE, albums: spent, tracks: spent })

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result.partial).toBe(true)
		expect(result.picks.map((pick) => pick.name)).toEqual(['Mojave 3', 'Chapterhouse', 'Swervedriver'])
		for (const pick of result.picks) {
			expect(pick.album).toBeUndefined()
			expect(pick.tracks).toEqual([])
		}
	})

	it('should leave a pick without starters and not mark partial when its top lists are empty or unknown', async () => {
		const { client } = stubClient({
			...BASE,
			albums: async (artist) => ({ topalbums: { album: [], '@attr': { artist } } }),
			tracks: async () => {
				throw new Error('Last.fm API error 6: The artist you supplied could not be found')
			},
		})

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result.partial).toBe(false)
		expect(result.picks[0]).toMatchObject({ name: 'Mojave 3', tracks: [] })
		expect(result.picks[0].album).toBeUndefined()
	})

	it('should accept a single album or track that Last.fm returns as a bare object', async () => {
		const { client } = stubClient({
			...BASE,
			albums: async (artist) => ({ topalbums: { album: { name: `${artist} Only LP` }, '@attr': { artist } } }),
			tracks: async (artist) => ({ toptracks: { track: { name: `${artist} Only Track` }, '@attr': { artist } } }),
		})

		const result = await findRecommendations(client, 'rj', { limit: 1, exclude: [] })

		expect(result.picks[0]).toMatchObject({ album: 'Mojave 3 Only LP', tracks: ['Mojave 3 Only Track'] })
	})

	it('should report emptyHistory when every window is empty', async () => {
		const { client, getSimilarArtists, getTagTopArtists } = stubClient({ windows: {} })

		const result = await findRecommendations(client, 'rj', { limit: 8, genre: 'shoegaze', exclude: [] })

		expect(result).toMatchObject({ emptyHistory: true, partial: false, picks: [] })
		expect(getSimilarArtists).not.toHaveBeenCalled()
		expect(getTagTopArtists).not.toHaveBeenCalled()
	})

	it('should use whatever windows have data', async () => {
		const { client, getSimilarArtists } = stubClient({
			windows: { '7day': [], overall: ['Ride'] },
			similar: { Ride: [['Swervedriver', 0.6]] },
		})

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result.emptyHistory).toBe(false)
		expect(getSimilarArtists).toHaveBeenCalledWith('Ride', SIMILAR_LIMIT)
		expect(result.picks).toEqual([
			{
				name: 'Swervedriver',
				seeds: [{ name: 'Ride', window: 'overall', rank: 1 }],
				source: 'similar',
				album: 'Swervedriver LP1',
				tracks: ['Swervedriver T1', 'Swervedriver T2'],
			},
		])
	})

	it('should continue and mark partial when some windows run out of budget', async () => {
		const { client } = stubClient({
			...BASE,
			windows: { ...BASE.windows, '1month': new RequestBudgetExceeded('deadline'), '12month': new Error('HTTP 429: Too Many Requests') },
		})

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result.partial).toBe(true)
		expect(result.picks.map((pick) => pick.name)).toEqual(['Mojave 3', 'Chapterhouse', 'Swervedriver'])
	})

	it('should mark partial when one window fails with a server error', async () => {
		const { client } = stubClient({ ...BASE, windows: { ...BASE.windows, '12month': new Error('HTTP 500: Internal Server Error') } })

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result.partial).toBe(true)
		expect(result.emptyHistory).toBe(false)
		expect(result.picks.map((pick) => pick.name)).toEqual(['Mojave 3', 'Chapterhouse', 'Swervedriver'])
	})

	it('should report libraryChecked false, not a complete library, when the overall lookup fails', async () => {
		const { client } = stubClient({ ...BASE, windows: { ...BASE.windows, overall: new Error('HTTP 500: Internal Server Error') } })

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result).toMatchObject({ libraryChecked: false, libraryComplete: false, partial: true })
		expect(result.picks.length).toBeGreaterThan(0)
	})

	it('should report libraryChecked true when only a recent window fails', async () => {
		const { client } = stubClient({ ...BASE, windows: { ...BASE.windows, '12month': new Error('HTTP 500: Internal Server Error') } })

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

		expect(result).toMatchObject({ libraryChecked: true, partial: true })
	})

	it('should rethrow when every window lookup fails', async () => {
		const notFound = new Error('Last.fm API error 6: User not found')
		const { client } = stubClient({ windows: { '7day': notFound, '1month': notFound, '12month': notFound, overall: notFound } })

		await expect(findRecommendations(client, 'nobody', { limit: 8, exclude: [] })).rejects.toThrow('User not found')
	})

	it('should keep only candidates in the genre and top up from the tag', async () => {
		const { client, getTagTopArtists } = stubClient({ ...BASE, tag: ['Ride', 'Chapterhouse', 'Lush', 'Pale Saints'] })

		const result = await findRecommendations(client, 'rj', { limit: 3, genre: 'shoegaze', exclude: [] })

		expect(getTagTopArtists).toHaveBeenCalledWith('shoegaze', TAG_PAGE_SIZE)
		expect(result.genre).toBe('shoegaze')
		expect(result.genreNotFound).toBe(false)
		expect(result.picks.map((pick) => [pick.name, pick.source, pick.tagRank])).toEqual([
			['Chapterhouse', 'similar', undefined],
			['Lush', 'tag', 3],
			['Pale Saints', 'tag', 4],
		])
		expect(result.picks[1].seeds).toEqual([])
	})

	it('should still find genre picks after a full exclude list removes the first top-ups', async () => {
		const tag = Array.from({ length: 80 }, (_, index) => `Tag Artist ${index + 1}`)
		const exclude = tag.slice(0, 50)
		const { client } = stubClient({ ...BASE, tag })

		const result = await findRecommendations(client, 'rj', { limit: 15, genre: 'shoegaze', exclude })

		expect(result.picks.map((pick) => pick.name)).toEqual(tag.slice(50, 65))
	})

	it('should report genreNotFound for an unknown tag', async () => {
		const { client } = stubClient({ ...BASE, tag: [] })

		const result = await findRecommendations(client, 'rj', { limit: 8, genre: 'notarealtag', exclude: [] })

		expect(result).toMatchObject({ genre: 'notarealtag', genreNotFound: true, partial: false, picks: [] })
	})

	it('should report genreNotFound when Last.fm answers the tag with error 6', async () => {
		const { client } = stubClient({ ...BASE, tag: new Error('Last.fm API error 6: Tag not found') })

		const result = await findRecommendations(client, 'rj', { limit: 8, genre: 'notarealtag', exclude: [] })

		expect(result).toMatchObject({ genreNotFound: true, partial: false, picks: [] })
	})

	it('should mark partial with no picks when the tag lookup runs out of budget', async () => {
		const { client } = stubClient({ ...BASE, tag: new RequestBudgetExceeded('deadline') })

		const result = await findRecommendations(client, 'rj', { limit: 8, genre: 'shoegaze', exclude: [] })

		expect(result).toMatchObject({ genreNotFound: false, partial: true, picks: [] })
	})

	it('should give the same candidates for "Post Rock" and "post rock"', async () => {
		const data: StubData = { ...BASE, tag: ['Mojave 3', 'Swervedriver'] }
		const first = stubClient(data)
		const second = stubClient(data)

		const upper = await findRecommendations(first.client, 'rj', { limit: 8, genre: ' Post Rock ', exclude: [] })
		const lower = await findRecommendations(second.client, 'rj', { limit: 8, genre: 'post rock', exclude: [] })

		expect(first.getTagTopArtists).toHaveBeenCalledWith('post rock', TAG_PAGE_SIZE)
		expect(second.getTagTopArtists).toHaveBeenCalledWith('post rock', TAG_PAGE_SIZE)
		expect(first.getRecommendationCandidates.mock.calls[0][1]).toBe('post rock')
		expect(second.getRecommendationCandidates.mock.calls[0][1]).toBe('post rock')
		expect(upper.picks).toEqual(lower.picks)
		expect(upper.genre).toBe('Post Rock')
	})

	it('should treat a whitespace-only genre as no genre', async () => {
		const { client, getTagTopArtists, getRecommendationCandidates } = stubClient(BASE)

		const result = await findRecommendations(client, 'rj', { limit: 8, genre: '   ', exclude: [] })

		expect(result.genre).toBeUndefined()
		expect(getTagTopArtists).not.toHaveBeenCalled()
		expect(getRecommendationCandidates.mock.calls[0][1]).toBeUndefined()
		expect(result.picks).toHaveLength(3)
	})

	it('should never pass exclude into the candidate cache', async () => {
		const { client, getRecommendationCandidates } = stubClient(BASE)

		const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [' MOJAVE 3 '] })

		expect(getRecommendationCandidates).toHaveBeenCalledTimes(1)
		expect(getRecommendationCandidates.mock.calls[0]).toHaveLength(3)
		expect(getRecommendationCandidates).toHaveBeenCalledWith('rj', undefined, expect.any(Function))
		const list = await getRecommendationCandidates.mock.results[0].value
		expect(JSON.stringify(list)).not.toContain('MOJAVE')
		expect(list.candidates.map((candidate: { name: string }) => candidate.name)).toContain('Mojave 3')
		expect(result.picks.map((pick) => pick.name)).toEqual(['Chapterhouse', 'Swervedriver'])
	})
})

/** How the fake Last.fm answers one request: a JSON body, after `delayMs` of fake time when set. */
interface FakeAnswer {
	body: unknown
	delayMs?: number
}

/**
 * Replaces fetch with a fake Last.fm that answers by lowercased method and artist, user or tag, and records each request as
 * "method artist". An unrouted request answers with an empty but well-formed body for its method.
 */
function fakeLastfm(route: (method: string, params: URLSearchParams) => FakeAnswer | undefined) {
	const requests: string[] = []
	const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const params = new URL(String(input)).searchParams
		const method = (params.get('method') ?? '').toLowerCase()
		requests.push(`${method} ${params.get('artist') ?? params.get('period') ?? params.get('tag') ?? ''}`.trim())
		const answer = route(method, params) ?? { body: emptyBody(method, params) }
		if (answer.delayMs) await new Promise((resolve) => setTimeout(resolve, answer.delayMs))
		return Response.json(answer.body)
	})
	return { requests, fetchSpy }
}

function emptyBody(method: string, params: URLSearchParams): unknown {
	const artist = params.get('artist') ?? ''
	switch (method) {
		case 'user.gettopartists':
			return topArtists([])
		case 'artist.getsimilar':
			return { similarartists: { artist: [], '@attr': { artist } } }
		case 'artist.gettopalbums':
			return albumsFor(artist)
		case 'artist.gettoptracks':
			return tracksFor(artist)
		default:
			return {}
	}
}

function similarTo(artist: string, names: string[]) {
	return { similarartists: { artist: names.map((name) => ({ name, match: '0.5', url: '' })), '@attr': { artist } } }
}

/** A Map-backed KV whose get or put never settles for the keys the predicates pick, as a stalled KV would. */
function stallingKV(stall: { get?: (key: string) => boolean; put?: (key: string) => boolean } = {}) {
	const store = new Map<string, string>()
	const never = new Promise<never>(() => {})
	const kv = {
		get: async (key: string) => (stall.get?.(key) ? never : (store.get(key) ?? null)),
		put: async (key: string, value: string) => {
			if (stall.put?.(key)) return never
			store.set(key, value)
		},
		delete: async (key: string) => {
			store.delete(key)
		},
		list: async () => ({ keys: [...store.keys()].map((name) => ({ name })) }),
	}
	return { kv: kv as unknown as KVNamespace, store }
}

describe('findRecommendations through CachedLastfmClient and LastfmClient', () => {
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('should stop fetching, skip starters and keep the picks found when Last.fm answers error 29 mid fan-out', async () => {
		vi.useFakeTimers()
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const seeds = ['A', 'B', 'C', 'D', 'E', 'F']
		const { requests } = fakeLastfm((method, params) => {
			const artist = params.get('artist') ?? ''
			if (method === 'user.gettopartists') return { body: topArtists(params.get('period') === '7day' ? seeds : []) }
			if (method !== 'artist.getsimilar') return undefined
			if (artist === 'A') return { body: { error: 29, message: 'Rate limit exceeded' } }
			// B, C and D are still in flight when A's rate limit comes back
			return { body: similarTo(artist, [`${artist} Similar`]), delayMs: 10 }
		})
		const client = new CachedLastfmClient(new LastfmClient('key'))

		const promise = findRecommendations(client, 'rj', { limit: 8, exclude: [] })
		await vi.advanceTimersByTimeAsync(RECOMMENDATION_POLICY.timeoutMs)
		const result = await promise

		expect(requests).toEqual([
			'user.gettopartists 7day',
			'user.gettopartists 1month',
			'user.gettopartists 12month',
			'user.gettopartists overall',
			'artist.getsimilar A',
			'artist.getsimilar B',
			'artist.getsimilar C',
			'artist.getsimilar D',
		])
		expect(result.partial).toBe(true)
		expect(result.picks.map((pick) => [pick.name, pick.album, pick.tracks])).toEqual([
			['B Similar', undefined, []],
			['C Similar', undefined, []],
			['D Similar', undefined, []],
		])
	})

	describe('hard deadline', () => {
		/** Starts a call and reports whether it has settled once the deadline has passed in fake time. */
		async function atDeadline(client: CachedLastfmClient) {
			let settled = false
			const promise = findRecommendations(client, 'rj', { limit: 8, exclude: [] }).finally(() => {
				settled = true
			})
			await vi.advanceTimersByTimeAsync(RECOMMENDATION_POLICY.timeoutMs)
			return { settled, promise }
		}

		it('should return partial with no picks at the deadline when the candidate cache read stalls', async () => {
			vi.useFakeTimers()
			const { requests } = fakeLastfm(() => undefined)
			const { kv } = stallingKV({ get: (key) => key.startsWith('cache:userRecommendations:') })

			const { settled, promise } = await atDeadline(new CachedLastfmClient(new LastfmClient('key'), kv))

			expect(settled).toBe(true)
			expect(await promise).toMatchObject({ partial: true, picks: [], emptyHistory: false, genreNotFound: false, libraryChecked: false })
			expect(requests).toEqual([])
		})

		it('should keep the picks and return partial at the deadline when a starter cache write stalls', async () => {
			vi.useFakeTimers()
			vi.spyOn(console, 'log').mockImplementation(() => {})
			fakeLastfm((method, params) => {
				if (method === 'user.gettopartists') return { body: topArtists(params.get('period') === '7day' ? ['Slowdive'] : []) }
				if (method === 'artist.getsimilar') return { body: similarTo('Slowdive', ['Mojave 3', 'Chapterhouse']) }
				return undefined
			})
			const { kv } = stallingKV({ put: (key) => key.startsWith('cache:artistTopTracks:') })

			const { settled, promise } = await atDeadline(new CachedLastfmClient(new LastfmClient('key'), kv))

			expect(settled).toBe(true)
			const result = await promise
			expect(result.partial).toBe(true)
			expect(result.picks.map((pick) => [pick.name, pick.album, pick.tracks])).toEqual([
				['Chapterhouse', 'Chapterhouse LP1', []],
				['Mojave 3', 'Mojave 3 LP1', []],
			])
		})
	})

	describe('freshness', () => {
		it('should build from top artists fetched for this build, never from an older cached window', async () => {
			vi.useFakeTimers()
			vi.spyOn(console, 'log').mockImplementation(() => {})
			let thisWeek = ['Slowdive']
			const { requests } = fakeLastfm((method, params) => {
				if (method === 'user.gettopartists') return { body: topArtists(params.get('period') === '7day' ? thisWeek : []) }
				if (method === 'artist.getsimilar') return { body: similarTo(params.get('artist') ?? '', [`${params.get('artist')} Similar`]) }
				return undefined
			})
			const { kv } = stallingKV()
			const client = new CachedLastfmClient(new LastfmClient('key'), kv)

			// Another tool caches this week's top artists with the same page size the engine asks for
			await client.getTopArtists('rj', '7day', SEED_LIMITS['7day'])
			vi.advanceTimersByTime(50 * 60 * 1000)
			thisWeek = ['Ride']
			requests.length = 0

			const result = await findRecommendations(client, 'rj', { limit: 8, exclude: [] })

			expect(requests.filter((request) => request.startsWith('user.gettopartists'))).toHaveLength(4)
			expect(result.picks.map((pick) => pick.name)).toEqual(['Ride Similar'])
			// The fresh window replaced the old entry, so other tools get it too
			await expect(client.getTopArtists('rj', '7day', SEED_LIMITS['7day'])).resolves.toEqual(topArtists(['Ride']))
		})
	})
})
