/**
 * Cached wrapper for DiscogsClient
 * Implements smart caching to reduce API calls and rate limiting issues
 */

import { DiscogsClient, type DiscogsCollectionResponse, type DiscogsRelease, type DiscogsCollectionStats, type DiscogsSearchResponse } from './discogs'
import { SmartCache, CacheKeys, createDiscogsCache } from '../utils/cache'

export class CachedDiscogsClient {
	private client: DiscogsClient
	private cache: SmartCache

	constructor(client: DiscogsClient, kv: KVNamespace) {
		this.client = client
		this.cache = createDiscogsCache(kv)
	}

	/**
	 * Get detailed information about a specific release with caching
	 */
	async getRelease(
		releaseId: string,
		accessToken: string,
		accessTokenSecret?: string,
		consumerKey?: string,
		consumerSecret?: string,
	): Promise<DiscogsRelease> {
		const cacheKey = CacheKeys.release(releaseId)
		
		return this.cache.getOrFetch(
			'releases',
			cacheKey,
			() => this.client.getRelease(releaseId, accessToken, accessTokenSecret, consumerKey, consumerSecret)
		)
	}

	/**
	 * Search user's collection with intelligent caching
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
		// Different caching strategies based on query type
		if (options.query) {
			// Search queries - shorter cache time since they're context-specific
			const cacheKey = CacheKeys.collectionSearch(username, options.query, options.page)
			
			return this.cache.getOrFetch(
				'searches',
				cacheKey,
				() => this.client.searchCollection(username, accessToken, accessTokenSecret, options, consumerKey, consumerSecret)
			)
		} else {
			// Collection browsing - longer cache time since collections don't change often
			const cacheKey = CacheKeys.collection(username, options.page, `${options.sort || 'default'}:${options.sort_order || 'desc'}`)
			
			return this.cache.getOrFetch(
				'collections',
				cacheKey,
				() => this.client.searchCollection(username, accessToken, accessTokenSecret, options, consumerKey, consumerSecret),
				{ maxAge: 20 * 60 } // Override: refresh collection data if older than 20 minutes for browsing
			)
		}
	}

	/**
	 * Get user's collection statistics with caching
	 */
	async getCollectionStats(
		username: string,
		accessToken: string,
		accessTokenSecret: string,
		consumerKey: string,
		consumerSecret: string,
	): Promise<DiscogsCollectionStats> {
		const cacheKey = CacheKeys.stats(username)
		
		return this.cache.getOrFetch(
			'stats',
			cacheKey,
			() => this.client.getCollectionStats(username, accessToken, accessTokenSecret, consumerKey, consumerSecret)
		)
	}

	/**
	 * Get user profile with caching
	 */
	async getUserProfile(
		accessToken: string,
		accessTokenSecret: string,
		consumerKey: string,
		consumerSecret: string,
	): Promise<{ username: string; id: number }> {
		const cacheKey = CacheKeys.userProfile(accessToken) // Use token as unique identifier
		
		return this.cache.getOrFetch(
			'userProfiles',
			cacheKey,
			() => this.client.getUserProfile(accessToken, accessTokenSecret, consumerKey, consumerSecret)
		)
	}

	/**
	 * Search Discogs database with basic caching
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
		// Database searches are cached for shorter time since they may return different results
		const cacheKey = `${query}:${options.type || 'all'}:${options.page || 1}:${options.per_page || 50}`
		
		return this.cache.getOrFetch(
			'searches',
			cacheKey,
			() => this.client.searchDatabase(query, accessToken, accessTokenSecret, options, consumerKey, consumerSecret),
			{ maxAge: 10 * 60 } // Database searches cached for only 10 minutes
		)
	}

	/**
	 * Get cache statistics
	 */
	async getCacheStats() {
		return this.cache.getStats()
	}

	/**
	 * Invalidate cache for a specific user
	 */
	async invalidateUserCache(username: string) {
		await Promise.all([
			this.cache.invalidate(`collections:${username}`),
			this.cache.invalidate(`searches:${username}`),
			this.cache.invalidate(`stats:${username}`),
		])
	}

	/**
	 * Preload essential data for a user (cache warming)
	 */
	async warmUserCache(
		username: string,
		accessToken: string,
		accessTokenSecret: string,
		consumerKey: string,
		consumerSecret: string,
	): Promise<void> {
		console.log(`Warming cache for user: ${username}`)
		
		try {
			// Preload first page of collection
			await this.searchCollection(username, accessToken, accessTokenSecret, { page: 1, per_page: 50 }, consumerKey, consumerSecret)
			
			// Preload user profile
			await this.getUserProfile(accessToken, accessTokenSecret, consumerKey, consumerSecret)
			
			console.log(`Cache warming completed for user: ${username}`)
		} catch (error) {
			console.error(`Cache warming failed for user: ${username}:`, error)
			// Don't throw - cache warming is optional
		}
	}

	/**
	 * Batch collection fetching with intelligent pagination
	 */
	async getCompleteCollection(
		username: string,
		accessToken: string,
		accessTokenSecret: string,
		consumerKey: string,
		consumerSecret: string,
		maxPages: number = 10 // Limit to prevent excessive API calls
	): Promise<DiscogsCollectionResponse> {
		const cacheKey = `${username}:complete:${maxPages}`
		
		return this.cache.getOrFetch(
			'collections',
			cacheKey,
			async () => {
				console.log(`Fetching complete collection for ${username} (max ${maxPages} pages)`)
				
				// Start with first page
				let allReleases: any[] = []
				let currentPage = 1
				let totalPages = 1
				
				do {
					const pageResult = await this.searchCollection(
						username,
						accessToken,
						accessTokenSecret,
						{ page: currentPage, per_page: 100 },
						consumerKey,
						consumerSecret
					)
					
					allReleases = allReleases.concat(pageResult.releases)
					totalPages = Math.min(pageResult.pagination.pages, maxPages)
					currentPage++
					
					// Add small delay between requests to be respectful
					if (currentPage <= totalPages) {
						await new Promise(resolve => setTimeout(resolve, 200))
					}
				} while (currentPage <= totalPages)
				
				// Return in the same format as regular collection response
				return {
					pagination: {
						pages: totalPages,
						page: 1,
						per_page: allReleases.length,
						items: allReleases.length,
						urls: {},
					},
					releases: allReleases,
				}
			},
			{ maxAge: 45 * 60 } // Cache complete collections for 45 minutes
		)
	}

	/**
	 * Cleanup old cache entries
	 */
	async cleanupCache(): Promise<void> {
		this.cache.cleanupPendingRequests()
	}
}

/**
 * Factory function to create cached client
 */
export function createCachedDiscogsClient(kv: KVNamespace): CachedDiscogsClient {
	const client = new DiscogsClient()
	return new CachedDiscogsClient(client, kv)
}

/**
 * Export singleton instance creator
 */
let cachedClientInstance: CachedDiscogsClient | null = null

export function getCachedDiscogsClient(kv: KVNamespace): CachedDiscogsClient {
	if (!cachedClientInstance) {
		cachedClientInstance = createCachedDiscogsClient(kv)
	}
	return cachedClientInstance
} 