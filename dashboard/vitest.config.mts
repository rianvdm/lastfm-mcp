import { fileURLToPath } from 'node:url'

import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Resolve paths from this file, so the config works from the repo root (`npm run test:dashboard`) or from dashboard/
const DASHBOARD_ROOT = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
	root: DASHBOARD_ROOT,
	plugins: [
		cloudflareTest({
			wrangler: { configPath: fileURLToPath(new URL('./wrangler.toml', import.meta.url)) },
		}),
	],
	test: {
		include: ['test/**/*.test.ts'],
	},
})
