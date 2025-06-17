/**
 * Smart caching utility for Last.fm MCP server
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
	// User data (changes frequently)
	userRecentTracks: number // 5 minutes
	userTopArtists: number // 1 hour
	userTopAlbums: number // 1 hour
	userLovedTracks: number // 30 minutes
	userInfo: number // 6 hours
	userListeningStats: number // 1 hour
	userRecommendations: number // 24 hours

	// Static music data (changes rarely)
	trackInfo: number // 24 hours
	artistInfo: number // 24 hours
	albumInfo: number // 24 hours
	similarArtists: number // 7 days
	similarTracks: number // 7 days
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
	// User data (changes frequently)
	userRecentTracks: 5 * 60, // 5 minutes in seconds
	userTopArtists: 60 * 60, // 1 hour in seconds
	userTopAlbums: 60 * 60, // 1 hour in seconds
	userLovedTracks: 30 * 60, // 30 minutes in seconds
	userInfo: 6 * 60 * 60, // 6 hours in seconds
	userListeningStats: 60 * 60, // 1 hour in seconds
	userRecommendations: 24 * 60 * 60, // 24 hours in seconds

	// Static music data (changes rarely)
	trackInfo: 24 * 60 * 60, // 24 hours in seconds
	artistInfo: 24 * 60 * 60, // 24 hours in seconds
	albumInfo: 24 * 60 * 60, // 24 hours in seconds
	similarArtists: 7 * 24 * 60 * 60, // 7 days in seconds
	similarTracks: 7 * 24 * 60 * 60, // 7 days in seconds
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
				expiresAt: now + ttl * 1000,
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
		},
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
	private async fetchAndCache<T>(type: keyof CacheConfig, identifier: string, fetcher: () => Promise<T>): Promise<T> {
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
			const deletePromises = keys.keys.map((key) => this.kv.delete(key.name))
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
	// User data keys
	userRecentTracks: (username: string, limit?: number, from?: number, to?: number, page?: number) =>
		`${username}:${limit || 50}:${from || ''}:${to || ''}:${page || 1}`,

	userTopArtists: (username: string, period?: string, limit?: number) => `${username}:${period || 'overall'}:${limit || 50}`,

	userTopAlbums: (username: string, period?: string, limit?: number) => `${username}:${period || 'overall'}:${limit || 50}`,

	userLovedTracks: (username: string, limit?: number) => `${username}:${limit || 50}`,

	userInfo: (username: string) => username,

	userListeningStats: (username: string, period?: string) => `${username}:${period || 'overall'}`,

	userRecommendations: (username: string, limit?: number, genre?: string) => `${username}:${limit || 20}:${genre || 'all'}`,

	// Static music data keys
	trackInfo: (artist: string, track: string, username?: string) =>
		`${encodeURIComponent(artist)}:${encodeURIComponent(track)}:${username || 'global'}`,

	artistInfo: (artist: string, username?: string) => `${encodeURIComponent(artist)}:${username || 'global'}`,

	albumInfo: (artist: string, album: string, username?: string) =>
		`${encodeURIComponent(artist)}:${encodeURIComponent(album)}:${username || 'global'}`,

	similarArtists: (artist: string, limit?: number) => `${encodeURIComponent(artist)}:${limit || 30}`,

	similarTracks: (artist: string, track: string, limit?: number) =>
		`${encodeURIComponent(artist)}:${encodeURIComponent(track)}:${limit || 30}`,
}

/**
 * Helper for creating Last.fm-specific cache instances
 */
export function createLastfmCache(kv?: KVNamespace): SmartCache {
	if (!kv) {
		console.log('No KV storage available, falling back to direct client')
		// Return a mock cache that doesn't actually cache anything
		return {
			async get() {
				return null
			},
			async set() {
				return
			},
			async getOrFetch(_type, _key, fetcher) {
				return fetcher()
			},
			async invalidate() {
				return
			},
			async invalidatePattern() {
				return
			},
			async getStats() {
				return { totalEntries: 0, entriesByType: {}, pendingRequests: 0 }
			},
			cleanupPendingRequests() {
				return
			},
		} as SmartCache
	}

	return new SmartCache(kv, {
		// Tune cache TTLs based on data freshness requirements
		userRecentTracks: 5 * 60, // Recent tracks change frequently
		userTopArtists: 60 * 60, // Top artists change slower
		userTopAlbums: 60 * 60, // Top albums change slower
		userLovedTracks: 30 * 60, // Loved tracks change occasionally
		userInfo: 6 * 60 * 60, // User profiles rarely change
		userListeningStats: 60 * 60, // Stats can be cached for an hour
		userRecommendations: 24 * 60 * 60, // Recommendations can be cached longer

		// Static music data can be cached for a long time
		trackInfo: 24 * 60 * 60, // Track data is mostly static
		artistInfo: 24 * 60 * 60, // Artist data is mostly static
		albumInfo: 24 * 60 * 60, // Album data is mostly static
		similarArtists: 7 * 24 * 60 * 60, // Similar artists rarely change
		similarTracks: 7 * 24 * 60 * 60, // Similar tracks rarely change
	})
}
