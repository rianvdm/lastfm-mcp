// ABOUTME: Per-IP fixed-window rate limiter for the public /mcp endpoint.
// ABOUTME: KV-backed, fails open on KV errors, returns Retry-After when limit exceeded.

export interface RateLimitResult {
	allowed: boolean
	limit: number
	remaining: number
	resetEpochSeconds: number
}

export interface RateLimitOptions {
	/** Requests permitted per window per key. */
	limit: number
	/** Window length in seconds. */
	windowSeconds: number
}

const DEFAULT_OPTIONS: RateLimitOptions = {
	limit: 60,
	windowSeconds: 60,
}

/**
 * Check and increment the per-key counter using a fixed window keyed by `floor(now / window)`.
 * Returns `allowed: true` (fail-open) on KV errors so a broken KV doesn't take down the service.
 */
export async function checkRateLimit(
	kv: KVNamespace,
	key: string,
	options: Partial<RateLimitOptions> = {},
): Promise<RateLimitResult> {
	const { limit, windowSeconds } = { ...DEFAULT_OPTIONS, ...options }
	const now = Math.floor(Date.now() / 1000)
	const windowId = Math.floor(now / windowSeconds)
	const resetEpochSeconds = (windowId + 1) * windowSeconds
	const kvKey = `rl:${key}:${windowId}`

	try {
		const countStr = await kv.get(kvKey)
		const count = countStr ? parseInt(countStr, 10) : 0

		if (count >= limit) {
			return { allowed: false, limit, remaining: 0, resetEpochSeconds }
		}

		// Race-tolerant: two concurrent requests may both read N and write N+1, undercounting by one.
		// Acceptable for this use case — it's a budget guard, not a security control.
		await kv.put(kvKey, String(count + 1), { expirationTtl: windowSeconds + 10 })

		return { allowed: true, limit, remaining: limit - count - 1, resetEpochSeconds }
	} catch (error) {
		console.error('[RATE_LIMIT] KV error, failing open:', error)
		return { allowed: true, limit, remaining: limit, resetEpochSeconds }
	}
}

/**
 * Build a rate-limit key from the request. Prefers CF-Connecting-IP; falls back to a fixed
 * "unknown" bucket if absent so misconfigured upstreams don't bypass the limiter entirely.
 */
export function rateLimitKeyFromRequest(request: Request): string {
	const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown'
	return `ip:${ip}`
}

/**
 * Build a 429 response with Retry-After and standard rate-limit headers.
 */
export function buildRateLimitResponse(result: RateLimitResult): Response {
	const retryAfter = Math.max(1, result.resetEpochSeconds - Math.floor(Date.now() / 1000))
	return new Response(
		JSON.stringify({
			jsonrpc: '2.0',
			error: {
				code: -32000,
				message: `Rate limit exceeded. Retry after ${retryAfter}s.`,
			},
			id: null,
		}),
		{
			status: 429,
			headers: {
				'Content-Type': 'application/json',
				'Retry-After': String(retryAfter),
				'X-RateLimit-Limit': String(result.limit),
				'X-RateLimit-Remaining': '0',
				'X-RateLimit-Reset': String(result.resetEpochSeconds),
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Expose-Headers': 'Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
			},
		},
	)
}
