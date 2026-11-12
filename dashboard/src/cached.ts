// ABOUTME: Read-through cache in DASH_KV for the dashboard's computed summaries, so page reloads don't re-query the analytics APIs.
// ABOUTME: Only successful loads are cached, and a KV failure falls back to loading: the cache must never break the page.
import type { DashEnv } from './env'

/**
 * Returns the JSON value cached at `key`, or runs `load`, caches its result for `ttlSeconds` and returns it.
 * A rejected load rejects here too and caches nothing, so the next request retries upstream.
 */
export async function cachedJson<T>(env: DashEnv, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
	try {
		const cached = await env.DASH_KV.get<T>(key, 'json')
		if (cached !== null) return cached
	} catch (error) {
		console.warn(`[STATS] cache read failed for ${key}:`, error instanceof Error ? error.message : 'Unknown error')
	}

	const value = await load()
	try {
		await env.DASH_KV.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds })
	} catch (error) {
		console.warn(`[STATS] cache write failed for ${key}:`, error instanceof Error ? error.message : 'Unknown error')
	}
	return value
}
