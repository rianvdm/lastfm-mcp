/**
 * Cached wrapper for LastfmClient
 * Implements smart caching to reduce API calls and rate limiting issues
 */

import { LastfmClient, type LastfmRecentTracksResponse, type LastfmTopArtistsResponse, type LastfmTopAlbumsResponse, type LastfmLovedTracksResponse, type LastfmTrackInfoResponse, type LastfmArtistInfoResponse, type LastfmAlbumInfoResponse, type LastfmUserInfoResponse, type LastfmSimilarArtistsResponse, type LastfmSimilarTracksResponse } from './lastfm'
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
	async getRecentTracks(
		username: string,
		limit = 50,
		from?: number,
		to?: number,
		page?: number
	): Promise<LastfmRecentTracksResponse> {
		const cacheKey = CacheKeys.userRecentTracks(username, limit, from, to, page)
		
		return this.cache.getOrFetch(
			'userRecentTracks',
			cacheKey,
			() => this.client.getRecentTracks(username, limit, from, to, page)
		)
	}

	/**
	 * Get user's top artists with caching
	 */
	async getTopArtists(
		username: string,
		period: '7day' | '1month' | '3month' | '6month' | '12month' | 'overall' = 'overall',
		limit = 50
	): Promise<LastfmTopArtistsResponse> {
		const cacheKey = CacheKeys.userTopArtists(username, period, limit)
		
		return this.cache.getOrFetch(
			'userTopArtists',
			cacheKey,
			() => this.client.getTopArtists(username, period, limit)
		)
	}

	/**
	 * Get user's top albums with caching
	 */
	async getTopAlbums(
		username: string,
		period: '7day' | '1month' | '3month' | '6month' | '12month' | 'overall' = 'overall',
		limit = 50
	): Promise<LastfmTopAlbumsResponse> {
		const cacheKey = CacheKeys.userTopAlbums(username, period, limit)
		
		return this.cache.getOrFetch(
			'userTopAlbums',
			cacheKey,
			() => this.client.getTopAlbums(username, period, limit)
		)
	}

	/**
	 * Get user's loved tracks with caching
	 */
	async getLovedTracks(username: string, limit = 50): Promise<LastfmLovedTracksResponse> {
		const cacheKey = CacheKeys.userLovedTracks(username, limit)
		
		return this.cache.getOrFetch(
			'userLovedTracks',
			cacheKey,
			() => this.client.getLovedTracks(username, limit)
		)
	}

	/**
	 * Get track information with caching (long TTL for static data)
	 */
	async getTrackInfo(artist: string, track: string, username?: string): Promise<LastfmTrackInfoResponse> {
		const cacheKey = CacheKeys.trackInfo(artist, track, username)
		
		return this.cache.getOrFetch(
			'trackInfo',
			cacheKey,
			() => this.client.getTrackInfo(artist, track, username)
		)
	}

	/**
	 * Get artist information with caching (long TTL for static data)
	 */
	async getArtistInfo(artist: string, username?: string): Promise<LastfmArtistInfoResponse> {
		const cacheKey = CacheKeys.artistInfo(artist, username)
		
		return this.cache.getOrFetch(
			'artistInfo',
			cacheKey,
			() => this.client.getArtistInfo(artist, username)
		)
	}

	/**
	 * Get album information with caching (long TTL for static data)
	 */
	async getAlbumInfo(artist: string, album: string, username?: string): Promise<LastfmAlbumInfoResponse> {
		const cacheKey = CacheKeys.albumInfo(artist, album, username)
		
		return this.cache.getOrFetch(
			'albumInfo',
			cacheKey,
			() => this.client.getAlbumInfo(artist, album, username)
		)
	}

	/**
	 * Get user information with caching (medium TTL for user data)
	 */
	async getUserInfo(username: string): Promise<LastfmUserInfoResponse> {
		const cacheKey = CacheKeys.userInfo(username)
		
		return this.cache.getOrFetch(
			'userInfo',
			cacheKey,
			() => this.client.getUserInfo(username)
		)
	}

	/**
	 * Get similar artists with caching (long TTL for static data)
	 */
	async getSimilarArtists(artist: string, limit = 30): Promise<LastfmSimilarArtistsResponse> {
		const cacheKey = CacheKeys.similarArtists(artist, limit)
		
		return this.cache.getOrFetch(
			'similarArtists',
			cacheKey,
			() => this.client.getSimilarArtists(artist, limit)
		)
	}

	/**
	 * Get similar tracks with caching (long TTL for static data)
	 */
	async getSimilarTracks(artist: string, track: string, limit = 30): Promise<LastfmSimilarTracksResponse> {
		const cacheKey = CacheKeys.similarTracks(artist, track, limit)
		
		return this.cache.getOrFetch(
			'similarTracks',
			cacheKey,
			() => this.client.getSimilarTracks(artist, track, limit)
		)
	}

	/**
	 * Generate listening statistics for a user
	 */
	async getListeningStats(username: string, period: '7day' | '1month' | '3month' | '6month' | '12month' | 'overall' = 'overall'): Promise<{
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
		
		return this.cache.getOrFetch(
			'userListeningStats',
			cacheKey,
			async () => {
				// Get user info for total scrobbles
				const userInfo = await this.client.getUserInfo(username)
				
				// Get top artists and albums for analysis
				const [topArtists, topAlbums] = await Promise.all([
					this.client.getTopArtists(username, period, 50),
					this.client.getTopAlbums(username, period, 50)
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
						recentActivity: topArtists.topartists.artist.length
					},
					topArtistsCount: topArtists.topartists.artist.length,
					topAlbumsCount: topAlbums.topalbums.album.length
				}
			}
		)
	}

	/**
	 * Generate music recommendations based on user's listening history
	 */
	async getMusicRecommendations(username: string, limit = 20, genre?: string): Promise<{
		recommendedArtists: Array<{
			name: string
			reason: string
			similarity: string
			url: string
		}>
		recommendedTracks: Array<{
			name: string
			artist: string
			reason: string
			similarity: string
			url: string
		}>
	}> {
		const cacheKey = CacheKeys.userRecommendations(username, limit, genre)
		
		return this.cache.getOrFetch(
			'userRecommendations',
			cacheKey,
			async () => {
				// Get user's top artists to base recommendations on
				const topArtists = await this.client.getTopArtists(username, 'overall', 10)
				
				const recommendedArtists: Array<{
					name: string
					reason: string
					similarity: string
					url: string
				}> = []
				
				const recommendedTracks: Array<{
					name: string
					artist: string
					reason: string
					similarity: string
					url: string
				}> = []

				// Get similar artists for each top artist
				for (const artist of topArtists.topartists.artist.slice(0, 3)) {
					try {
						const similar = await this.client.getSimilarArtists(artist.name, 5)
						
						for (const similarArtist of similar.similarartists.artist) {
							if (recommendedArtists.length < limit) {
								recommendedArtists.push({
									name: similarArtist.name,
									reason: `Similar to ${artist.name}`,
									similarity: similarArtist.match,
									url: similarArtist.url
								})
							}
						}
					} catch (error) {
						console.warn(`Could not get similar artists for ${artist.name}:`, error)
					}
				}

				return {
					recommendedArtists: recommendedArtists.slice(0, limit),
					recommendedTracks: recommendedTracks.slice(0, limit)
				}
			}
		)
	}
}