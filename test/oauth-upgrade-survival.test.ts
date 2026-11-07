// ABOUTME: Upgrade survival tests that load real workers-oauth-provider 0.10.3 KV records and redeem their refresh tokens.
// ABOUTME: Unbound, origin and origin-with-slash grants must keep working; /mcp-bound grants must get invalid_grant so clients sign in again.
import { env } from 'cloudflare:test'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import worker from '../src/index-oauth'
import { OAUTH_0X_GRANTS, loadOAuth0xFixture } from './fixtures/oauth-0x-grants'
import { callMcp, refresh } from './helpers/oauth-flow'

// The source does `new LastfmAuth(...)`, so the mock implementation must be a class.
vi.mock('../src/auth/lastfm', () => ({
	LastfmAuth: class {
		getAuthUrl = vi.fn().mockImplementation((callbackUrl?: string) => {
			const params = new URLSearchParams({ api_key: 'test-key' })
			if (callbackUrl) params.set('cb', callbackUrl)
			return `https://www.last.fm/api/auth/?${params.toString()}`
		})
		getSessionKey = vi.fn().mockResolvedValue({
			sessionKey: 'mock-session-key',
			username: 'testuser',
		})
	},
}))

const SURVIVING_GRANTS = OAUTH_0X_GRANTS.filter(({ label }) => label !== 'mcp')
const MCP_BOUND_GRANT = OAUTH_0X_GRANTS.find(({ label }) => label === 'mcp')!

describe('0.10.3 grants after the OAuth provider upgrade', () => {
	beforeEach(async () => {
		await loadOAuth0xFixture(env.OAUTH_KV)
	})

	it.each(SURVIVING_GRANTS)(
		'should refresh a 0.10.3 grant bound to $label and call a tool',
		async ({ origin, clientId, refreshToken, requestedResource }) => {
			const refreshRes = await refresh(worker, env, { origin, clientId, refreshToken, resource: requestedResource })
			expect(refreshRes.status).toBe(200)
			const refreshed = (await refreshRes.json()) as { access_token?: string }
			expect(refreshed.access_token).toBeTruthy()

			expect((await callMcp(worker, env, origin, refreshed.access_token!)).status).toBe(200)
		},
	)

	it('should answer a refresh of a /mcp-bound 0.10.3 grant with invalid_grant so the client signs in again', async () => {
		const { origin, clientId, refreshToken, requestedResource } = MCP_BOUND_GRANT

		const refreshRes = await refresh(worker, env, { origin, clientId, refreshToken, resource: requestedResource })

		expect(refreshRes.status).toBe(400)
		const body = (await refreshRes.json()) as { error?: string }
		expect(body.error).not.toBe('invalid_target')
		expect(body.error).toBe('invalid_grant')
	})
})
