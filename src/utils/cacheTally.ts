// ABOUTME: Per-invocation count of Last.fm cache hits and misses, carried in AsyncLocalStorage (needs nodejs_compat).
// ABOUTME: Tool-call instrumentation runs each call inside its own tally; SmartCache counts into whichever tally is current.
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Cache lookups made through SmartCache.getOrFetch during one tool call. A hit is data served from KV or from a
 * deduplicated in-flight request; a miss is a call to Last.fm.
 */
export interface CacheTally {
	hits: number
	misses: number
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
