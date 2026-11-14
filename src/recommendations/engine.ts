// ABOUTME: Recommendation engine: builds a user's ranked candidates from Last.fm and turns them into picks with starters.
// ABOUTME: Runs one tool call under the recommendation request policy, caching candidates per user and genre but never exclude.

import type { CachedLastfmClient } from '../clients/cachedLastfm'
import { toArray } from '../mcp/tools/formatters'
import { RECOMMENDATION_POLICY, RequestBudgetExceeded, isRateLimited, runWithRequestPolicy } from '../utils/lastfmRequestPolicy'
import { applyExclude, applyGenre, normaliseArtist, rankCandidates, selectSeeds } from './scoring'
import type { Candidate, CandidateList, SeedRef, Window } from './types'

/** Overall top artists fetched as the user's library; Last.fm's maximum page size for user.getTopArtists. */
export const LIBRARY_PAGE_SIZE = 1000

/** A genre's top artists fetched for filtering and top-ups; Last.fm allows up to 1000, 500 is deep enough and smaller. */
export const TAG_PAGE_SIZE = 500

/** Top artists fetched from each recent window to find seeds. */
export const SEED_LIMITS = { '7day': 10, '1month': 10, '12month': 15 } as const satisfies Record<Exclude<Window, 'overall'>, number>

/** Similar artists per seed; the get_similar_artists tool default, so both share cache entries. */
export const SIMILAR_LIMIT = 30

/** Top albums and tracks per pick; the get_artist_top_albums and get_artist_top_tracks tool defaults, so they share cache entries. */
export const STARTER_LIMIT = 10

/**
 * Genre candidates kept in the cached list: the most picks a call can ask for (15) plus the longest exclude list (50),
 * so a call that excludes 50 genre artists still gets a full 15. The tag list is fetched anyway, so this costs no requests.
 */
const GENRE_CANDIDATE_LIMIT = 65

/** Windows fetched for seeds and the library, with the page size asked for each. */
const WINDOW_PAGE_SIZES: Record<Window, number> = { ...SEED_LIMITS, overall: LIBRARY_PAGE_SIZE }

const WINDOWS = Object.keys(WINDOW_PAGE_SIZES) as Window[]

/** One recommended artist, with the evidence behind it and something to start listening with. */
export interface Pick {
	name: string
	/** Seeds pointing to this artist, strongest first; empty for a genre top-up. */
	seeds: SeedRef[]
	source: 'similar' | 'tag'
	/** 1-based position in the genre's top artists, set when `source` is 'tag'. */
	tagRank?: number
	/** The artist's top album, when the lookup finished and found one. */
	album?: string
	/** Up to two of the artist's top tracks; empty when the lookup didn't finish or found none. */
	tracks: string[]
}

export interface RecommendationResult {
	username: string
	/** The genre as asked for, trimmed; absent when none was given. */
	genre?: string
	picks: Pick[]
	/** True when the budget, deadline or rate limiting cut the candidates or the starters short. */
	partial: boolean
	genreNotFound: boolean
	emptyHistory: boolean
	libraryComplete: boolean
	libraryPageSize: number
}

export interface RecommendationOptions {
	/** Number of picks wanted. */
	limit: number
	/** A Last.fm tag; blank counts as none. */
	genre?: string
	/** Artist names to leave out of this call's picks; never cached. */
	exclude: string[]
}

/**
 * Finds up to `limit` artists new to `username`. The whole call runs under one RECOMMENDATION_POLICY, so its Last.fm
 * requests share one budget and deadline. Candidates come from the per-user, per-genre cache or are built on a miss;
 * `exclude` and `limit` apply after, and each pick then gets a starter album and tracks. Throws only if every
 * top-artist window lookup fails; anything cut short by the budget, deadline or a rate limit comes back as `partial`.
 */
export async function findRecommendations(
	client: CachedLastfmClient,
	username: string,
	options: RecommendationOptions,
): Promise<RecommendationResult> {
	const genre = options.genre?.trim() || undefined
	// Last.fm tags are case-insensitive, so one spelling serves the candidate cache and the tag lookup
	const tag = genre?.toLowerCase()
	const { timeoutMs, ...limits } = RECOMMENDATION_POLICY

	return runWithRequestPolicy({ ...limits, deadlineMs: timeoutMs }, async () => {
		const list = await client.getRecommendationCandidates(username, tag, () => buildCandidates(client, username, tag))
		const chosen = applyExclude(list.candidates, options.exclude, options.limit)
		const starters = await Promise.all(chosen.map((candidate) => fetchStarters(client, candidate.name)))

		return {
			username,
			...(genre && { genre }),
			picks: chosen.map((candidate, index) => toPick(candidate, starters[index])),
			partial: list.partial || starters.some((starter) => starter.cutShort),
			genreNotFound: list.genreNotFound,
			emptyHistory: list.emptyHistory,
			libraryComplete: list.libraryComplete,
			libraryPageSize: list.libraryPageSize,
		}
	})
}

/** True for a failure caused by this call's limits or Last.fm's rate limiting, rather than by the request itself. */
function isCutShort(error: unknown): boolean {
	return error instanceof RequestBudgetExceeded || isRateLimited(error)
}

/** True for Last.fm error 6, its answer to an unknown artist, user or tag. */
function isNotFound(error: unknown): boolean {
	return error instanceof Error && /^Last\.fm API error 6\b/.test(error.message)
}

/** Builds the ranked candidates for one user and lowercased tag; never sees `exclude` or `limit`. */
async function buildCandidates(client: CachedLastfmClient, username: string, tag: string | undefined): Promise<CandidateList> {
	const windowResults = await Promise.allSettled(WINDOWS.map((window) => client.getTopArtists(username, window, WINDOW_PAGE_SIZES[window])))
	const failures = windowResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
	if (failures.length === windowResults.length) throw failures[0].reason

	let partial = failures.some((failure) => isCutShort(failure.reason))
	const windows: Partial<Record<Window, string[]>> = {}
	let libraryComplete = false
	windowResults.forEach((result, index) => {
		if (result.status === 'rejected') return
		const window = WINDOWS[index]
		windows[window] = toArray(result.value.topartists?.artist).map((artist) => artist.name)
		if (window === 'overall') libraryComplete = Number(result.value.topartists?.['@attr']?.total) <= LIBRARY_PAGE_SIZE
	})

	const library = new Set(Object.values(windows).flatMap((names) => names.map(normaliseArtist)))
	const base = { libraryComplete, libraryPageSize: LIBRARY_PAGE_SIZE }
	// A window cut short might have held artists, so only claim an empty history when no window was
	if (library.size === 0 && !partial) return { ...base, candidates: [], partial, genreNotFound: false, emptyHistory: true }

	// Ask for the tag first: without it a genre call has nothing to show, so it shouldn't queue behind the fan-out
	const tagLookup = tag ? settle(client.getTagTopArtists(tag, TAG_PAGE_SIZE)) : undefined
	const seeds = selectSeeds(windows)
	const similarResults = await Promise.allSettled(seeds.map((seed) => client.getSimilarArtists(seed.name, SIMILAR_LIMIT)))

	const similar = new Map<string, Array<{ name: string; match: number }>>()
	similarResults.forEach((result, index) => {
		if (result.status === 'rejected') {
			// Running out of budget or time makes the list partial; any other failure, such as error 6 for an artist
			// Last.fm no longer knows, just loses that seed
			if (isCutShort(result.reason)) partial = true
			return
		}
		const entries = toArray(result.value.similarartists?.artist).map((artist) => ({ name: artist.name, match: Number(artist.match) }))
		similar.set(normaliseArtist(seeds[index].name), entries)
	})

	let candidates = rankCandidates(seeds, similar, library)
	let genreNotFound = false

	if (tagLookup) {
		const tagResult = await tagLookup
		if (tagResult.status === 'fulfilled') {
			const tagArtists = toArray(tagResult.value.topartists?.artist).map((artist) => artist.name)
			// Last.fm answers an unknown tag with an empty list
			genreNotFound = tagArtists.length === 0
			candidates = genreNotFound ? [] : applyGenre(candidates, tagArtists, library, GENRE_CANDIDATE_LIMIT)
		} else {
			genreNotFound = isNotFound(tagResult.reason)
			// Without the tag's artists the genre can't be applied; any failure but error 6 is worth retrying, so don't cache it
			if (!genreNotFound) partial = true
			candidates = []
		}
	}

	return { ...base, candidates, partial, genreNotFound, emptyHistory: false }
}

/** Settles `promise` without rejecting, so it can run alongside other work and be read later. */
async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
	const [result] = await Promise.allSettled([promise])
	return result
}

interface Starters {
	album?: string
	tracks: string[]
	/** True when the budget, deadline or a rate limit stopped either lookup. */
	cutShort: boolean
}

/** Looks up one album and two tracks for `artist`; a failed or empty lookup just leaves them out. */
async function fetchStarters(client: CachedLastfmClient, artist: string): Promise<Starters> {
	const [albums, tracks] = await Promise.allSettled([
		client.getArtistTopAlbums(artist, STARTER_LIMIT),
		client.getArtistTopTracks(artist, STARTER_LIMIT),
	])
	const album = albums.status === 'fulfilled' ? toArray(albums.value.topalbums?.album)[0]?.name : undefined

	return {
		...(album && { album }),
		tracks:
			tracks.status === 'fulfilled'
				? toArray(tracks.value.toptracks?.track)
						.slice(0, 2)
						.map((track) => track.name)
				: [],
		cutShort: [albums, tracks].some((result) => result.status === 'rejected' && isCutShort(result.reason)),
	}
}

function toPick(candidate: Candidate, starters: Starters): Pick {
	return {
		name: candidate.name,
		seeds: candidate.seeds,
		source: candidate.source,
		...(candidate.tagRank !== undefined && { tagRank: candidate.tagRank }),
		...(starters.album && { album: starters.album }),
		tracks: starters.tracks,
	}
}
