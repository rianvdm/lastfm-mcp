import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineWorkersConfig({
	resolve: {
		// Redirect 'ajv' imports to an ESM-compatible stub that avoids loading the
		// nested CJS ajv package inside @modelcontextprotocol/sdk. workerd cannot
		// execute that CJS module, which causes "Unexpected token ':'" errors.
		// The MCP SDK uses ajv only for JSON Schema validation; tools validation
		// still works via zod schemas, so the no-op stub is safe for tests.
		alias: {
			ajv: path.resolve(__dirname, 'test/stubs/ajv-stub.js'),
			'ajv-formats': path.resolve(__dirname, 'test/stubs/ajv-formats-stub.js'),
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
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.toml' },
			},
		},
	},
})
