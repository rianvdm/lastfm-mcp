// ABOUTME: Per-invocation count of Last.fm cache hits, misses and HTTP requests, in AsyncLocalStorage (needs nodejs_compat).
// ABOUTME: Each tool call runs inside its own tally; SmartCache and LastfmClient count into whichever tally is current.
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Cache lookups made through SmartCache.getOrFetch during one tool call, and the Last.fm HTTP requests behind them. A hit
 * is data served from KV or from a deduplicated in-flight request; a miss is a call to Last.fm. `requests` counts every
 * HTTP attempt LastfmClient makes, retries included, so one miss can cost several requests.
 */
export interface CacheTally {
	hits: number
	misses: number
	requests: number
}

const currentTally = new AsyncLocalStorage<CacheTally>()

/**
 * Runs `fn` with `tally` as the current tally, so every lookup `fn` makes, including after awaits, counts into it.
 * Concurrent calls each get their own tally, so a batch of tool calls can't count into each other's.
 */
export function runWithCacheTally<T>(tally: CacheTally, fn: () => T): T {
	return currentTally.run(tally, fn)
}

/** Counts a cache hit against the current tally; does nothing outside runWithCacheTally. */
export function countCacheHit(): void {
	const tally = currentTally.getStore()
	if (tally) tally.hits++
}

/** Counts a cache miss against the current tally; does nothing outside runWithCacheTally. */
export function countCacheMiss(): void {
	const tally = currentTally.getStore()
	if (tally) tally.misses++
}

/** Counts one Last.fm HTTP attempt against the current tally; does nothing outside runWithCacheTally. */
export function countLastfmRequest(): void {
	const tally = currentTally.getStore()
	if (tally) tally.requests++
}
