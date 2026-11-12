import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.toml' },
			// Secrets aren't in wrangler.toml; without a CONSENT_SECRET of 32+ characters approvals aren't remembered
			miniflare: {
				bindings: { CONSENT_SECRET: 'test-consent-secret-at-least-32-characters-long' },
				// Rate-limit counts last a full period across the whole run and can't be reset between tests, so OAuth tests that
				// register clients get a budget they can't exhaust. test/oauth-register-rate-limit.test.ts swaps in the strict
				// limiter, which mirrors REGISTRATION_RATE_LIMITER in wrangler.toml.
				ratelimits: {
					REGISTRATION_RATE_LIMITER: { namespace_id: '9001', simple: { limit: 10000, period: 60 } },
					STRICT_REGISTRATION_RATE_LIMITER: { namespace_id: '9002', simple: { limit: 5, period: 60 } },
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
