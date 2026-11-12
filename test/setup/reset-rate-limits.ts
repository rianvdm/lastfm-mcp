// ABOUTME: Vitest setup file that empties the MCP_RL rate-limit namespace before every test.
// ABOUTME: KV persists across tests in a file, so without this the per-IP budgets leak between unrelated tests.
// `cloudflare:workers`, not `cloudflare:test`: importing `cloudflare:test` here loads the Worker entry before each
// test file's `vi.mock` calls run, so the Last.fm auth mock silently stops applying.
import { env } from 'cloudflare:workers'
import { beforeEach } from 'vitest'

beforeEach(async () => {
	let cursor: string | undefined
	do {
		const page = await env.MCP_RL.list({ cursor })
		await Promise.all(page.keys.map((key: { name: string }) => env.MCP_RL.delete(key.name)))
		cursor = page.list_complete ? undefined : page.cursor
	} while (cursor)
})
