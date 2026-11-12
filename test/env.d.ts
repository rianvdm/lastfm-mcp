// ABOUTME: Type declarations for the cloudflare:test env that Worker integration tests receive.
// ABOUTME: Extends the Worker's Env with the test-only bindings that vitest.config.mts defines.
import type { RateLimit } from '@cloudflare/workers-types'

import type { Env } from '../src/types/env'

declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {
		// Test-only bindings defined in vitest.config.mts: the registration budget wrangler.toml declares, and, as JSON,
		// both environments' REGISTRATION_RATE_LIMITER config and TOOL_EVENTS dataset name
		STRICT_REGISTRATION_RATE_LIMITER: RateLimit
		TEST_REGISTRATION_RATE_LIMITERS: string
		TEST_TOOL_EVENTS_DATASETS: string
	}
}
