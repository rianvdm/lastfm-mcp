// ABOUTME: Per-IP budget for POST /oauth/register (dynamic client registration), backed by the Rate Limiting binding.
// ABOUTME: Fails open when the binding errors, and builds the OAuth-style 429 a registering client receives.
import type { RateLimit } from '@cloudflare/workers-types'

/**
 * The binding's `simple.period` in wrangler.toml (10 or 60 seconds), sent as Retry-After. The binding doesn't report
 * when a key's count resets, so a refused client waits one full period.
 */
export const REGISTRATION_RATE_LIMIT_PERIOD_SECONDS = 60

/**
 * Whether `key` may register another client. A legitimate client registers once per install, so the budget is
 * small; it bounds KV writes from scripted registrations. It's a cost guard, not a security control: a registration
 * can only receive codes for flows it started itself. Counts are approximate and kept per Cloudflare location.
 * Fails open when the binding throws, so a limiter problem never blocks sign-in.
 */
export async function allowClientRegistration(limiter: RateLimit, key: string): Promise<boolean> {
	try {
		const { success } = await limiter.limit({ key })
		return success
	} catch (error) {
		console.error('[RATE_LIMIT] registration limiter failed, failing open:', error instanceof Error ? error.message : 'Unknown error')
		return true
	}
}

/**
 * The 429 for a refused registration: an OAuth-style `error` / `error_description` body (RFC 7591 §3.2.2), since
 * registering clients parse OAuth errors, not JSON-RPC. `too_many_requests` is not a code RFC 7591 defines; clients
 * act on the 429 status and Retry-After.
 */
export function buildRegistrationRateLimitResponse(): Response {
	const retryAfter = REGISTRATION_RATE_LIMIT_PERIOD_SECONDS
	return new Response(
		JSON.stringify({
			error: 'too_many_requests',
			error_description: `Too many client registrations from this address. Retry after ${retryAfter}s.`,
		}),
		{
			status: 429,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
				'Retry-After': String(retryAfter),
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Expose-Headers': 'Retry-After',
			},
		},
	)
}
