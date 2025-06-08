// Discogs API client for interacting with user collections and releases

import { DiscogsAuth } from '../auth/discogs'

export interface DiscogsRelease {
	id: number
	title: string
	artists: Array<{
		name: string
		id: number
	}>
	year?: number
	formats: Array<{
		name: string
		qty: string
		descriptions?: string[]
	}>
	genres: string[]
	styles: string[]
	tracklist: Array<{
		position: string
		title: string
		duration?: string
	}>
	labels: Array<{
		name: string
		catno: string
	}>
	images?: Array<{
		type: string
		uri: string
		width: number
		height: number
	}>
	master_id?: number
	master_url?: string
	resource_url: string
	uri: string
	country?: string
	released?: string
	notes?: string
	data_quality: string
}

export interface DiscogsCollectionItem {
	id: number
	instance_id: number
	date_added: string
	rating: number
	basic_information: {
		id: number
		title: string
		year: number
		resource_url: string
		thumb: string
		cover_image: string
		formats: Array<{
			name: string
			qty: string
			descriptions?: string[]
		}>
		labels: Array<{
			name: string
			catno: string
		}>
		artists: Array<{
			name: string
			id: number
		}>
		genres: string[]
		styles: string[]
	}
}

export interface DiscogsCollectionResponse {
	pagination: {
		pages: number
		page: number
		per_page: number
		items: number
		urls: {
			last?: string
			next?: string
		}
	}
	releases: DiscogsCollectionItem[]
}

export interface DiscogsSearchResponse {
	pagination: {
		pages: number
		page: number
		per_page: number
		items: number
		urls: {
			last?: string
			next?: string
		}
	}
	results: Array<{
		id: number
		type: string
		title: string
		year?: number
		format: string[]
		label: string[]
		genre: string[]
		style: string[]
		country?: string
		thumb: string
		cover_image: string
		resource_url: string
		master_id?: number
		master_url?: string
	}>
}

export interface DiscogsCollectionStats {
	totalReleases: number
	totalValue: number
	genreBreakdown: Record<string, number>
	decadeBreakdown: Record<string, number>
	formatBreakdown: Record<string, number>
	labelBreakdown: Record<string, number>
	averageRating: number
	ratedReleases: number
}

export class DiscogsClient {
	private baseUrl = 'https://api.discogs.com'
	private userAgent = 'discogs-mcp/1.0.0'

	/**
	 * Create OAuth 1.0a authorization header using proper HMAC-SHA1 signature
	 */
	private async createOAuthHeader(
		url: string,
		method: string,
		accessToken: string,
		accessTokenSecret: string,
		consumerKey: string,
		consumerSecret: string,
	): Promise<string> {
		if (!consumerKey || !consumerSecret) {
			throw new Error('Consumer key and secret are required for OAuth authentication')
		}

		const auth = new DiscogsAuth(consumerKey, consumerSecret)
		const headers = await auth.getAuthHeaders(url, method, {
			key: accessToken,
			secret: accessTokenSecret,
		})

		return headers.Authorization
	}

	/**
	 * Get detailed information about a specific release
	 */
	async getRelease(
		releaseId: string,
		accessToken: string,
		accessTokenSecret?: string,
		consumerKey?: string,
		consumerSecret?: string,
	): Promise<DiscogsRelease> {
		const url = `${this.baseUrl}/releases/${releaseId}`
		const headers: Record<string, string> = {
			'User-Agent': this.userAgent,
		}

		// Use OAuth 1.0a if we have all required parameters, otherwise fall back to simple token auth
		if (accessTokenSecret && consumerKey && consumerSecret) {
			headers['Authorization'] = await this.createOAuthHeader(url, 'GET', accessToken, accessTokenSecret, consumerKey, consumerSecret)
		} else {
			headers['Authorization'] = `Discogs token=${accessToken}`
		}

		const response = await fetch(url, {
			headers,
		})

		if (!response.ok) {
			throw new Error(`Failed to fetch release ${releaseId}: ${response.status} ${response.statusText}`)
		}

		return response.json()
	}

	/**
	 * Search user's collection
	 */
	async searchCollection(
		username: string,
		accessToken: string,
		accessTokenSecret: string,
		options: {
			query?: string
			page?: number
			per_page?: number
			sort?: 'added' | 'artist' | 'title' | 'year'
			sort_order?: 'asc' | 'desc'
		} = {},
		consumerKey: string,
		consumerSecret: string,
	): Promise<DiscogsCollectionResponse> {
		// If there's a query, we need to fetch all items and filter client-side
		// because Discogs API doesn't support server-side search within collections
		if (options.query) {
			return this.searchCollectionWithQuery(username, accessToken, accessTokenSecret, options, consumerKey, consumerSecret)
		}

		// No query - use regular collection fetching with API pagination
		const params = new URLSearchParams()

		if (options.page) params.append('page', options.page.toString())
		if (options.per_page) params.append('per_page', options.per_page.toString())
		if (options.sort) params.append('sort', options.sort)
		if (options.sort_order) params.append('sort_order', options.sort_order)

		const url = `${this.baseUrl}/users/${username}/collection/folders/0/releases?${params.toString()}`

		const authHeader = await this.createOAuthHeader(url, 'GET', accessToken, accessTokenSecret, consumerKey, consumerSecret)

		const response = await fetch(url, {
			headers: {
				Authorization: authHeader,
				'User-Agent': this.userAgent,
			},
		})

		if (!response.ok) {
			throw new Error(`Failed to search collection: ${response.status} ${response.statusText}`)
		}

		return response.json()
	}

	/**
	 * Search collection with client-side filtering
	 */
	private async searchCollectionWithQuery(
		username: string,
		accessToken: string,
		accessTokenSecret: string,
		options: {
			query?: string
			page?: number
			per_page?: number
			sort?: 'added' | 'artist' | 'title' | 'year'
			sort_order?: 'asc' | 'desc'
		},
		consumerKey: string,
		consumerSecret: string,
	): Promise<DiscogsCollectionResponse> {
		const query = options.query?.toLowerCase() || ''
		const requestedPage = options.page || 1
		const requestedPerPage = options.per_page || 50

		// Fetch all collection items (we need to paginate through all pages)
		let allReleases: DiscogsCollectionItem[] = []
		let page = 1
		let totalPages = 1

		do {
			const params = new URLSearchParams()
			params.append('page', page.toString())
			params.append('per_page', '100') // Max per page to minimize requests
			if (options.sort) params.append('sort', options.sort)
			if (options.sort_order) params.append('sort_order', options.sort_order)

			const url = `${this.baseUrl}/users/${username}/collection/folders/0/releases?${params.toString()}`
			const authHeader = await this.createOAuthHeader(url, 'GET', accessToken, accessTokenSecret, consumerKey, consumerSecret)

			const response = await fetch(url, {
				headers: {
					Authorization: authHeader,
					'User-Agent': this.userAgent,
				},
			})

			if (!response.ok) {
				throw new Error(`Failed to fetch collection: ${response.status} ${response.statusText}`)
			}

			const data: DiscogsCollectionResponse = await response.json()
			allReleases = allReleases.concat(data.releases)
			totalPages = data.pagination.pages
			page++
		} while (page <= totalPages)

		// Filter releases based on query
		const filteredReleases = allReleases.filter((item) => {
			const release = item.basic_information

			// Search by release ID (exact match or partial)
			const releaseIdMatch = item.id.toString().includes(query) || release.id.toString().includes(query)

			// Search in artist names
			const artistMatch = release.artists?.some((artist) => artist.name.toLowerCase().includes(query)) || false

			// Search in title
			const titleMatch = release.title?.toLowerCase().includes(query) || false

			// Search in genres
			const genreMatch = release.genres?.some((genre) => genre.toLowerCase().includes(query)) || false

			// Search in styles
			const styleMatch = release.styles?.some((style) => style.toLowerCase().includes(query)) || false

			// Search in label names and catalog numbers
			const labelMatch =
				release.labels?.some((label) => label.name.toLowerCase().includes(query) || label.catno.toLowerCase().includes(query)) || false

			// Search in formats
			const formatMatch = release.formats?.some((format) => format.name.toLowerCase().includes(query)) || false

			// Search by year
			const yearMatch = release.year && release.year.toString().includes(query)

			return releaseIdMatch || artistMatch || titleMatch || genreMatch || styleMatch || labelMatch || formatMatch || yearMatch
		})

		// Implement pagination on filtered results
		const totalItems = filteredReleases.length
		const totalFilteredPages = Math.ceil(totalItems / requestedPerPage)
		const startIndex = (requestedPage - 1) * requestedPerPage
		const endIndex = startIndex + requestedPerPage
		const paginatedReleases = filteredReleases.slice(startIndex, endIndex)

		return {
			pagination: {
				pages: totalFilteredPages,
				page: requestedPage,
				per_page: requestedPerPage,
				items: totalItems,
				urls: {
					next: requestedPage < totalFilteredPages ? `page=${requestedPage + 1}` : undefined,
					last: totalFilteredPages > 1 ? `page=${totalFilteredPages}` : undefined,
				},
			},
			releases: paginatedReleases,
		}
	}

	/**
	 * Get user's collection statistics
	 */
	async getCollectionStats(
		username: string,
		accessToken: string,
		accessTokenSecret: string,
		consumerKey: string,
		consumerSecret: string,
	): Promise<DiscogsCollectionStats> {
		// Get all collection items (we'll need to paginate through all pages)
		let allReleases: DiscogsCollectionItem[] = []
		let page = 1
		let totalPages = 1

		do {
			const response = await this.searchCollection(
				username,
				accessToken,
				accessTokenSecret,
				{
					page,
					per_page: 100, // Max per page
				},
				consumerKey,
				consumerSecret,
			)

			allReleases = allReleases.concat(response.releases)
			totalPages = response.pagination.pages
			page++
		} while (page <= totalPages)

		// Calculate statistics
		const stats: DiscogsCollectionStats = {
			totalReleases: allReleases.length,
			totalValue: 0, // Discogs doesn't provide value in collection endpoint
			genreBreakdown: {},
			decadeBreakdown: {},
			formatBreakdown: {},
			labelBreakdown: {},
			averageRating: 0,
			ratedReleases: 0,
		}

		let totalRating = 0
		let ratedCount = 0

		for (const item of allReleases) {
			const release = item.basic_information

			// Genre breakdown
			for (const genre of release.genres || []) {
				stats.genreBreakdown[genre] = (stats.genreBreakdown[genre] || 0) + 1
			}

			// Decade breakdown
			if (release.year) {
				const decade = `${Math.floor(release.year / 10) * 10}s`
				stats.decadeBreakdown[decade] = (stats.decadeBreakdown[decade] || 0) + 1
			}

			// Format breakdown
			for (const format of release.formats || []) {
				stats.formatBreakdown[format.name] = (stats.formatBreakdown[format.name] || 0) + 1
			}

			// Label breakdown
			for (const label of release.labels || []) {
				stats.labelBreakdown[label.name] = (stats.labelBreakdown[label.name] || 0) + 1
			}

			// Rating calculation
			if (item.rating > 0) {
				totalRating += item.rating
				ratedCount++
			}
		}

		stats.averageRating = ratedCount > 0 ? totalRating / ratedCount : 0
		stats.ratedReleases = ratedCount

		return stats
	}

	/**
	 * Get user profile to extract username
	 */
	async getUserProfile(
		accessToken: string,
		accessTokenSecret: string,
		consumerKey: string,
		consumerSecret: string,
	): Promise<{ username: string; id: number }> {
		console.log('Making OAuth request to /oauth/identity with token:', accessToken.substring(0, 10) + '...')

		const url = `${this.baseUrl}/oauth/identity`
		const authHeader = await this.createOAuthHeader(url, 'GET', accessToken, accessTokenSecret, consumerKey, consumerSecret)

		const response = await fetch(url, {
			headers: {
				Authorization: authHeader,
				'User-Agent': this.userAgent,
			},
		})

		console.log('Response status:', response.status, response.statusText)

		if (!response.ok) {
			const errorText = await response.text()
			console.log('Error response body:', errorText)
			throw new Error(`Failed to get user profile: ${response.status} ${response.statusText}`)
		}

		return response.json()
	}

	/**
	 * Search Discogs database (not user's collection)
	 */
	async searchDatabase(
		query: string,
		accessToken: string,
		accessTokenSecret?: string,
		options: {
			type?: 'release' | 'master' | 'artist' | 'label'
			page?: number
			per_page?: number
		} = {},
		consumerKey?: string,
		consumerSecret?: string,
	): Promise<DiscogsSearchResponse> {
		const params = new URLSearchParams()
		params.append('q', query)

		if (options.type) params.append('type', options.type)
		if (options.page) params.append('page', options.page.toString())
		if (options.per_page) params.append('per_page', options.per_page.toString())

		const url = `${this.baseUrl}/database/search?${params.toString()}`
		const headers: Record<string, string> = {
			'User-Agent': this.userAgent,
		}

		// Use OAuth 1.0a if we have all required parameters, otherwise fall back to simple token auth
		if (accessTokenSecret && consumerKey && consumerSecret) {
			headers['Authorization'] = await this.createOAuthHeader(url, 'GET', accessToken, accessTokenSecret, consumerKey, consumerSecret)
		} else {
			headers['Authorization'] = `Discogs token=${accessToken}`
		}

		const response = await fetch(url, {
			headers,
		})

		if (!response.ok) {
			throw new Error(`Failed to search database: ${response.status} ${response.statusText}`)
		}

		return response.json()
	}
}

// Export singleton instance
export const discogsClient = new DiscogsClient()
