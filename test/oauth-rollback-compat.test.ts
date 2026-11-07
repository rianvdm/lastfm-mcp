// ABOUTME: Rollback tests that load real workers-oauth-provider 1.2.4 KV records into 0.10.3 and use and refresh them.
// ABOUTME: Proves the rollback target serves 1.x grants for every resource spelling, and that fresh sign-ins still work end to end.
import { env } from 'cloudflare:test'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import worker from '../src/index-oauth'
import { OAUTH_1X_GRANTS, loadOAuth1xFixture } from './fixtures/oauth-1x-grants'
import { RESOURCE_VARIANTS, callMcp, exchangeCode, refresh, registerPublicClient, signIn } from './helpers/oauth-flow'

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

const REDIRECT_URI = 'http://localhost:3000/callback'

describe('1.x grants after rolling back to 0.10.3', () => {
	beforeEach(async () => {
		await loadOAuth1xFixture(env.OAUTH_KV)
	})

	it.each(OAUTH_1X_GRANTS)('should accept the access token 1.x issued to the $label client on MCP', async ({ origin, accessToken }) => {
		const mcpRes = await callMcp(worker, env, origin, accessToken)
		const body = await mcpRes.text()

		expect(mcpRes.status, body).toBe(200)
	})

	it.each(OAUTH_1X_GRANTS)(
		'should refresh a 1.x grant when the $label client sends its usual resource and call a tool',
		async ({ origin, clientId, refreshToken, requestedResource }) => {
			const refreshRes = await refresh(worker, env, { origin, clientId, refreshToken, resource: requestedResource })
			const body = await refreshRes.text()
			expect(refreshRes.status, body).toBe(200)
			const refreshed = JSON.parse(body) as { access_token?: string }
			expect(refreshed.access_token).toBeTruthy()

			const mcpRes = await callMcp(worker, env, origin, refreshed.access_token!)
			expect(mcpRes.status, await mcpRes.text()).toBe(200)
		},
	)
})

describe.each(['https://lastfm-mcp.com', 'https://lastfm-mcp.rian-db8.workers.dev'])(
	'Fresh sign-in on the rollback target on %s',
	(origin) => {
		it.each(RESOURCE_VARIANTS)(
			'should sign in, exchange, call a tool, refresh and call again when the client requests $label',
			async ({ resource: resourceFor }) => {
				const resource = resourceFor(origin)
				const clientId = await registerPublicClient(worker, env, origin, REDIRECT_URI)

				const { code, codeVerifier } = await signIn(worker, env, { origin, clientId, redirectUri: REDIRECT_URI, resource })

				const tokenRes = await exchangeCode(worker, env, { origin, clientId, redirectUri: REDIRECT_URI, code, codeVerifier, resource })
				const tokenBody = await tokenRes.text()
				expect(tokenRes.status, tokenBody).toBe(200)
				const tokens = JSON.parse(tokenBody) as { access_token?: string; refresh_token?: string }
				expect(tokens.access_token).toBeTruthy()
				expect(tokens.refresh_token).toBeTruthy()

				expect((await callMcp(worker, env, origin, tokens.access_token!)).status).toBe(200)

				const refreshRes = await refresh(worker, env, { origin, clientId, refreshToken: tokens.refresh_token!, resource })
				const refreshBody = await refreshRes.text()
				expect(refreshRes.status, refreshBody).toBe(200)
				const refreshed = JSON.parse(refreshBody) as { access_token?: string }
				expect(refreshed.access_token).toBeTruthy()
				expect(refreshed.access_token).not.toBe(tokens.access_token)

				expect((await callMcp(worker, env, origin, refreshed.access_token!)).status).toBe(200)
			},
		)
	},
)
