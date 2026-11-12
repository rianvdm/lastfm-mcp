import type { RateLimit } from '@cloudflare/workers-types'

import type { Env } from '../src/types/env'

declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {
		// Test-only bindings defined in vitest.config.mts: the registration budget wrangler.toml declares, and the
		// REGISTRATION_RATE_LIMITER config of both environments as JSON
		STRICT_REGISTRATION_RATE_LIMITER: RateLimit
		TEST_REGISTRATION_RATE_LIMITERS: string
	}
}
