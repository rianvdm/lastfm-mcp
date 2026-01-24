/**
 * Tests for the OAuth entry point (src/index-oauth.ts)
 *
 * Tests unauthenticated MCP access, session-based auth, and OAuth routing.
 */
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import worker from '../src/index-oauth'

describe('Last.fm MCP Server (OAuth Entry Point)', () => {
	describe('/mcp endpoint - unauthenticated access', () => {
		it('should handle initialize request without authentication', async () => {
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
				},
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)

			// Should return a session ID for subsequent requests
			const sessionId = response.headers.get('Mcp-Session-Id')
			expect(sessionId).toBeTruthy()
			expect(sessionId).toMatch(/^[0-9a-f-]{36}$/) // UUID format
		})

		it('should preserve existing session ID from header', async () => {
			const existingSessionId = '12345678-1234-1234-1234-123456789012'
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
					'Mcp-Session-Id': existingSessionId,
				},
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			expect(response.headers.get('Mcp-Session-Id')).toBe(existingSessionId)
		})

		it('should expose Mcp-Session-Id in Access-Control-Expose-Headers', async () => {
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
				},
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			const exposeHeaders = response.headers.get('Access-Control-Expose-Headers')
			expect(exposeHeaders).toContain('Mcp-Session-Id')
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
