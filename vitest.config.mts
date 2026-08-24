import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.toml' },
		}),
	],
	resolve: {
		// Redirect 'ajv' imports to an ESM-compatible stub that avoids loading the
		// nested CJS ajv package inside @modelcontextprotocol/sdk. workerd cannot
		// execute that CJS module, which causes "Unexpected token ':'" errors.
		// The MCP SDK uses ajv only for JSON Schema validation; tools validation
		// still works via zod schemas, so the no-op stub is safe for tests.
		alias: {
			ajv: path.resolve(import.meta.dirname, 'test/stubs/ajv-stub.js'),
			'ajv-formats': path.resolve(import.meta.dirname, 'test/stubs/ajv-formats-stub.js'),
		},
	},
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
