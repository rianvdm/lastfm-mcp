// ABOUTME: Cached wrapper around LastfmClient that reduces API calls via smart caching.
// ABOUTME: Delegates to SmartCache with per-endpoint TTLs and KV-backed persistent storage.

import {
	LastfmClient,
	type LastfmRecentTracksResponse,
	type LastfmTopArtistsResponse,
	type LastfmTopAlbumsResponse,
	type LastfmTopTracksResponse,
	type LastfmArtistTopTracksResponse,
	type LastfmArtistTopAlbumsResponse,
	type LastfmLovedTracksResponse,
	type LastfmTrackInfoResponse,
	type LastfmArtistInfoResponse,
	type LastfmAlbumInfoResponse,
	type LastfmUserInfoResponse,
	type LastfmSimilarArtistsResponse,
	type LastfmSimilarTracksResponse,
	type LastfmTagTopArtistsResponse,
	type LastfmWeeklyChartListResponse,
	type LastfmWeeklyArtistChartResponse,
	type LastfmWeeklyTrackChartResponse,
} from './lastfm'
import type { CandidateList } from '../recommendations/types'
import { SmartCache, CacheKeys, createLastfmCache } from '../utils/cache'

export class CachedLastfmClient {
	private client: LastfmClient
	private cache: SmartCache

	constructor(client: LastfmClient, kv?: KVNamespace) {
		this.client = client
		this.cache = createLastfmCache(kv)
	}

	/**
	 * Get user's recent tracks with caching (short TTL for real-time data)
	 */
	async getRecentTracks(username: string, limit = 50, from?: number, to?: number, page?: number): Promise<LastfmRecentTracksResponse> {
		const cacheKey = CacheKeys.userRecentTracks(username, limit, from, to, page)

		return this.cache.getOrFetch('userRecentTracks', cacheKey, () => this.client.getRecentTracks(username, limit, from, to, page))
	}

	/**
	 * Get user's top artists with caching. `forceRefresh` skips the cached entry and stores the fresh one, so a caller
	 * that caches what it builds from them (the recommendation candidates) doesn't stack two TTLs.
	 */
	async getTopArtists(
		username: string,
		period: '7day' | '1month' | '3month' | '6month' | '12month' | 'overall' = 'overall',
		limit = 50,
		options: { forceRefresh?: boolean } = {},
	): Promise<LastfmTopArtistsResponse> {
		const cacheKey = CacheKeys.userTopArtists(username, period, limit)

		return this.cache.getOrFetch('userTopArtists', cacheKey, () => this.client.getTopArtists(username, period, limit), {
			forceRefresh: options.forceRefresh,
		})
	}

	/**
	 * Get user's top albums with caching
	 */
	async getTopAlbums(
		username: string,
		period: '7day' | '1month' | '3month' | '6month' | '12month' | 'overall' = 'overall',
		limit = 50,
	): Promise<LastfmTopAlbumsResponse> {
		const cacheKey = CacheKeys.userTopAlbums(username, period, limit)

		return this.cache.getOrFetch('userTopAlbums', cacheKey, () => this.client.getTopAlbums(username, period, limit))
	}

	/**
	 * Get user's top tracks with caching
	 */
	async getTopTracks(
		username: string,
		period: '7day' | '1month' | '3month' | '6month' | '12month' | 'overall' = 'overall',
		limit = 50,
	): Promise<LastfmTopTracksResponse> {
		const cacheKey = CacheKeys.userTopTracks(username, period, limit)

		return this.cache.getOrFetch('userTopTracks', cacheKey, () => this.client.getTopTracks(username, period, limit))
	}

	/**
	 * Get an artist's top tracks (global) with caching
	 */
	async getArtistTopTracks(artist: string, limit = 10, mbid?: string): Promise<LastfmArtistTopTracksResponse> {
		const cacheKey = CacheKeys.artistTopTracks(artist, limit)

		return this.cache.getOrFetch('artistTopTracks', cacheKey, () => this.client.getArtistTopTracks(artist, limit, mbid))
	}

	/**
	 * Get an artist's top albums (global) with caching
	 */
	async getArtistTopAlbums(artist: string, limit = 10, mbid?: string): Promise<LastfmArtistTopAlbumsResponse> {
		const cacheKey = CacheKeys.artistTopAlbums(artist, limit)

		return this.cache.getOrFetch('artistTopAlbums', cacheKey, () => this.client.getArtistTopAlbums(artist, limit, mbid))
	}

	/**
	 * Get user's loved tracks with caching
	 */
	async getLovedTracks(username: string, limit = 50): Promise<LastfmLovedTracksResponse> {
		const cacheKey = CacheKeys.userLovedTracks(username, limit)

		return this.cache.getOrFetch('userLovedTracks', cacheKey, () => this.client.getLovedTracks(username, limit))
	}

	/**
	 * Get track information with caching (long TTL for static data)
	 */
	async getTrackInfo(artist: string, track: string, username?: string): Promise<LastfmTrackInfoResponse> {
		const cacheKey = CacheKeys.trackInfo(artist, track, username)

		return this.cache.getOrFetch('trackInfo', cacheKey, () => this.client.getTrackInfo(artist, track, username))
	}

	/**
	 * Get artist information with caching (long TTL for static data)
	 */
	async getArtistInfo(artist: string, username?: string): Promise<LastfmArtistInfoResponse> {
		const cacheKey = CacheKeys.artistInfo(artist, username)

		return this.cache.getOrFetch('artistInfo', cacheKey, () => this.client.getArtistInfo(artist, username))
	}

	/**
	 * Get album information with caching (long TTL for static data)
	 */
	async getAlbumInfo(artist: string, album: string, username?: string): Promise<LastfmAlbumInfoResponse> {
		const cacheKey = CacheKeys.albumInfo(artist, album, username)

		return this.cache.getOrFetch('albumInfo', cacheKey, () => this.client.getAlbumInfo(artist, album, username))
	}

	/**
	 * Get user information with caching (medium TTL for user data)
	 */
	async getUserInfo(username: string): Promise<LastfmUserInfoResponse> {
		const cacheKey = CacheKeys.userInfo(username)

		return this.cache.getOrFetch('userInfo', cacheKey, () => this.client.getUserInfo(username))
	}

	/**
	 * Get similar artists with caching (long TTL for static data)
	 */
	async getSimilarArtists(artist: string, limit = 30): Promise<LastfmSimilarArtistsResponse> {
		const cacheKey = CacheKeys.similarArtists(artist, limit)

		return this.cache.getOrFetch('similarArtists', cacheKey, () => this.client.getSimilarArtists(artist, limit))
	}

	/**
	 * Get similar tracks with caching (long TTL for static data)
	 */
	async getSimilarTracks(artist: string, track: string, limit = 30): Promise<LastfmSimilarTracksResponse> {
		const cacheKey = CacheKeys.similarTracks(artist, track, limit)

		return this.cache.getOrFetch('similarTracks', cacheKey, () => this.client.getSimilarTracks(artist, track, limit))
	}

	/**
	 * Get a tag's top artists with caching (long TTL; shared by every user and tag spelling)
	 */
	async getTagTopArtists(tag: string, limit = 500): Promise<LastfmTagTopArtistsResponse> {
		const cacheKey = CacheKeys.tagTopArtists(tag, limit)

		return this.cache.getOrFetch('tagTopArtists', cacheKey, () => this.client.getTagTopArtists(tag, limit))
	}

	/**
	 * Get a user's ranked recommendation candidates for a genre, running `build` on a miss.
	 * A partial list (budget, deadline or rate limiting cut it short) is returned but not cached, so the next call retries.
	 */
	async getRecommendationCandidates(
		username: string,
		genre: string | undefined,
		build: () => Promise<CandidateList>,
	): Promise<CandidateList> {
		const cacheKey = CacheKeys.recommendationCandidates(username, genre)

		return this.cache.getOrFetch('userRecommendations', cacheKey, build, { shouldCache: (list) => !list.partial })
	}

	/**
	 * Generate listening statistics for a user
	 */
	async getListeningStats(
		username: string,
		period: '7day' | '1month' | '3month' | '6month' | '12month' | 'overall' = 'overall',
	): Promise<{
		totalScrobbles: number
		topGenres: string[]
		listeningTrends: {
			averageTracksPerDay: number
			mostActiveDay: string
			recentActivity: number
		}
		topArtistsCount: number
		topAlbumsCount: number
	}> {
		const cacheKey = CacheKeys.userListeningStats(username, period)

		return this.cache.getOrFetch('userListeningStats', cacheKey, async () => {
			// Get user info for total scrobbles
			const userInfo = await this.client.getUserInfo(username)

			// Get top artists and albums for analysis
			const [topArtists, topAlbums] = await Promise.all([
				this.client.getTopArtists(username, period, 50),
				this.client.getTopAlbums(username, period, 50),
			])

			// Extract genres from top artists (simplified - would need tag analysis for real genres)
			const topGenres: string[] = []

			// Calculate basic stats
			const totalScrobbles = parseInt(userInfo.user.playcount) || 0
			const registrationDate = new Date(parseInt(userInfo.user.registered.unixtime) * 1000)
			const daysSinceRegistration = Math.max(1, Math.floor((Date.now() - registrationDate.getTime()) / (1000 * 60 * 60 * 24)))
			const averageTracksPerDay = Math.round(totalScrobbles / daysSinceRegistration)

			return {
				totalScrobbles,
				topGenres,
				listeningTrends: {
					averageTracksPerDay,
					mostActiveDay: 'N/A', // Would need recent tracks analysis
					recentActivity: topArtists.topartists.artist.length,
				},
				topArtistsCount: topArtists.topartists.artist.length,
				topAlbumsCount: topAlbums.topalbums.album.length,
			}
		})
	}

	/**
	 * Get user's weekly chart list with caching (historical data - long TTL)
	 */
	async getWeeklyChartList(username: string): Promise<LastfmWeeklyChartListResponse> {
		const cacheKey = CacheKeys.userWeeklyChartList(username)

		return this.cache.getOrFetch('userWeeklyChartList', cacheKey, () => this.client.getWeeklyChartList(username))
	}

	/**
	 * Get user's weekly artist chart with caching (historical data - long TTL)
	 */
	async getWeeklyArtistChart(username: string, from?: number, to?: number): Promise<LastfmWeeklyArtistChartResponse> {
		const cacheKey = CacheKeys.userWeeklyArtistChart(username, from, to)

		return this.cache.getOrFetch('userWeeklyArtistChart', cacheKey, () => this.client.getWeeklyArtistChart(username, from, to))
	}

	/**
	 * Get user's weekly track chart with caching (historical data - long TTL)
	 */
	async getWeeklyTrackChart(username: string, from?: number, to?: number): Promise<LastfmWeeklyTrackChartResponse> {
		const cacheKey = CacheKeys.userWeeklyTrackChart(username, from, to)

		return this.cache.getOrFetch('userWeeklyTrackChart', cacheKey, () => this.client.getWeeklyTrackChart(username, from, to))
	}
}
