import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.toml' },
			// Secrets aren't in wrangler.toml; without a CONSENT_SECRET of 32+ characters approvals aren't remembered
			miniflare: { bindings: { CONSENT_SECRET: 'test-consent-secret-at-least-32-characters-long' } },
		}),
	],
	test: {
		// Each test starts with empty rate-limit buckets; see the file for why
		setupFiles: ['./test/setup/reset-rate-limits.ts'],
		exclude: [
			// Default vitest excludes
			'**/node_modules/**',
			'**/dist/**',
			// Exclude worktrees to prevent duplicate test discovery when running from repo root
			'**/.worktrees/**',
		],
	},
})
