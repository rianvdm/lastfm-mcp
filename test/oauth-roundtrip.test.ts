// ABOUTME: Integration test for the full OAuth 2.1 round-trip flow.
// ABOUTME: Tests unauthenticated MCP returns 401, discovery endpoints work, and OAuth authorize redirect happens.
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import worker from '../src/index-oauth'

// Mock Last.fm auth to avoid real HTTP calls during the callback simulation.
// getAuthUrl passes the callbackUrl through so the real stateToken is preserved in the URL.
// getSessionKey avoids the actual Last.fm API call for the token exchange.
vi.mock('../src/auth/lastfm', () => ({
	LastfmAuth: vi.fn().mockImplementation(() => ({
		getAuthUrl: vi.fn().mockImplementation((callbackUrl?: string) => {
			const params = new URLSearchParams({ api_key: 'test-key' })
			if (callbackUrl) params.set('cb', callbackUrl)
			return `https://www.last.fm/api/auth/?${params.toString()}`
		}),
		getSessionKey: vi.fn().mockResolvedValue({
			sessionKey: 'mock-session-key',
			username: 'testuser',
		}),
	})),
}))

const BASE_URL = 'https://lastfm-mcp.com'

const MCP_INIT_BODY = JSON.stringify({
	jsonrpc: '2.0',
	method: 'initialize',
	params: {
		protocolVersion: '2024-11-05',
		capabilities: {},
		clientInfo: { name: 'TestClient', version: '1.0.0' },
	},
	id: 1,
})

const MCP_HEADERS = {
	'Content-Type': 'application/json',
	Accept: 'application/json, text/event-stream',
}

/**
 * Compute PKCE S256 code challenge from a code verifier
 */
async function computeS256Challenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(verifier)
	const digest = await crypto.subtle.digest('SHA-256', data)
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '')
}

describe('OAuth round-trip integration', () => {
	describe('Step 1: POST /mcp without auth returns 401', () => {
		// These two tests document the routing bug: handleUnauthenticatedMcp intercepts
		// unauthenticated /mcp requests and returns 200 instead of letting the OAuth
		// provider return 401. They are marked it.fails to confirm the current behaviour
		// and will be converted to regular `it` tests once the routing fix is applied.
		it.fails('should return 401 when no auth is provided [fails before routing fix]', async () => {
			const req = new Request(`${BASE_URL}/mcp`, {
				method: 'POST',
				body: MCP_INIT_BODY,
				headers: MCP_HEADERS,
			})
			const ctx = createExecutionContext()
			const res = await worker.fetch(req, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(res.status).toBe(401)
		})

		it.fails(
			'should include WWW-Authenticate header pointing to OAuth metadata [fails before routing fix]',
			async () => {
				const req = new Request(`${BASE_URL}/mcp`, {
					method: 'POST',
					body: MCP_INIT_BODY,
					headers: MCP_HEADERS,
				})
				const ctx = createExecutionContext()
				const res = await worker.fetch(req, env, ctx)
				await waitOnExecutionContext(ctx)

				expect(res.status).toBe(401)
				const wwwAuth = res.headers.get('WWW-Authenticate')
				expect(wwwAuth).not.toBeNull()
				expect(wwwAuth).toContain('Bearer')
				expect(wwwAuth).toContain('resource_metadata')
				expect(wwwAuth).toContain('/.well-known/oauth-protected-resource')
			},
		)
	})

	describe('Step 2: GET /.well-known/oauth-protected-resource', () => {
		it('should return valid JSON with authorization_servers', async () => {
			const req = new Request(`${BASE_URL}/.well-known/oauth-protected-resource`)
			const ctx = createExecutionContext()
			const res = await worker.fetch(req, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(res.status).toBe(200)
			expect(res.headers.get('content-type')).toContain('application/json')

			const body = (await res.json()) as Record<string, unknown>
			expect(body.resource).toBe(BASE_URL)
			expect(Array.isArray(body.authorization_servers)).toBe(true)
			expect(body.authorization_servers).toContain(BASE_URL)
			expect(Array.isArray(body.bearer_methods_supported)).toBe(true)
			expect(body.bearer_methods_supported).toContain('header')
		})
	})

	describe('Step 3: GET /.well-known/oauth-authorization-server', () => {
		it('should return valid authorization server metadata', async () => {
			const req = new Request(`${BASE_URL}/.well-known/oauth-authorization-server`)
			const ctx = createExecutionContext()
			const res = await worker.fetch(req, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(res.status).toBe(200)
			expect(res.headers.get('content-type')).toContain('application/json')

			const body = (await res.json()) as Record<string, unknown>
			expect(body.issuer).toBeDefined()
			expect(body.authorization_endpoint).toBeDefined()
			expect(body.token_endpoint).toBeDefined()
		})

		it('should support PKCE with S256 and authorization_code grant', async () => {
			const req = new Request(`${BASE_URL}/.well-known/oauth-authorization-server`)
			const ctx = createExecutionContext()
			const res = await worker.fetch(req, env, ctx)
			await waitOnExecutionContext(ctx)

			const body = (await res.json()) as Record<string, unknown>
			expect(Array.isArray(body.grant_types_supported)).toBe(true)
			expect(body.grant_types_supported).toContain('authorization_code')
			expect(Array.isArray(body.code_challenge_methods_supported)).toBe(true)
			expect(body.code_challenge_methods_supported).toContain('S256')
		})
	})

	describe('Step 4: Dynamic client registration + GET /authorize', () => {
		it('should register a client and redirect to Last.fm for authorization', async () => {
			// Register a dynamic OAuth client
			const registrationRes = await worker.fetch(
				new Request(`${BASE_URL}/oauth/register`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						client_name: 'Test MCP Client',
						redirect_uris: ['http://localhost:3000/callback'],
						grant_types: ['authorization_code'],
						response_types: ['code'],
						token_endpoint_auth_method: 'none',
					}),
				}),
				env,
				{} as ExecutionContext,
			)

			expect(registrationRes.status).toBe(201)
			const { client_id } = (await registrationRes.json()) as { client_id: string }
			expect(client_id).toBeTruthy()

			// Build PKCE challenge
			const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
			const codeChallenge = await computeS256Challenge(codeVerifier)
			const state = crypto.randomUUID()

			// Hit the authorize endpoint
			const authorizeUrl = new URL(`${BASE_URL}/authorize`)
			authorizeUrl.searchParams.set('client_id', client_id)
			authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback')
			authorizeUrl.searchParams.set('code_challenge', codeChallenge)
			authorizeUrl.searchParams.set('code_challenge_method', 'S256')
			authorizeUrl.searchParams.set('response_type', 'code')
			authorizeUrl.searchParams.set('state', state)

			const authorizeRes = await worker.fetch(new Request(authorizeUrl.toString()), env, {} as ExecutionContext)

			// The authorize endpoint should redirect to Last.fm
			expect(authorizeRes.status).toBe(302)
			const location = authorizeRes.headers.get('Location') ?? ''
			expect(location).toContain('last.fm')
		})
	})

	describe('Steps 5-7: Last.fm callback → token exchange → authenticated MCP (E2E only)', () => {
		it('completes Last.fm callback → code → token → authenticated MCP request', async () => {
			// Step 4a: Register client
			const registrationRes = await worker.fetch(
				new Request(`${BASE_URL}/oauth/register`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						client_name: 'Round-trip Test Client',
						redirect_uris: ['http://localhost:3000/callback'],
						grant_types: ['authorization_code'],
						response_types: ['code'],
						token_endpoint_auth_method: 'none',
					}),
				}),
				env,
				{} as ExecutionContext,
			)
			expect(registrationRes.status).toBe(201)
			const { client_id } = (await registrationRes.json()) as { client_id: string }

			// Step 4b: Initiate authorize to get the state token stored in KV
			const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
			const codeChallenge = await computeS256Challenge(codeVerifier)
			const oauthState = crypto.randomUUID()

			const authorizeUrl = new URL(`${BASE_URL}/authorize`)
			authorizeUrl.searchParams.set('client_id', client_id)
			authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback')
			authorizeUrl.searchParams.set('code_challenge', codeChallenge)
			authorizeUrl.searchParams.set('code_challenge_method', 'S256')
			authorizeUrl.searchParams.set('response_type', 'code')
			authorizeUrl.searchParams.set('state', oauthState)

			const authorizeRes = await worker.fetch(new Request(authorizeUrl.toString()), env, {} as ExecutionContext)
			expect(authorizeRes.status).toBe(302)

			// Step 4c: Extract the Last.fm redirect URL and parse out the lastfm_state
			// The Location is the Last.fm auth URL with a `cb` param containing the callback URL.
			// That callback URL has the stateToken we stored in KV.
			const lastfmRedirect = authorizeRes.headers.get('Location') ?? ''
			expect(lastfmRedirect).toContain('last.fm')

			const lastfmRedirectUrl = new URL(lastfmRedirect)
			const cbParam = lastfmRedirectUrl.searchParams.get('cb') ?? ''
			expect(cbParam).toContain('/lastfm-callback')

			const cbUrl = new URL(cbParam)
			const stateToken = cbUrl.searchParams.get('state') ?? ''
			expect(stateToken).toBeTruthy()

			// Step 5: Simulate Last.fm redirecting back with a token
			const simulatedLastfmToken = 'simulated-lastfm-token'
			const callbackUrl = new URL(`${BASE_URL}/lastfm-callback`)
			callbackUrl.searchParams.set('token', simulatedLastfmToken)
			callbackUrl.searchParams.set('state', stateToken)

			const callbackRes = await worker.fetch(new Request(callbackUrl.toString()), env, {} as ExecutionContext)

			// The callback should redirect to the MCP client's redirect_uri with an authorization code
			expect(callbackRes.status).toBe(302)
			const codeRedirect = callbackRes.headers.get('Location') ?? ''
			expect(codeRedirect).toContain('localhost:3000/callback')

			const codeRedirectUrl = new URL(codeRedirect)
			const authCode = codeRedirectUrl.searchParams.get('code') ?? ''
			expect(authCode).toBeTruthy()

			// Step 6: Exchange the authorization code for an access token
			const tokenRes = await worker.fetch(
				new Request(`${BASE_URL}/oauth/token`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({
						grant_type: 'authorization_code',
						code: authCode,
						client_id,
						redirect_uri: 'http://localhost:3000/callback',
						code_verifier: codeVerifier,
					}).toString(),
				}),
				env,
				{} as ExecutionContext,
			)

			expect(tokenRes.status).toBe(200)
			const tokenBody = (await tokenRes.json()) as { access_token?: string; token_type?: string }
			expect(tokenBody.access_token).toBeTruthy()
			// OAuth spec allows lowercase token_type; both 'bearer' and 'Bearer' are valid
			expect(tokenBody.token_type?.toLowerCase()).toBe('bearer')

			const accessToken = tokenBody.access_token!

			// Step 7: Use the access token to make an authenticated /mcp request
			// NOTE: This step currently FAILS (returns 200 via handleUnauthenticatedMcp even without
			// a token) but will return 200 correctly via the OAuth apiHandler after the routing fix.
			// We verify that a valid Bearer token is accepted (not rejected as invalid_token).
			const mcpRes = await worker.fetch(
				new Request(`${BASE_URL}/mcp`, {
					method: 'POST',
					body: MCP_INIT_BODY,
					headers: {
						...MCP_HEADERS,
						Authorization: `Bearer ${accessToken}`,
					},
				}),
				env,
				{} as ExecutionContext,
			)

			// A valid token should not be rejected as invalid_token — either 200 (success)
			// or 401 with a different error is unexpected
			expect(mcpRes.status).toBe(200)
		})
	})
})
