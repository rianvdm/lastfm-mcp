// ABOUTME: Characterization tests for the full OAuth round trip for each RFC 8707 `resource` value a client may request.
// ABOUTME: Covers sign in, token exchange, MCP call, refresh and a second MCP call on the custom domain and workers.dev.
import { env } from 'cloudflare:test'
import { describe, it, expect, vi } from 'vitest'

import worker from '../src/index-oauth'
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

describe.each(['https://lastfm-mcp.com', 'https://lastfm-mcp.rian-db8.workers.dev'])('OAuth round trip on %s', (origin) => {
	it.each(RESOURCE_VARIANTS)(
		'should sign in, exchange, call a tool, refresh and call again when the client requests $label',
		async ({ resource: resourceFor }) => {
			const resource = resourceFor(origin)
			const clientId = await registerPublicClient(worker, env, origin, REDIRECT_URI)

			const { code, codeVerifier } = await signIn(worker, env, { origin, clientId, redirectUri: REDIRECT_URI, resource })

			const tokenRes = await exchangeCode(worker, env, { origin, clientId, redirectUri: REDIRECT_URI, code, codeVerifier, resource })
			expect(tokenRes.status).toBe(200)
			const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string }
			expect(tokens.access_token).toBeTruthy()
			expect(tokens.refresh_token).toBeTruthy()

			expect((await callMcp(worker, env, origin, tokens.access_token!)).status).toBe(200)

			const refreshRes = await refresh(worker, env, { origin, clientId, refreshToken: tokens.refresh_token!, resource })
			expect(refreshRes.status).toBe(200)
			const refreshed = (await refreshRes.json()) as { access_token?: string }
			expect(refreshed.access_token).toBeTruthy()
			expect(refreshed.access_token).not.toBe(tokens.access_token)

			expect((await callMcp(worker, env, origin, refreshed.access_token!)).status).toBe(200)
		},
	)
})
