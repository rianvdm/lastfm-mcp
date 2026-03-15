// ABOUTME: Tests for the OAuth entry point (src/index-oauth.ts).
// ABOUTME: Covers unauthenticated 401 routing, session-based auth, OAuth routing, and regression for copy-paste URL bug.
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import worker from '../src/index-oauth'

describe('Last.fm MCP Server (OAuth Entry Point)', () => {
	describe('/mcp endpoint - unauthenticated access', () => {
		const initBody = JSON.stringify({
			jsonrpc: '2.0',
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: { name: 'TestClient', version: '1.0.0' },
			},
			id: 1,
		})
		const mcpHeaders = {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
		}

		it('should return 401 when no auth is provided', async () => {
			const request = new Request('http://example.com/mcp', {
				method: 'POST',
				body: initBody,
				headers: mcpHeaders,
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(401)
		})

		it('should include WWW-Authenticate header pointing to OAuth metadata', async () => {
			const request = new Request('http://example.com/mcp', {
				method: 'POST',
				body: initBody,
				headers: mcpHeaders,
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(401)
			const wwwAuth = response.headers.get('WWW-Authenticate')
			expect(wwwAuth).not.toBeNull()
			expect(wwwAuth).toContain('Bearer')
			expect(wwwAuth).toContain('resource_metadata')
			expect(wwwAuth).toContain('/.well-known/oauth-protected-resource')
		})

		it('should return 401 when Mcp-Session-Id header has no matching KV session', async () => {
			// An unknown Mcp-Session-Id (not in KV) must fall through to OAuth → 401.
			// The old behavior returned 200 by routing all requests through handleUnauthenticatedMcp.
			const request = new Request('http://example.com/mcp', {
				method: 'POST',
				body: initBody,
				headers: { ...mcpHeaders, 'Mcp-Session-Id': 'unknown-session-not-in-kv' },
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(401)
			const wwwAuth = response.headers.get('WWW-Authenticate')
			expect(wwwAuth).toContain('Bearer')
		})

		it('should not include a /login?session_id= URL in the response body', async () => {
			const request = new Request('http://example.com/mcp', {
				method: 'POST',
				body: initBody,
				headers: mcpHeaders,
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			const body = await response.clone().text()
			expect(body).not.toContain('/login?session_id=')
		})
	})

	describe('/mcp endpoint - session-based auth', () => {
		it('should return 401 when session_id does not exist in KV', async () => {
			const initRequest = {
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'TestClient', version: '1.0.0' },
				},
				id: 1,
			}

			// Request with session_id that doesn't exist in KV
			const request = new Request('http://example.com/mcp?session_id=nonexistent-session', {
				method: 'POST',
				body: JSON.stringify(initRequest),
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
				},
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			// Should return 401 because session doesn't exist
			expect(response.status).toBe(401)
			const result = (await response.json()) as { error: string }
			expect(result.error).toBe('invalid_session')
		})

		it('should return 200 when session_id param has a valid KV session', async () => {
			const sessionId = 'test-session-id-param-valid'
			await env.MCP_SESSIONS.put(
				`session:${sessionId}`,
				JSON.stringify({
					userId: 'testuser',
					sessionKey: 'test-session-key',
					username: 'testuser',
					timestamp: Date.now(),
					expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
					sessionId,
				}),
			)

			const request = new Request(`http://example.com/mcp?session_id=${sessionId}`, {
				method: 'POST',
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'initialize',
					params: {
						protocolVersion: '2024-11-05',
						capabilities: {},
						clientInfo: { name: 'TestClient', version: '1.0.0' },
					},
					id: 1,
				}),
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
				},
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			expect(response.headers.get('Mcp-Session-Id')).toBe(sessionId)
		})
	})

	describe('/mcp endpoint - Mcp-Session-Id header routing', () => {
		const initBody = JSON.stringify({
			jsonrpc: '2.0',
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: { name: 'TestClient', version: '1.0.0' },
			},
			id: 1,
		})

		it('should use session-based auth when Mcp-Session-Id header has a valid KV session', async () => {
			const sessionId = 'test-mcp-header-valid-session'
			await env.MCP_SESSIONS.put(
				`session:${sessionId}`,
				JSON.stringify({
					userId: 'testuser',
					sessionKey: 'test-session-key',
					username: 'testuser',
					timestamp: Date.now(),
					expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
					sessionId,
				}),
			)

			const request = new Request('http://example.com/mcp', {
				method: 'POST',
				body: initBody,
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					'Mcp-Session-Id': sessionId,
				},
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			expect(response.headers.get('Mcp-Session-Id')).toBe(sessionId)
		})

		it('should expose Mcp-Session-Id in Access-Control-Expose-Headers for session-based responses', async () => {
			const sessionId = 'test-mcp-header-expose-session'
			await env.MCP_SESSIONS.put(
				`session:${sessionId}`,
				JSON.stringify({
					userId: 'testuser',
					sessionKey: 'test-session-key',
					username: 'testuser',
					timestamp: Date.now(),
					expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
					sessionId,
				}),
			)

			const request = new Request('http://example.com/mcp', {
				method: 'POST',
				body: initBody,
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					'Mcp-Session-Id': sessionId,
				},
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			expect(response.headers.get('Access-Control-Expose-Headers')).toContain('Mcp-Session-Id')
		})

		it('should return 401 when Mcp-Session-Id header session is expired', async () => {
			// handleSessionBasedMcp checks expiresAt and returns 401 with error: 'session_expired'
			const sessionId = 'test-mcp-header-expired-session'
			await env.MCP_SESSIONS.put(
				`session:${sessionId}`,
				JSON.stringify({
					userId: 'testuser',
					sessionKey: 'test-session-key',
					username: 'testuser',
					timestamp: Date.now() - 40 * 24 * 60 * 60 * 1000,
					expiresAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
					sessionId,
				}),
			)

			const request = new Request('http://example.com/mcp', {
				method: 'POST',
				body: initBody,
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					'Mcp-Session-Id': sessionId,
				},
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(401)
			const result = (await response.json()) as { error: string }
			expect(result.error).toBe('session_expired')
		})
	})

	describe('/mcp endpoint - OAuth auth', () => {
		it('should route to OAuth provider when Bearer token present', async () => {
			const initRequest = {
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'TestClient', version: '1.0.0' },
				},
				id: 1,
			}

			const request = new Request('http://example.com/mcp', {
				method: 'POST',
				body: JSON.stringify(initRequest),
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					Authorization: 'Bearer invalid-token',
				},
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			// Should return 401 from OAuth provider (invalid token)
			expect(response.status).toBe(401)
			const result = (await response.json()) as { error: string }
			expect(result.error).toBe('invalid_token')
		})

		it('should include WWW-Authenticate header for 401 responses', async () => {
			const initRequest = {
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'TestClient', version: '1.0.0' },
				},
				id: 1,
			}

			const request = new Request('http://example.com/mcp', {
				method: 'POST',
				body: JSON.stringify(initRequest),
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					Authorization: 'Bearer invalid-token',
				},
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(401)
			const wwwAuth = response.headers.get('WWW-Authenticate')
			expect(wwwAuth).toContain('Bearer')
			expect(wwwAuth).toContain('resource_metadata')
		})

		it('should not return a /login?session_id= URL in OAuth path tool responses', async () => {
			// Even with an invalid bearer token (401 expected),
			// the OAuth path must never fall back to session-based auth messages.
			const request = new Request('http://example.com/mcp', {
				method: 'POST',
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'tools/call',
					params: { name: 'get_recent_tracks', arguments: {} },
					id: 1,
				}),
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					Authorization: 'Bearer invalid-token',
				},
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			const body = await response.clone().text()
			expect(body).not.toContain('/login?session_id=')
		})
	})

	describe('regression: /mcp never returns copy-paste login URL', () => {
		it('unauthenticated POST /mcp should return 401, not 200 with login URL', async () => {
			const req = new Request('https://lastfm-mcp.com/mcp', { method: 'POST' })
			const ctx = createExecutionContext()
			const res = await worker.fetch(req, env, ctx)
			await waitOnExecutionContext(ctx)
			expect(res.status).toBe(401)
			const body = await res.text()
			expect(body).not.toContain('/login?session_id=')
		})

		it('unauthenticated POST /mcp should have WWW-Authenticate, not login URL in body', async () => {
			const req = new Request('https://lastfm-mcp.com/mcp', { method: 'POST' })
			const ctx = createExecutionContext()
			const res = await worker.fetch(req, env, ctx)
			await waitOnExecutionContext(ctx)
			expect(res.headers.get('WWW-Authenticate')).toBeTruthy()
			const body = await res.text()
			expect(body).not.toContain('/login?session_id=')
		})
	})

	describe('static endpoints', () => {
		it('should return marketing page for GET /', async () => {
			const request = new Request('http://example.com/')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			expect(response.headers.get('content-type')).toBe('text/html')

			const html = await response.text()
			expect(html).toContain('Last.fm MCP Server')
		})

		it('should return health check for GET /health', async () => {
			const request = new Request('http://example.com/health')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const result = (await response.json()) as { status: string; service: string }
			expect(result.status).toBe('ok')
			expect(result.service).toBe('lastfm-mcp')
		})

		it('should return MCP discovery for GET /.well-known/mcp.json', async () => {
			const request = new Request('http://example.com/.well-known/mcp.json')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const result = (await response.json()) as {
				serverInfo: { name: string }
				transport: { endpoint: string }
			}
			expect(result.serverInfo.name).toBe('lastfm-mcp')
			expect(result.transport.endpoint).toBe('/mcp')
		})

		it('should handle CORS preflight requests', async () => {
			const request = new Request('http://example.com/mcp', {
				method: 'OPTIONS',
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
			expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
		})
	})
})
