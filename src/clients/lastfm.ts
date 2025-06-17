// Last.fm API client for interacting with user listening data and music information

import { fetchWithRetry, RetryOptions } from '../utils/retry'

// Last.fm API response interfaces
export interface LastfmTrack {
	name: string
	artist: {
		'#text': string
		mbid?: string
	}
	album?: {
		'#text': string
		mbid?: string
	}
	url: string
	streamable: string
	listeners?: string
	playcount?: string
	mbid?: string
	date?: {
		uts: string
		'#text': string
	}
	image?: Array<{
		'#text': string
		size: 'small' | 'medium' | 'large' | 'extralarge'
	}>
	nowplaying?: string
	loved?: string
}

export interface LastfmArtist {
	name: string
	playcount: string
	listeners?: string
	mbid?: string
	url: string
	streamable?: string
	image?: Array<{
		'#text': string
		size: 'small' | 'medium' | 'large' | 'extralarge' | 'mega'
	}>
	'@attr'?: {
		rank: string
	}
	stats?: {
		listeners: string
		playcount: string
		userplaycount?: string
	}
	bio?: {
		published: string
		summary: string
		content: string
	}
	similar?: {
		artist: LastfmArtist[]
	}
	tags?: {
		tag: Array<{
			name: string
			url: string
			count?: number
		}>
	}
}

export interface LastfmAlbum {
	name: string
	artist:
		| string
		| {
				name: string
				mbid?: string
				url?: string
		  }
	playcount?: string
	mbid?: string
	url: string
	image?: Array<{
		'#text': string
		size: 'small' | 'medium' | 'large' | 'extralarge'
	}>
	'@attr'?: {
		rank: string
	}
	listeners?: string
	tags?: {
		tag: Array<{
			name: string
			url: string
			count?: number
		}>
	}
	tracks?: {
		track: Array<{
			name: string
			duration?: string
			'@attr'?: {
				rank: string
			}
			artist?: {
				name: string
				mbid?: string
				url?: string
			}
		}>
	}
	wiki?: {
		published: string
		summary: string
		content: string
	}
}

export interface LastfmUser {
	name: string
	realname?: string
	image?: Array<{
		'#text': string
		size: 'small' | 'medium' | 'large' | 'extralarge'
	}>
	url: string
	country?: string
	age?: string
	gender?: string
	subscriber: string
	playcount: string
	playlists: string
	bootstrap: string
	registered: {
		unixtime: string
		'#text': string
	}
	type: string
}

export interface LastfmRecentTracksResponse {
	recenttracks: {
		track: LastfmTrack[]
		'@attr': {
			user: string
			totalPages: string
			page: string
			perPage: string
			total: string
		}
	}
}

export interface LastfmTopArtistsResponse {
	topartists: {
		artist: LastfmArtist[]
		'@attr': {
			user: string
			totalPages: string
			page: string
			perPage: string
			total: string
		}
	}
}

export interface LastfmTopAlbumsResponse {
	topalbums: {
		album: LastfmAlbum[]
		'@attr': {
			user: string
			totalPages: string
			page: string
			perPage: string
			total: string
		}
	}
}

export interface LastfmLovedTracksResponse {
	lovedtracks: {
		track: LastfmTrack[]
		'@attr': {
			user: string
			totalPages: string
			page: string
			perPage: string
			total: string
		}
	}
}

export interface LastfmTrackInfoResponse {
	track: LastfmTrack & {
		duration?: string
		listeners: string
		playcount: string
		userplaycount?: string
		userloved?: string
		toptags?: {
			tag: Array<{
				name: string
				count: number
				url: string
			}>
		}
		wiki?: {
			published: string
			summary: string
			content: string
		}
		similar?: {
			track: LastfmTrack[]
		}
	}
}

export interface LastfmArtistInfoResponse {
	artist: LastfmArtist & {
		stats: {
			listeners: string
			playcount: string
			userplaycount?: string
		}
		similar: {
			artist: LastfmArtist[]
		}
		tags: {
			tag: Array<{
				name: string
				url: string
				count?: number
			}>
		}
		bio: {
			published: string
			summary: string
			content: string
		}
	}
}

export interface LastfmAlbumInfoResponse {
	album: LastfmAlbum & {
		listeners: string
		playcount: string
		userplaycount?: string
		tracks: {
			track: Array<{
				name: string
				duration?: string
				'@attr': {
					rank: string
				}
				artist: {
					name: string
					mbid?: string
					url?: string
				}
			}>
		}
		tags: {
			tag: Array<{
				name: string
				url: string
				count?: number
			}>
		}
		wiki?: {
			published: string
			summary: string
			content: string
		}
	}
}

export interface LastfmUserInfoResponse {
	user: LastfmUser
}

export interface LastfmSimilarArtistsResponse {
	similarartists: {
		artist: Array<
			LastfmArtist & {
				match: string
			}
		>
		'@attr': {
			artist: string
		}
	}
}

export interface LastfmSimilarTracksResponse {
	similartracks: {
		track: Array<
			LastfmTrack & {
				match: string
			}
		>
		'@attr': {
			artist: string
			track: string
		}
	}
}

export interface LastfmError {
	error: number
	message: string
}

type LastfmApiResponse<T> = T | LastfmError

export class LastfmClient {
	private apiKey: string
	private baseUrl = 'https://ws.audioscrobbler.com/2.0/'
	private lastRequestTime = 0

	// Last.fm specific retry configuration
	private readonly lastfmRetryOptions: RetryOptions = {
		maxRetries: 3,
		initialDelayMs: 1000,
		maxDelayMs: 15000,
		backoffMultiplier: 2,
		jitterFactor: 0.1,
	}

	// Minimum delay between requests to respect rate limits (~5 req/sec)
	private readonly REQUEST_DELAY_MS = 250 // 250ms to stay under 5 req/sec

	constructor(apiKey: string) {
		this.apiKey = apiKey
	}

	/**
	 * Add delay between requests to respect Last.fm rate limits
	 */
	private async throttleRequest(): Promise<void> {
		const timeSinceLastRequest = Date.now() - this.lastRequestTime
		if (timeSinceLastRequest < this.REQUEST_DELAY_MS) {
			const delayNeeded = this.REQUEST_DELAY_MS - timeSinceLastRequest
			await new Promise((resolve) => setTimeout(resolve, delayNeeded))
		}
		this.lastRequestTime = Date.now()
	}

	/**
	 * Make a request to the Last.fm API
	 */
	private async makeRequest<T>(params: Record<string, string>): Promise<T> {
		const searchParams = new URLSearchParams({
			api_key: this.apiKey,
			format: 'json',
			...params,
		})

		await this.throttleRequest()

		const response = await fetchWithRetry(
			`${this.baseUrl}?${searchParams.toString()}`,
			{
				method: 'GET',
				headers: {
					'User-Agent': 'lastfm-mcp/1.0.0',
				},
			},
			this.lastfmRetryOptions,
		)

		const data = (await response.json()) as LastfmApiResponse<T>

		if ('error' in data) {
			throw new Error(`Last.fm API error ${data.error}: ${data.message}`)
		}

		return data as T
	}

	/**
	 * Get user's recent tracks
	 */
	async getRecentTracks(username: string, limit = 50, from?: number, to?: number, page?: number): Promise<LastfmRecentTracksResponse> {
		const params: Record<string, string> = {
			method: 'user.getRecentTracks',
			user: username,
			limit: limit.toString(),
		}

		if (from) params.from = from.toString()
		if (to) params.to = to.toString()
		if (page) params.page = page.toString()

		return this.makeRequest<LastfmRecentTracksResponse>(params)
	}

	/**
	 * Get user's top artists
	 */
	async getTopArtists(
		username: string,
		period: '7day' | '1month' | '3month' | '6month' | '12month' | 'overall' = 'overall',
		limit = 50,
	): Promise<LastfmTopArtistsResponse> {
		return this.makeRequest<LastfmTopArtistsResponse>({
			method: 'user.getTopArtists',
			user: username,
			period,
			limit: limit.toString(),
		})
	}

	/**
	 * Get user's top albums
	 */
	async getTopAlbums(
		username: string,
		period: '7day' | '1month' | '3month' | '6month' | '12month' | 'overall' = 'overall',
		limit = 50,
	): Promise<LastfmTopAlbumsResponse> {
		return this.makeRequest<LastfmTopAlbumsResponse>({
			method: 'user.getTopAlbums',
			user: username,
			period,
			limit: limit.toString(),
		})
	}

	/**
	 * Get user's loved tracks
	 */
	async getLovedTracks(username: string, limit = 50): Promise<LastfmLovedTracksResponse> {
		return this.makeRequest<LastfmLovedTracksResponse>({
			method: 'user.getLovedTracks',
			user: username,
			limit: limit.toString(),
		})
	}

	/**
	 * Get track information
	 */
	async getTrackInfo(artist: string, track: string, username?: string): Promise<LastfmTrackInfoResponse> {
		const params: Record<string, string> = {
			method: 'track.getInfo',
			artist,
			track,
		}

		if (username) params.username = username

		return this.makeRequest<LastfmTrackInfoResponse>(params)
	}

	/**
	 * Get artist information
	 */
	async getArtistInfo(artist: string, username?: string): Promise<LastfmArtistInfoResponse> {
		const params: Record<string, string> = {
			method: 'artist.getInfo',
			artist,
		}

		if (username) params.username = username

		return this.makeRequest<LastfmArtistInfoResponse>(params)
	}

	/**
	 * Get album information
	 */
	async getAlbumInfo(artist: string, album: string, username?: string): Promise<LastfmAlbumInfoResponse> {
		const params: Record<string, string> = {
			method: 'album.getInfo',
			artist,
			album,
		}

		if (username) params.username = username

		return this.makeRequest<LastfmAlbumInfoResponse>(params)
	}

	/**
	 * Get user information
	 */
	async getUserInfo(username: string): Promise<LastfmUserInfoResponse> {
		return this.makeRequest<LastfmUserInfoResponse>({
			method: 'user.getInfo',
			user: username,
		})
	}

	/**
	 * Get similar artists
	 */
	async getSimilarArtists(artist: string, limit = 30): Promise<LastfmSimilarArtistsResponse> {
		return this.makeRequest<LastfmSimilarArtistsResponse>({
			method: 'artist.getSimilar',
			artist,
			limit: limit.toString(),
		})
	}

	/**
	 * Get similar tracks
	 */
	async getSimilarTracks(artist: string, track: string, limit = 30): Promise<LastfmSimilarTracksResponse> {
		return this.makeRequest<LastfmSimilarTracksResponse>({
			method: 'track.getSimilar',
			artist,
			track,
			limit: limit.toString(),
		})
	}
}
