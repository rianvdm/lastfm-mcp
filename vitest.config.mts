import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { unstable_readConfig } from 'wrangler'
import { defineConfig } from 'vitest/config'

const WRANGLER_CONFIG = './wrangler.toml'

/** The REGISTRATION_RATE_LIMITER binding as wrangler.toml declares it, per environment ('' is the default, staging). */
function registrationRateLimiter(env: '' | 'production') {
	const binding = unstable_readConfig({ config: WRANGLER_CONFIG, env: env || undefined }).ratelimits.find(
		(r) => r.name === 'REGISTRATION_RATE_LIMITER',
	)
	return binding ? { namespace_id: binding.namespace_id, simple: binding.simple } : null
}

const stagingRegistrationLimiter = registrationRateLimiter('')
const productionRegistrationLimiter = registrationRateLimiter('production')

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: WRANGLER_CONFIG },
			miniflare: {
				bindings: {
					// Secrets aren't in wrangler.toml; without a CONSENT_SECRET of 32+ characters approvals aren't remembered
					CONSENT_SECRET: 'test-consent-secret-at-least-32-characters-long',
					// Both environments' registration limiter config, so test/wrangler-config.test.ts can check them
					TEST_REGISTRATION_RATE_LIMITERS: JSON.stringify({
						staging: stagingRegistrationLimiter,
						production: productionRegistrationLimiter,
					}),
				},
				// Rate-limit counts last a full period across the whole run and can't be reset between tests, so OAuth tests that
				// register clients get a budget they can't exhaust. test/oauth-register-rate-limit.test.ts swaps in the strict
				// limiter, which uses the limit and period wrangler.toml declares.
				ratelimits: {
					REGISTRATION_RATE_LIMITER: { namespace_id: '9001', simple: { limit: 10000, period: 60 } },
					...(stagingRegistrationLimiter && {
						STRICT_REGISTRATION_RATE_LIMITER: { namespace_id: '9002', simple: stagingRegistrationLimiter.simple },
					}),
				},
			},
		}),
	],
	test: {
		exclude: [
			// Default vitest excludes
			'**/node_modules/**',
			'**/dist/**',
			// Exclude worktrees to prevent duplicate test discovery when running from repo root
			'**/.worktrees/**',
		],
	},
})
