import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.toml' },
			// Secrets aren't in wrangler.toml; the consent helpers reject a CONSENT_SECRET under 32 characters
			miniflare: { bindings: { CONSENT_SECRET: 'test-consent-secret-at-least-32-characters-long' } },
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
