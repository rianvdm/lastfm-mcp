// Discogs API client for interacting with user collections and releases

import { DiscogsAuth } from '../auth/discogs'
import { fetchWithRetry, RetryOptions } from '../utils/retry'
import { hasMoodContent, analyzeMoodQuery } from '../utils/moodMapping'

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
	private lastRequestTime = 0

	// Discogs-specific retry configuration (more aggressive than default)
	private readonly discogsRetryOptions: RetryOptions = {
		maxRetries: 3, // Balanced for both production and testing
		initialDelayMs: 1500, // Moderately increased from default 1000ms
		maxDelayMs: 20000, // Reasonable max delay (20s)
		backoffMultiplier: 2,
		jitterFactor: 0.1,
	}

	// Minimum delay between Discogs API requests (proactive rate limiting)
	private readonly REQUEST_DELAY_MS = 150 // 150ms between requests = ~400 requests/minute (well under Discogs limits)

	/**
	 * Add a small delay between requests to proactively avoid rate limits
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

		try {
			await this.throttleRequest()
			const response = await fetchWithRetry(
				url,
				{
					headers,
				},
				this.discogsRetryOptions,
			)

			return response.json()
		} catch (error) {
			if (error instanceof Error && error.message.includes('429')) {
				throw new Error(`Discogs API rate limit exceeded for release ${releaseId}. Please try again later.`)
			}
			throw new Error(`Failed to fetch release ${releaseId}: ${error instanceof Error ? error.message : 'Unknown error'}`)
		}
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

		try {
			await this.throttleRequest()
			const response = await fetchWithRetry(
				url,
				{
					headers: {
						Authorization: authHeader,
						'User-Agent': this.userAgent,
					},
				},
				this.discogsRetryOptions,
			)

			return response.json()
		} catch (error) {
			if (error instanceof Error && error.message.includes('429')) {
				throw new Error('Discogs API rate limit exceeded for collection search. Please try again later.')
			}
			throw new Error(`Failed to search collection: ${error instanceof Error ? error.message : 'Unknown error'}`)
		}
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

		// Extract temporal terms that should affect sorting rather than filtering
		const temporalTerms = ['recent', 'recently', 'new', 'newest', 'latest', 'old', 'oldest', 'earliest']
		const queryWords = query.split(/\s+/)
		const hasRecent = queryWords.some(word => ['recent', 'recently', 'new', 'newest', 'latest'].includes(word))
		const hasOld = queryWords.some(word => ['old', 'oldest', 'earliest'].includes(word))
		
		// Remove temporal terms from the actual search query
		const filteredQuery = queryWords
			.filter(word => !temporalTerms.includes(word))
			.join(' ')

		// Determine sorting based on temporal terms
		let sortBy: 'added' | 'artist' | 'title' | 'year' = options.sort || 'added'
		let sortOrder: 'asc' | 'desc' = options.sort_order || 'desc'
		
		if (hasRecent) {
			sortBy = 'added'  // Sort by date added
			sortOrder = 'desc'  // Most recent first
		} else if (hasOld) {
			sortBy = 'added'  // Sort by date added
			sortOrder = 'asc'   // Oldest first
		}

		// Fetch all collection items (we need to paginate through all pages)
		let allReleases: DiscogsCollectionItem[] = []
		let page = 1
		let totalPages = 1

		do {
			const params = new URLSearchParams()
			params.append('page', page.toString())
			params.append('per_page', '100') // Max per page to minimize requests
			params.append('sort', sortBy)
			params.append('sort_order', sortOrder)

			const url = `${this.baseUrl}/users/${username}/collection/folders/0/releases?${params.toString()}`
			const authHeader = await this.createOAuthHeader(url, 'GET', accessToken, accessTokenSecret, consumerKey, consumerSecret)

			try {
				await this.throttleRequest()
				const response = await fetchWithRetry(
					url,
					{
						headers: {
							Authorization: authHeader,
							'User-Agent': this.userAgent,
						},
					},
					this.discogsRetryOptions,
				)

				const data: DiscogsCollectionResponse = await response.json()
				allReleases = allReleases.concat(data.releases)
				totalPages = data.pagination.pages
				page++
			} catch (error) {
				if (error instanceof Error && error.message.includes('429')) {
					throw new Error(`Discogs API rate limit exceeded while fetching collection page ${page}. Please try again later.`)
				}
				throw new Error(`Failed to fetch collection page ${page}: ${error instanceof Error ? error.message : 'Unknown error'}`)
			}
		} while (page <= totalPages)

		// Filter releases based on the cleaned query (without temporal terms)
		let filteredReleases = allReleases
		
		if (filteredQuery.trim()) {
			filteredReleases = allReleases.filter((item) => {
				const release = item.basic_information

				// For single word queries or exact ID searches, use simple includes
				if (!filteredQuery.includes(' ') || /^\d+$/.test(filteredQuery)) {
					// Search by release ID (exact match or partial)
					const releaseIdMatch = item.id.toString().includes(filteredQuery) || release.id.toString().includes(filteredQuery)

					// Search in artist names
					const artistMatch = release.artists?.some((artist) => artist.name.toLowerCase().includes(filteredQuery)) || false

					// Search in title
					const titleMatch = release.title?.toLowerCase().includes(filteredQuery) || false

					// Search in genres
					const genreMatch = release.genres?.some((genre) => genre.toLowerCase().includes(filteredQuery)) || false

					// Search in styles
					const styleMatch = release.styles?.some((style) => style.toLowerCase().includes(filteredQuery)) || false

					// Search in label names and catalog numbers
					const labelMatch =
						release.labels?.some((label) => label.name.toLowerCase().includes(filteredQuery) || label.catno.toLowerCase().includes(filteredQuery)) || false

					// Search in formats
					const formatMatch = release.formats?.some((format) => format.name.toLowerCase().includes(filteredQuery)) || false

					// Search by year - enhanced to handle decade matching
					let yearMatch = false
					if (release.year) {
						const yearStr = release.year.toString()
						// Direct year match
						if (yearStr.includes(filteredQuery)) {
							yearMatch = true
						}
						// Decade matching (e.g., "1960s" matches years 1960-1969)
						const decadeMatch = filteredQuery.match(/(\d{4})s$/)
						if (decadeMatch) {
							const startDecade = parseInt(decadeMatch[1])
							if (release.year >= startDecade && release.year < startDecade + 10) {
								yearMatch = true
							}
						}
					}

					return releaseIdMatch || artistMatch || titleMatch || genreMatch || styleMatch || labelMatch || formatMatch || yearMatch
				}

				// For multi-word queries, use smart matching logic
				const queryTerms = filteredQuery.split(/\s+/).filter((term) => term.length > 2) // Split into words, ignore short words

				// Separate decade terms from other terms
				const decadeTerms: string[] = []
				const nonDecadeTerms: string[] = []

				queryTerms.forEach((term) => {
					const decadeMatch = term.match(/^(\d{4})s$/)
					if (decadeMatch) {
						decadeTerms.push(term)
					} else {
						nonDecadeTerms.push(term)
					}
				})

				// Create searchable text from all release information (including decade)
				const searchableFields = [
					...(release.artists?.map((artist) => artist.name) || []),
					release.title,
					...(release.genres || []),
					...(release.styles || []),
					...(release.labels?.map((label) => label.name) || []),
					...(release.labels?.map((label) => label.catno) || []),
					...(release.formats?.map((format) => format.name) || []),
					release.year?.toString() || '',
					item.id.toString(),
					release.id.toString(),
				]

				// Add decade representation if we have a year
				if (release.year) {
					const decade = `${Math.floor(release.year / 10) * 10}s`
					searchableFields.push(decade)
				}

				const searchableText = searchableFields.join(' ').toLowerCase()

				// Check if this looks like a genre/style or mood query
				const genreStyleTerms = [
					'ambient', 'drone', 'progressive', 'rock', 'jazz', 'blues', 'electronic', 'techno', 'house',
					'metal', 'punk', 'folk', 'country', 'classical', 'hip', 'hop', 'rap', 'soul', 'funk', 'disco',
					'reggae', 'ska', 'indie', 'alternative', 'psychedelic', 'experimental', 'avant-garde',
					'minimal', 'downtempo', 'chillout', 'trance', 'dubstep', 'garage', 'post-rock', 'post-punk',
					'new wave', 'synthpop', 'industrial', 'gothic', 'darkwave', 'shoegaze', 'grunge', 'hardcore'
				]
				
				// Check if this is a mood-based query that should use different filtering logic
				const isMoodQuery = hasMoodContent(filteredQuery)
				
				const isGenreStyleQuery = nonDecadeTerms.some(term => 
					genreStyleTerms.includes(term.toLowerCase()) ||
					// Also check if the term appears in the release's genres or styles
					release.genres?.some(g => g.toLowerCase().includes(term.toLowerCase())) ||
					release.styles?.some(s => s.toLowerCase().includes(term.toLowerCase()))
				)

				// Check non-decade terms using OR logic for genre/style/mood queries, AND logic for others
				let nonDecadeMatch = false
				if (nonDecadeTerms.length === 0) {
					nonDecadeMatch = true
				} else if (isGenreStyleQuery || isMoodQuery) {
					// Use OR logic for genre/style/mood queries - at least one term must match
					// For mood queries, also check against mood-mapped genres/styles
					if (isMoodQuery) {
						const moodAnalysis = analyzeMoodQuery(filteredQuery)
						if (moodAnalysis.confidence >= 0.3) {
							const releaseGenres = release.genres?.map(g => g.toLowerCase()) || []
							const releaseStyles = release.styles?.map(s => s.toLowerCase()) || []
							const suggestedGenres = moodAnalysis.suggestedGenres.map(g => g.toLowerCase())
							const suggestedStyles = moodAnalysis.suggestedStyles.map(s => s.toLowerCase())
							
							// Check if release matches any mood-suggested genres/styles
							const moodMatch = 
								releaseGenres.some(rg => suggestedGenres.some(sg => rg.includes(sg) || sg.includes(rg))) ||
								releaseStyles.some(rs => suggestedStyles.some(ss => rs.includes(ss) || ss.includes(rs)))
							
							// Also check original term matching as fallback
							const termMatch = nonDecadeTerms.some((term) => searchableText.includes(term))
							
							nonDecadeMatch = moodMatch || termMatch
						} else {
							nonDecadeMatch = nonDecadeTerms.some((term) => searchableText.includes(term))
						}
					} else {
						// Regular genre/style query - use OR logic
						nonDecadeMatch = nonDecadeTerms.some((term) => searchableText.includes(term))
					}
				} else {
					// Use AND logic for other queries - all terms must match (original behavior)
					nonDecadeMatch = nonDecadeTerms.every((term) => searchableText.includes(term))
				}

				// Check decade terms (at least one must match - OR logic for conflicting decades)
				const decadeMatch =
					decadeTerms.length === 0 ||
					decadeTerms.some((term) => {
						// Direct decade string match (e.g., "1960s")
						if (searchableText.includes(term)) {
							return true
						}
						// Manual decade range check as fallback
						const decadeYear = parseInt(term.replace('s', ''))
						return release.year && release.year >= decadeYear && release.year < decadeYear + 10
					})

				return nonDecadeMatch && decadeMatch
			})
		}

		// Apply relevance scoring for multi-word queries to prioritize better matches
		if (filteredQuery.trim() && filteredQuery.includes(' ') && !hasRecent && !hasOld) {
			const queryTerms = filteredQuery.split(/\s+/).filter((term) => term.length > 2)
			
			// Check if this is a mood-based query
			const isMoodQuery = hasMoodContent(filteredQuery)
			let moodAnalysis = null
			if (isMoodQuery) {
				moodAnalysis = analyzeMoodQuery(filteredQuery)
			}
			
			// Add relevance scores to releases
			type ReleaseWithRelevance = DiscogsCollectionItem & { relevanceScore: number; moodScore?: number }
			const releasesWithRelevance: ReleaseWithRelevance[] = filteredReleases.map((item) => {
				const release = item.basic_information
				
				// Create searchable text from all release information
				const searchableFields = [
					...(release.artists?.map((artist) => artist.name) || []),
					release.title,
					...(release.genres || []),
					...(release.styles || []),
					...(release.labels?.map((label) => label.name) || []),
					...(release.labels?.map((label) => label.catno) || []),
					...(release.formats?.map((format) => format.name) || []),
					release.year?.toString() || '',
					item.id.toString(),
					release.id.toString(),
				]
				
				// Add decade representation if we have a year
				if (release.year) {
					const decade = `${Math.floor(release.year / 10) * 10}s`
					searchableFields.push(decade)
				}
				
				const searchableText = searchableFields.join(' ').toLowerCase()
				
				// Count matching terms for relevance scoring
				const matchingTerms = queryTerms.filter((term) => searchableText.includes(term)).length
				const relevanceScore = matchingTerms / queryTerms.length
				
				// Calculate mood-based relevance if this is a mood query
				let moodScore = 0
				if (isMoodQuery && moodAnalysis && moodAnalysis.confidence >= 0.3) {
					const releaseGenres = release.genres?.map(g => g.toLowerCase()) || []
					const releaseStyles = release.styles?.map(s => s.toLowerCase()) || []
					
					// Score based on mood-suggested genres/styles
					const suggestedGenres = moodAnalysis.suggestedGenres.map(g => g.toLowerCase())
					const suggestedStyles = moodAnalysis.suggestedStyles.map(s => s.toLowerCase())
					
					let genreMatches = 0
					let styleMatches = 0
					
					// Count genre matches with weight
					for (const genre of suggestedGenres) {
						if (releaseGenres.some(rg => rg.includes(genre.toLowerCase()) || genre.toLowerCase().includes(rg))) {
							genreMatches += 1.0
						}
					}
					
					// Count style matches with weight  
					for (const style of suggestedStyles) {
						if (releaseStyles.some(rs => rs.includes(style.toLowerCase()) || style.toLowerCase().includes(rs))) {
							styleMatches += 0.8 // Styles weighted slightly less than genres
						}
					}
					
					// Bonus scoring for contextual factors
					let contextBonus = 0
					if (filteredQuery.includes('background') || filteredQuery.includes('ambient')) {
						// Prefer instrumental/ambient music for background
						if (releaseGenres.includes('ambient') || releaseStyles.includes('instrumental')) {
							contextBonus += 0.3
						}
					}
					
					if (filteredQuery.includes('dinner') || filteredQuery.includes('cooking')) {
						// Prefer mellower, non-aggressive music for dining
						const aggressiveGenres = ['metal', 'hardcore', 'punk', 'industrial']
						const aggressiveStyles = ['death metal', 'black metal', 'grindcore', 'noise']
						const isAggressive = releaseGenres.some(g => aggressiveGenres.includes(g)) || 
											releaseStyles.some(s => aggressiveStyles.some(ag => s.includes(ag)))
						if (!isAggressive) {
							contextBonus += 0.2
						}
						
						// Bonus for jazz/classical/folk for dining
						if (releaseGenres.some(g => ['jazz', 'classical', 'folk'].includes(g))) {
							contextBonus += 0.3
						}
					}
					
					// Calculate total mood score (normalize to 0-1 range)
					const totalMatches = genreMatches + styleMatches + contextBonus
					const maxPossibleMatches = suggestedGenres.length + suggestedStyles.length * 0.8 + 0.6 // max context bonus
					moodScore = maxPossibleMatches > 0 ? totalMatches / maxPossibleMatches : 0
				}
				
				return { ...item, relevanceScore, moodScore }
			})
			
			// Sort based on query type
			releasesWithRelevance.sort((a, b) => {
				if (isMoodQuery && moodAnalysis && moodAnalysis.confidence >= 0.3) {
					// For mood queries: prioritize mood relevance, then general relevance, then rating
					const aMoodScore = a.moodScore || 0
					const bMoodScore = b.moodScore || 0
					
					if (aMoodScore !== bMoodScore) {
						return bMoodScore - aMoodScore
					}
					if (a.relevanceScore !== b.relevanceScore) {
						return b.relevanceScore - a.relevanceScore
					}
					if (a.rating !== b.rating) {
						return b.rating - a.rating
					}
					return new Date(b.date_added).getTime() - new Date(a.date_added).getTime()
				} else {
					// For regular queries: sort by relevance first, then rating, then date
					if (a.relevanceScore !== b.relevanceScore) {
						return b.relevanceScore - a.relevanceScore
					}
					if (a.rating !== b.rating) {
						return b.rating - a.rating
					}
					return new Date(b.date_added).getTime() - new Date(a.date_added).getTime()
				}
			})
			
			// Convert back to regular releases (remove scoring properties)
			filteredReleases = releasesWithRelevance.map(({ relevanceScore: _relevanceScore, moodScore: _moodScore, ...release }) => release)
		} else if (hasRecent || hasOld) {
			// Keep the API sorting since we specified it above
		} else {
			// Fall back to default sorting (by rating and date)
			filteredReleases.sort((a: DiscogsCollectionItem, b: DiscogsCollectionItem) => {
				if (a.rating !== b.rating) {
					return b.rating - a.rating
				}
				return new Date(b.date_added).getTime() - new Date(a.date_added).getTime()
			})
		}

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

		try {
			await this.throttleRequest()
			const response = await fetchWithRetry(
				url,
				{
					headers: {
						Authorization: authHeader,
						'User-Agent': this.userAgent,
					},
				},
				this.discogsRetryOptions,
			)

			return response.json()
		} catch (error) {
			if (error instanceof Error && error.message.includes('429')) {
				throw new Error('Discogs API rate limit exceeded for user profile. Please try again later.')
			}
			const errorText = error instanceof Error ? error.message : 'Unknown error'
			console.log('Error response:', errorText)
			throw new Error(`Failed to get user profile: ${errorText}`)
		}
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

		try {
			await this.throttleRequest()
			const response = await fetchWithRetry(
				url,
				{
					headers,
				},
				this.discogsRetryOptions,
			)

			return response.json()
		} catch (error) {
			if (error instanceof Error && error.message.includes('429')) {
				throw new Error('Discogs API rate limit exceeded for database search. Please try again later.')
			}
			throw new Error(`Failed to search database: ${error instanceof Error ? error.message : 'Unknown error'}`)
		}
	}
}

// Export singleton instance
export const discogsClient = new DiscogsClient()
