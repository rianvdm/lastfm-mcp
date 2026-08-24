import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.toml' },
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
