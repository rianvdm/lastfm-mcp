// ABOUTME: Tests for the OAuth entry point (src/index-oauth.ts).
// ABOUTME: Covers plain-http redirects, unauthenticated 401 routing, the retired session path, OAuth routing, Origin policy and protocol lanes.
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import worker from '../src/index-oauth'
import { signInForAccessToken } from './helpers/oauth-flow'

// Sign-ins in this file never reach Last.fm. The source does `new LastfmAuth(...)`, so the mock must be a class.
vi.mock('../src/auth/lastfm', () => ({
	LastfmAuth: class {
		getAuthUrl = vi.fn().mockImplementation((callbackUrl: string) => `https://www.last.fm/api/auth/?cb=${encodeURIComponent(callbackUrl)}`)
		getSessionKey = vi.fn().mockResolvedValue({ sessionKey: 'test-session-key', username: 'testuser' })
	},
}))

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
			const request = new Request('https://example.com/mcp', {
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
			const request = new Request('https://example.com/mcp', {
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
			expect(wwwAuth).toContain('Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"')
		})

		it('should ignore a legacy Mcp-Session-Id header and fall through to OAuth', async () => {
			// MCP 2026-07-28 removed protocol sessions. A stale header from an old
			// manual-login client must not be honoured, so this is a plain 401.
			const request = new Request('https://example.com/mcp', {
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
			const request = new Request('https://example.com/mcp', {
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

	describe('retired session-based login path', () => {
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

		async function get(path: string): Promise<Response> {
			const ctx = createExecutionContext()
			const response = await worker.fetch(new Request(`https://lastfm-mcp.com${path}`), env, ctx)
			await waitOnExecutionContext(ctx)
			return response
		}

		it('should ignore ?session_id= and send the client into OAuth, even when a stored session matches', async () => {
			// A record in the shape the retired /callback wrote. It must no longer authenticate anything.
			const sessionId = 'retired-session-id'
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

			const ctx = createExecutionContext()
			const response = await worker.fetch(
				new Request(`https://lastfm-mcp.com/mcp?session_id=${sessionId}`, {
					method: 'POST',
					body: initBody,
					headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
				}),
				env,
				ctx,
			)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(401)
			expect(response.headers.get('WWW-Authenticate')).toBe(
				'Bearer resource_metadata="https://lastfm-mcp.com/.well-known/oauth-protected-resource"',
			)
		})

		it('should no longer serve GET /login', async () => {
			const response = await get('/login')
			expect(response.status).toBe(404)
			expect(response.headers.get('Location')).toBeNull()
		})

		it('should no longer serve GET /callback', async () => {
			const response = await get('/callback?session_id=anything&token=anything')
			expect(response.status).toBe(404)
			expect(response.headers.get('Set-Cookie')).toBeNull()
		})

		it('should not point clients at /login from the discovery document or robots.txt', async () => {
			expect(await (await get('/.well-known/mcp.json')).text()).not.toContain('/login')
			expect(await (await get('/robots.txt')).text()).not.toMatch(/\/login|\/callback/)
		})
	})

	describe('/mcp endpoint - browser Origin policy', () => {
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
			const accessToken = await signInForAccessToken(worker, env, 'https://lastfm-mcp.com')
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				Authorization: `Bearer ${accessToken}`,
			}
			if (origin) headers.Origin = origin
			const request = new Request('https://lastfm-mcp.com/mcp', {
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

	describe('/mcp endpoint - protocol lanes', () => {
		interface WireRecord {
			httpMethod: string
			rpcMethod: string | null
			mcpMethodHeader: string | null
			versionHeader: string | null
		}

		/**
		 * Connect a real SDK v2 client to worker.fetch with an OAuth access token and record every request it
		 * makes, so assertions are on the actual wire shape rather than a hand-rolled one.
		 */
		async function connectRecordingClient(versionMode: 'legacy' | { pin: string }) {
			const accessToken = await signInForAccessToken(worker, env, 'https://lastfm-mcp.com')

			const seen: WireRecord[] = []
			const transport = new StreamableHTTPClientTransport(new URL('https://lastfm-mcp.com/mcp'), {
				requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
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
			const { client, seen } = await connectRecordingClient({ pin: '2026-07-28' })
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
			const { client, seen } = await connectRecordingClient('legacy')
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

			const request = new Request('https://example.com/mcp', {
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

			const request = new Request('https://example.com/mcp', {
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
			expect(wwwAuth).toContain('Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"')
		})

		it.todo('should return 200 when valid bearer token provided — covered by oauth-roundtrip integration test')

		it('should not return a /login?session_id= URL in OAuth path tool responses', async () => {
			// Even with an invalid bearer token (401 expected),
			// the OAuth path must never fall back to session-based auth messages.
			const request = new Request('https://example.com/mcp', {
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

	// 1.x refuses a plain-http protected resource on a non-loopback host, so these must never reach the provider.
	describe('plain-http requests', () => {
		let logSpy: ReturnType<typeof vi.spyOn>

		// Capture the redirect log line so it can be asserted and stays out of the test output
		beforeEach(() => {
			logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		})

		afterEach(() => {
			logSpy.mockRestore()
		})

		async function send(request: Request): Promise<Response> {
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)
			return response
		}

		it('should redirect GET http://lastfm-mcp.com/mcp to https with a 308', async () => {
			const res = await send(new Request('http://lastfm-mcp.com/mcp'))

			expect(res.status).toBe(308)
			expect(res.headers.get('Location')).toBe('https://lastfm-mcp.com/mcp')
		})

		it('should redirect POST http://lastfm-mcp.com/oauth/token with a 308 so the method and body are kept', async () => {
			const res = await send(
				new Request('http://lastfm-mcp.com/oauth/token', {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: 'grant_type=refresh_token&refresh_token=x&client_id=y',
				}),
			)

			expect(res.status).toBe(308)
			expect(res.headers.get('Location')).toBe('https://lastfm-mcp.com/oauth/token')
		})

		it('should keep the query string', async () => {
			const res = await send(new Request('http://lastfm-mcp.com/authorize?client_id=abc&state=xyz&resource=https%3A%2F%2Flastfm-mcp.com'))

			expect(res.status).toBe(308)
			expect(res.headers.get('Location')).toBe(
				'https://lastfm-mcp.com/authorize?client_id=abc&state=xyz&resource=https%3A%2F%2Flastfm-mcp.com',
			)
		})

		it('should log the method and pathname, without the query, when it redirects', async () => {
			await send(new Request('http://lastfm-mcp.com/authorize?client_id=abc&state=xyz&code=secret', { method: 'GET' }))

			expect(logSpy).toHaveBeenCalledWith('[HTTP] redirect to https', { method: 'GET', path: '/authorize' })
		})

		it('should not log the redirect line for an https request', async () => {
			await send(new Request('https://lastfm-mcp.com/health'))

			expect(logSpy).not.toHaveBeenCalledWith('[HTTP] redirect to https', expect.anything())
		})

		it('should redirect plain http on a workers.dev host', async () => {
			const res = await send(
				new Request('http://lastfm-mcp.rian-db8.workers.dev/', { headers: { Host: 'lastfm-mcp.rian-db8.workers.dev' } }),
			)

			expect(res.status).toBe(308)
			expect(res.headers.get('Location')).toBe('https://lastfm-mcp.rian-db8.workers.dev/')
		})

		it('should not redirect loopback http (wrangler dev)', async () => {
			const res = await send(new Request('http://localhost:8787/health'))

			expect(res.status).toBe(200)
		})

		it('should serve OAuth metadata over loopback http with the loopback origin as the resource', async () => {
			const res = await send(new Request('http://localhost:8787/.well-known/oauth-protected-resource'))

			expect(res.status).toBe(200)
			const body = (await res.json()) as { resource?: string }
			expect(body.resource).toBe('http://localhost:8787')
		})
	})

	describe('static endpoints', () => {
		it('should return marketing page for GET /', async () => {
			const request = new Request('https://example.com/')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			expect(response.headers.get('content-type')).toBe('text/html')

			const html = await response.text()
			expect(html).toContain('Last.fm MCP Server')
		})

		it('should return health check for GET /health', async () => {
			const request = new Request('https://example.com/health')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const result = (await response.json()) as { status: string; service: string }
			expect(result.status).toBe('ok')
			expect(result.service).toBe('lastfm-mcp')
		})

		it('should return MCP discovery for GET /.well-known/mcp.json', async () => {
			const request = new Request('https://example.com/.well-known/mcp.json')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const result = (await response.json()) as {
				protocolVersion: string
				serverInfo: { name: string }
				transport: { endpoint: string }
				authentication: { required: boolean }
			}
			expect(result.protocolVersion).toBe('2026-07-28')
			// Every /mcp request needs an OAuth access token
			expect(result.authentication.required).toBe(true)
			expect(result.serverInfo.name).toBe('lastfm-mcp')
			expect(result.transport.endpoint).toBe('/mcp')
		})

		it('should handle CORS preflight requests', async () => {
			const request = new Request('https://example.com/mcp', {
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
