/**
 * Smart caching utility for Discogs MCP server
 * Supports TTL-based caching, request deduplication, and cache warming
 */

// KVNamespace is available globally in Cloudflare Workers runtime
declare global {
	interface KVNamespace {
		get(key: string): Promise<string | null>
		put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
		list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string }> }>
		delete(key: string): Promise<void>
	}
}

export interface CacheConfig {
	collections: number // 30 minutes
	releases: number // 24 hours  
	stats: number // 1 hour
	searches: number // 15 minutes
	userProfiles: number // 6 hours
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
	collections: 30 * 60, // 30 minutes in seconds
	releases: 24 * 60 * 60, // 24 hours in seconds
	stats: 60 * 60, // 1 hour in seconds
	searches: 15 * 60, // 15 minutes in seconds
	userProfiles: 6 * 60 * 60, // 6 hours in seconds
}

export interface CacheEntry<T> {
	data: T
	timestamp: number
	expiresAt: number
	version: string // For cache versioning/invalidation
}

export interface PendingRequest {
	promise: Promise<unknown>
	timestamp: number
}

export class SmartCache {
	private kv: KVNamespace
	private config: CacheConfig
	private pendingRequests = new Map<string, PendingRequest>()
	private readonly CACHE_VERSION = '1.0.0'

	constructor(kv: KVNamespace, config: Partial<CacheConfig> = {}) {
		this.kv = kv
		this.config = { ...DEFAULT_CACHE_CONFIG, ...config }
	}

	/**
	 * Generate cache key with proper namespacing
	 */
	private getCacheKey(type: keyof CacheConfig, identifier: string): string {
		return `cache:${type}:${identifier}`
	}

	/**
	 * Generate deduplication key for pending requests
	 */
	private getDedupeKey(type: keyof CacheConfig, identifier: string): string {
		return `pending:${type}:${identifier}`
	}

	/**
	 * Get data from cache
	 */
	async get<T>(type: keyof CacheConfig, identifier: string): Promise<T | null> {
		try {
			const cacheKey = this.getCacheKey(type, identifier)
			const cached = await this.kv.get(cacheKey)
			
			if (!cached) {
				return null
			}

			const entry: CacheEntry<T> = JSON.parse(cached)
			
			// Check if cache entry has expired
			if (Date.now() > entry.expiresAt) {
				// Clean up expired entry asynchronously
				this.kv.delete(cacheKey).catch(console.error)
				return null
			}

			// Check cache version compatibility
			if (entry.version !== this.CACHE_VERSION) {
				// Clean up incompatible cache entry
				this.kv.delete(cacheKey).catch(console.error)
				return null
			}

			return entry.data
		} catch (error) {
			console.error('Cache get error:', error)
			return null
		}
	}

	/**
	 * Set data in cache with TTL
	 */
	async set<T>(type: keyof CacheConfig, identifier: string, data: T): Promise<void> {
		try {
			const ttl = this.config[type]
			const now = Date.now()
			
			const entry: CacheEntry<T> = {
				data,
				timestamp: now,
				expiresAt: now + (ttl * 1000),
				version: this.CACHE_VERSION,
			}

			const cacheKey = this.getCacheKey(type, identifier)
			await this.kv.put(cacheKey, JSON.stringify(entry), {
				expirationTtl: ttl,
			})
		} catch (error) {
			console.error('Cache set error:', error)
			// Don't throw - caching failures shouldn't break the app
		}
	}

	/**
	 * Get data with automatic caching and request deduplication
	 */
	async getOrFetch<T>(
		type: keyof CacheConfig,
		identifier: string,
		fetcher: () => Promise<T>,
		options?: {
			forceRefresh?: boolean
			maxAge?: number // Override default TTL
		}
	): Promise<T> {
		const dedupeKey = this.getDedupeKey(type, identifier)

		// Check if there's already a pending request for this data
		const pending = this.pendingRequests.get(dedupeKey)
		if (pending) {
			console.log(`Deduplicating request for ${type}:${identifier}`)
			return pending.promise as Promise<T>
		}

		// Check cache first (unless force refresh)
		if (!options?.forceRefresh) {
			const cached = await this.get<T>(type, identifier)
			if (cached) {
				// Check if cache is still fresh enough (optional maxAge override)
				if (options?.maxAge) {
					const cacheKey = this.getCacheKey(type, identifier)
					const cacheEntry = await this.kv.get(cacheKey)
					if (cacheEntry) {
						const entry: CacheEntry<T> = JSON.parse(cacheEntry)
						const age = (Date.now() - entry.timestamp) / 1000
						if (age > options.maxAge) {
							// Cache is too old, fetch fresh data
						} else {
							return cached
						}
					}
				} else {
					return cached
				}
			}
		}

		// Create new request and add to pending requests
		const promise = this.fetchAndCache(type, identifier, fetcher)
		this.pendingRequests.set(dedupeKey, {
			promise,
			timestamp: Date.now(),
		})

		// Clean up pending request when done (success or failure)
		promise.finally(() => {
			this.pendingRequests.delete(dedupeKey)
		})

		return promise
	}

	/**
	 * Fetch data and cache it
	 */
	private async fetchAndCache<T>(
		type: keyof CacheConfig,
		identifier: string,
		fetcher: () => Promise<T>
	): Promise<T> {
		try {
			console.log(`Fetching fresh data for ${type}:${identifier}`)
			const data = await fetcher()
			
			// Cache the fresh data
			await this.set(type, identifier, data)
			
			return data
		} catch (error) {
			console.error(`Failed to fetch ${type}:${identifier}:`, error)
			throw error
		}
	}

	/**
	 * Invalidate cache entries by pattern
	 */
	async invalidate(pattern: string): Promise<void> {
		try {
			// List keys matching the pattern
			const keys = await this.kv.list({ prefix: `cache:${pattern}` })
			
			// Delete matching keys
			const deletePromises = keys.keys.map(key => this.kv.delete(key.name))
			await Promise.all(deletePromises)
			
			console.log(`Invalidated ${keys.keys.length} cache entries matching: ${pattern}`)
		} catch (error) {
			console.error('Cache invalidation error:', error)
		}
	}

	/**
	 * Get cache statistics
	 */
	async getStats(): Promise<{
		totalEntries: number
		entriesByType: Record<string, number>
		pendingRequests: number
	}> {
		try {
			const allKeys = await this.kv.list({ prefix: 'cache:' })
			const entriesByType: Record<string, number> = {}
			
			for (const key of allKeys.keys) {
				const parts = key.name.split(':')
				if (parts.length >= 2) {
					const type = parts[1]
					entriesByType[type] = (entriesByType[type] || 0) + 1
				}
			}

			return {
				totalEntries: allKeys.keys.length,
				entriesByType,
				pendingRequests: this.pendingRequests.size,
			}
		} catch (error) {
			console.error('Cache stats error:', error)
			return {
				totalEntries: 0,
				entriesByType: {},
				pendingRequests: this.pendingRequests.size,
			}
		}
	}

	/**
	 * Clean up old pending requests (called periodically)
	 */
	cleanupPendingRequests(): void {
		const now = Date.now()
		const maxAge = 5 * 60 * 1000 // 5 minutes

		for (const [key, pending] of this.pendingRequests.entries()) {
			if (now - pending.timestamp > maxAge) {
				console.warn(`Cleaning up stale pending request: ${key}`)
				this.pendingRequests.delete(key)
			}
		}
	}
}

/**
 * Cache key generators for consistent naming
 */
export const CacheKeys = {
	collection: (username: string, page?: number, sort?: string) => 
		`${username}:${page || 'all'}:${sort || 'default'}`,
	
	collectionSearch: (username: string, query: string, page?: number) => 
		`${username}:${encodeURIComponent(query)}:${page || 1}`,
	
	release: (releaseId: string) => releaseId,
	
	stats: (username: string) => username,
	
	userProfile: (userId: string) => userId,
}

/**
 * Helper for creating collection-specific cache instances
 */
export function createDiscogsCache(kv: KVNamespace): SmartCache {
	return new SmartCache(kv, {
		// Tune cache TTLs based on data freshness requirements
		collections: 30 * 60, // Collections don't change often
		releases: 24 * 60 * 60, // Release data is mostly static
		stats: 60 * 60, // Stats can be cached for an hour
		searches: 15 * 60, // Search results cached for 15 minutes
		userProfiles: 6 * 60 * 60, // User profiles rarely change
	})
} 