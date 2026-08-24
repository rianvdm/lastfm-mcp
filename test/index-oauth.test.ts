// ABOUTME: Tests for the OAuth entry point (src/index-oauth.ts).
// ABOUTME: Covers unauthenticated 401 routing, session-based auth, OAuth routing, and regression for copy-paste URL bug.
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
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
			expect(wwwAuth).toContain('Bearer resource_metadata="http://example.com/.well-known/oauth-protected-resource"')
		})

		it('should ignore a legacy Mcp-Session-Id header and fall through to OAuth', async () => {
			// MCP 2026-07-28 removed protocol sessions. A stale header from an old
			// manual-login client must not be honoured, so this is a plain 401.
			const request = new Request('http://example.com/mcp', {
				method: 'POST',
				body: initBody,
				headers: { ...mcpHeaders, 'Mcp-Session-Id': 'legacy-header-no-longer-routed' },
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(401)
			expect(response.headers.get('Mcp-Session-Id')).toBeNull()
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
			// No protocol session under 2026-07-28: the server must not mint or echo one.
			expect(response.headers.get('Mcp-Session-Id')).toBeNull()
		})

		it('should return 401 when the session_id session is expired', async () => {
			// handleSessionBasedMcp checks expiresAt and returns 401 with error: 'session_expired'
			const sessionId = 'test-session-param-expired'
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

			expect(response.status).toBe(401)
			const result = (await response.json()) as { error: string }
			expect(result.error).toBe('session_expired')
		})
	})

	describe('/mcp endpoint - browser Origin policy', () => {
		const sessionId = 'test-session-origin-policy'
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

		async function postWithOrigin(origin?: string): Promise<Response> {
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
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
			}
			if (origin) headers.Origin = origin
			const request = new Request(`https://lastfm-mcp.com/mcp?session_id=${sessionId}`, {
				method: 'POST',
				body: initBody,
				headers,
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)
			return response
		}

		it('should accept requests with no Origin (non-browser MCP clients)', async () => {
			expect((await postWithOrigin()).status).toBe(200)
		})

		it('should accept browser requests from the custom domain', async () => {
			expect((await postWithOrigin('https://lastfm-mcp.com')).status).toBe(200)
		})

		it('should reject browser requests from an unknown Origin', async () => {
			expect((await postWithOrigin('https://evil.example')).status).toBe(403)
		})

		it('should accept localhost Origins for local dev tooling such as the MCP inspector', async () => {
			expect((await postWithOrigin('http://localhost:6274')).status).toBe(200)
		})
	})

	describe('/mcp endpoint - protocol lanes through the session path', () => {
		interface WireRecord {
			httpMethod: string
			rpcMethod: string | null
			mcpMethodHeader: string | null
			versionHeader: string | null
		}

		/**
		 * Connect a real SDK v2 client to worker.fetch and record every request it
		 * makes, so assertions are on the actual wire shape rather than a hand-rolled one.
		 */
		async function connectRecordingClient(sessionId: string, versionMode: 'legacy' | { pin: string }) {
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

			const seen: WireRecord[] = []
			const transport = new StreamableHTTPClientTransport(new URL(`https://lastfm-mcp.com/mcp?session_id=${sessionId}`), {
				fetch: async (input, init) => {
					const request = new Request(input, init)
					const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { method?: string }) : {}
					seen.push({
						httpMethod: request.method,
						rpcMethod: body.method ?? null,
						mcpMethodHeader: request.headers.get('Mcp-Method'),
						versionHeader: request.headers.get('MCP-Protocol-Version'),
					})
					const ctx = createExecutionContext()
					const response = await worker.fetch(request, env, ctx)
					await waitOnExecutionContext(ctx)
					return response
				},
			})
			const client = new Client({ name: 'lane-test', version: '0.0.0' }, { versionNegotiation: { mode: versionMode } })
			await client.connect(transport)
			return { client, seen }
		}

		async function exerciseTools(client: Client) {
			const { tools } = await client.listTools()
			expect(tools.map((t) => t.name)).toContain('get_recent_tracks')

			const pong = await client.callTool({ name: 'ping', arguments: { message: 'lane check' } })
			expect(JSON.stringify(pong.content)).toContain('Pong! You said: lane check')
		}

		it('should serve a 2026-07-28 client on the stateless lane (server/discover, no initialize)', async () => {
			// Pinning makes the client fail loudly if the server cannot offer 2026-07-28,
			// so this test cannot pass by silently falling back to the legacy lane.
			const { client, seen } = await connectRecordingClient('test-session-modern-lane', { pin: '2026-07-28' })
			await exerciseTools(client)

			expect(seen[0]?.rpcMethod).toBe('server/discover')
			expect(seen.some((r) => r.rpcMethod === 'initialize')).toBe(false)
			const posts = seen.filter((r) => r.httpMethod === 'POST')
			expect(posts.every((r) => r.versionHeader === '2026-07-28')).toBe(true)
			expect(posts.every((r) => r.mcpMethodHeader === r.rpcMethod)).toBe(true)
			expect(seen.map((r) => r.rpcMethod)).toContain('tools/call')

			await client.close()
		})

		it('should still serve a legacy 2025 client through the compatibility fallback (initialize)', async () => {
			// Published Claude clients still negotiate the initialize-era protocol. The
			// handler's default `legacy: "stateless"` lane must keep serving them.
			const { client, seen } = await connectRecordingClient('test-session-legacy-lane', 'legacy')
			await exerciseTools(client)

			expect(seen[0]?.rpcMethod).toBe('initialize')
			expect(seen.some((r) => r.rpcMethod === 'server/discover')).toBe(false)
			expect(seen.map((r) => r.rpcMethod)).toContain('tools/call')

			await client.close()
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
			expect(wwwAuth).toContain('Bearer resource_metadata="http://example.com/.well-known/oauth-protected-resource"')
		})

		it.todo('should return 200 when valid bearer token provided — covered by oauth-roundtrip integration test')

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
				protocolVersion: string
				serverInfo: { name: string }
				transport: { endpoint: string }
			}
			expect(result.protocolVersion).toBe('2026-07-28')
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
