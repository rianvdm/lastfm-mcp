// ABOUTME: Checks the REGISTRATION_RATE_LIMITER binding that wrangler.toml declares for staging and production.
// ABOUTME: Bindings aren't inherited by [env.production], and a missing binding would fail open, so drift fails here.
import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'

import { REGISTRATION_RATE_LIMIT_PERIOD_SECONDS } from '../src/utils/registrationRateLimit'

interface LimiterConfig {
	namespace_id: string
	simple: { limit: number; period: number }
}

const limiters = JSON.parse(env.TEST_REGISTRATION_RATE_LIMITERS) as { staging: LimiterConfig | null; production: LimiterConfig | null }

describe('REGISTRATION_RATE_LIMITER in wrangler.toml', () => {
	it.each(['staging', 'production'] as const)('should be declared for %s', (environment) => {
		expect(limiters[environment]).not.toBeNull()
	})

	it('should give production the same budget as staging', () => {
		expect(limiters.production?.simple).toEqual(limiters.staging?.simple)
	})

	it('should keep staging and production counts in separate namespaces', () => {
		expect(limiters.production?.namespace_id).not.toBe(limiters.staging?.namespace_id)
	})

	it('should use the period the 429 sends as Retry-After', () => {
		expect(limiters.production?.simple.period).toBe(REGISTRATION_RATE_LIMIT_PERIOD_SECONDS)
	})
})
