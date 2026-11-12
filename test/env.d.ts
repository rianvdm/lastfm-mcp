import type { RateLimit } from '@cloudflare/workers-types'

import type { Env } from '../src/types/env'

declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {
		// Test-only: the production registration budget, defined in vitest.config.mts
		STRICT_REGISTRATION_RATE_LIMITER: RateLimit
	}
}
