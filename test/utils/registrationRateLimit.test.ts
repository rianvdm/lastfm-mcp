// ABOUTME: Unit tests for the POST /oauth/register rate-limit helpers.
// ABOUTME: Covers the limiter decision, fail-open on binding errors, and the OAuth-style 429.
import type { RateLimit } from '@cloudflare/workers-types'
import { describe, it, expect, vi } from 'vitest'

import {
	REGISTRATION_RATE_LIMIT_PERIOD_SECONDS,
	allowClientRegistration,
	buildRegistrationRateLimitResponse,
} from '../../src/utils/registrationRateLimit'

function limiter(limit: RateLimit['limit']): RateLimit {
	return { limit } as RateLimit
}

describe('allowClientRegistration', () => {
	it('passes the key to the binding and returns its decision', async () => {
		const limit = vi.fn().mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false })

		expect(await allowClientRegistration(limiter(limit), 'ip:203.0.113.1')).toBe(true)
		expect(await allowClientRegistration(limiter(limit), 'ip:203.0.113.1')).toBe(false)
		expect(limit).toHaveBeenCalledWith({ key: 'ip:203.0.113.1' })
	})

	it('fails open and logs when the binding throws', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})

		const allowed = await allowClientRegistration(limiter(vi.fn().mockRejectedValue(new Error('binding down'))), 'ip:203.0.113.1')

		expect(allowed).toBe(true)
		expect(error).toHaveBeenCalledWith('[RATE_LIMIT] registration limiter failed, failing open:', 'binding down')
		error.mockRestore()
	})
})

describe('buildRegistrationRateLimitResponse', () => {
	it('returns a 429 with Retry-After of one period and an OAuth error body', async () => {
		const res = buildRegistrationRateLimitResponse()

		expect(res.status).toBe(429)
		expect(res.headers.get('Retry-After')).toBe(String(REGISTRATION_RATE_LIMIT_PERIOD_SECONDS))
		expect(res.headers.get('Content-Type')).toBe('application/json')
		expect(res.headers.get('Cache-Control')).toBe('no-store')
		expect(res.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After')

		const body = (await res.json()) as { error: string; error_description: string }
		expect(body).toEqual({
			error: 'too_many_requests',
			error_description: `Too many client registrations from this address. Retry after ${REGISTRATION_RATE_LIMIT_PERIOD_SECONDS}s.`,
		})
	})
})
