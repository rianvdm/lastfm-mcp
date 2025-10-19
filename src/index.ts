/**
 * Last.fm MCP Server - Cloudflare Worker
 * Implements Model Context Protocol for Last.fm listening data access
 */

import { parseMessage, createError, serializeResponse } from './protocol/parser'
import { handleMethod, verifyAuthentication } from './protocol/handlers'
import { createSessionToken } from './auth/jwt'
import { ErrorCode, JSONRPCError } from './types/jsonrpc'
import { createSSEResponse, getConnection } from './transport/sse'
import { LastfmAuth } from './auth/lastfm'
import { KVLogger } from './utils/kvLogger'
import { RateLimiter } from './utils/rateLimit'
import { MARKETING_PAGE_HTML } from './marketing-page'
import type { Env } from './types/env'
import type { ExecutionContext } from '@cloudflare/workers-types'

// These types are available globally in Workers runtime
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="webworker" />

/**
 * Helper function to add CORS headers to responses
 */
function addCorsHeaders(headers: HeadersInit = {}): Headers {
	const corsHeaders = new Headers(headers)
	corsHeaders.set('Access-Control-Allow-Origin', '*')
	corsHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
	corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Connection-ID, Mcp-Session-Id, Cookie')
	corsHeaders.set('Access-Control-Expose-Headers', 'Mcp-Session-Id')
	return corsHeaders
}

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 200,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Connection-ID, Mcp-Session-Id, Cookie',
					'Access-Control-Expose-Headers': 'Mcp-Session-Id',
					'Access-Control-Max-Age': '86400',
				},
			})
		}

		// Handle different endpoints
		switch (url.pathname) {
			case '/':
				// Main endpoint - serves marketing page for GET, JSON-RPC for POST, SSE stream for MCP clients
				if (request.method === 'POST') {
					return handleMCPRequest(request, env)
				} else if (request.method === 'GET') {
					// Check if this is an MCP client requesting an SSE stream (Streamable HTTP transport)
					const acceptHeader = request.headers.get('Accept') || ''
					const sessionId = request.headers.get('Mcp-Session-Id')


				// Debug logging for GET requests
				console.log("GET / request:", {
					acceptHeader,
					sessionId,
					hasTextEventStream: acceptHeader.includes("text/event-stream"),
					hasSessionId: !!sessionId,
					allHeaders: Object.fromEntries(request.headers.entries()),
				})

					if (acceptHeader.includes('text/event-stream') && sessionId) {
						// MCP client opening SSE stream - return event stream that stays open
						const { readable, writable } = new TransformStream()
						const writer = writable.getWriter()
						const encoder = new TextEncoder()

						// Send initial comment to establish connection and keep stream open
						// Don't close the writer - stream must stay open for server-initiated messages
						writer.write(encoder.encode(': MCP SSE stream connected\n\n')).catch(() => {
							// Client disconnected
						})

						// Keep the stream alive with periodic heartbeats
						const heartbeatInterval = setInterval(() => {
							writer.write(encoder.encode(': heartbeat\n\n')).catch(() => {
								clearInterval(heartbeatInterval)
							})
						}, 30000) // Every 30 seconds

						return new Response(readable, {
							status: 200,
							headers: {
								'Content-Type': 'text/event-stream',
								'Cache-Control': 'no-cache',
								'Connection': 'keep-alive',
								'Access-Control-Allow-Origin': '*',
								'Mcp-Session-Id': sessionId,
							},
						})
					} else {
						// Regular browser request - return marketing page
						return new Response(MARKETING_PAGE_HTML, {
							status: 200,
							headers: {
								'Content-Type': 'text/html',
								'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
							},
						})
					}
				} else {
					return new Response('Method not allowed', { status: 405 })
				}

			case '/.well-known/mcp.json':
			case '/.well-known/mcp':
				// MCP server discovery endpoint for Claude Desktop Connectors
				if (request.method === 'GET') {
					const baseUrl = `${url.protocol}//${url.host}`
					return new Response(
						JSON.stringify({
							$schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
							version: '1.0',
							protocolVersion: '2025-06-18',
							serverInfo: {
								name: 'lastfm-mcp',
								title: 'Last.fm MCP Server',
								version: '1.0.0',
							},
							description: 'Model Context Protocol server for Last.fm listening data access. Provides tools for accessing Last.fm listening history, charts, recommendations, and music data.',
							iconUrl: 'https://www.last.fm/static/images/lastfm_avatar_twitter.52a5d69a85ac.png',
							documentationUrl: 'https://github.com/rianvdm/lastfm-mcp#readme',
							transport: {
								type: 'streamable-http',
								endpoint: '/',
							},
							capabilities: {
								tools: { listChanged: true },
								prompts: { listChanged: true },
								resources: { subscribe: false, listChanged: true },
							},
							authentication: {
								required: false,
								instructions: 'Some tools work without authentication. For personalized data (recent tracks, top artists, etc.), you will be prompted to authenticate with Last.fm when needed. The server uses Last.fm Web Authentication Flow with session management.',
							},
							instructions: `To use authenticated tools, you'll be provided with a URL to authenticate with Last.fm. Visit: ${baseUrl}/login?session_id=YOUR_SESSION_ID`,
							tools: ['dynamic'],
							prompts: ['dynamic'],
							resources: ['dynamic'],
						}),
						{
							status: 200,
							headers: {
								'Content-Type': 'application/json',
								'Access-Control-Allow-Origin': '*',
								'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
							},
						},
					)
				} else {
					return new Response('Method not allowed', { status: 405 })
				}

			case '/api':
				// API info endpoint for programmatic access
				if (request.method === 'GET') {
					return new Response(
						JSON.stringify({
							name: 'Last.fm MCP Server',
							version: '1.0.0',
							description: 'Model Context Protocol server for Last.fm listening data access',
							endpoints: {
								'/': 'GET - Marketing page, POST - MCP JSON-RPC endpoint',
								'/api': 'GET - API information',
								'/sse': 'GET - Server-Sent Events endpoint',
								'/login': 'GET - Last.fm authentication',
								'/callback': 'GET - Last.fm authentication callback',
								'/mcp-auth': 'GET - MCP authentication',
								'/health': 'GET - Health check',
							},
							mcp: {
								protocol: '2024-11-05',
								capabilities: ['tools', 'resources', 'prompts'],
							},
							lastfm: {
								api_version: '2.0',
								authentication: 'Web Authentication Flow',
							},
						}),
						{
							status: 200,
							headers: {
								'Content-Type': 'application/json',
								'Access-Control-Allow-Origin': '*',
							},
						},
					)
				} else {
					return new Response('Method not allowed', { status: 405 })
				}

			case '/mcp':
				// Streamable HTTP endpoint (POST only) - modern MCP transport
				if (request.method === 'POST') {
					return handleMCPRequest(request, env)
				} else {
					return new Response('Method not allowed. Streamable HTTP uses POST only.', { status: 405 })
				}

			case '/sse':
				// Legacy SSE endpoint (GET + POST) - deprecated but kept for backward compatibility
				if (request.method === 'GET') {
					// Legacy SSE transport
					return handleSSEConnection()
				} else if (request.method === 'POST') {
					// Handle JSON-RPC requests - works for mcp-remote compatibility
					return handleMCPRequestWithSSEContext(request, env)
				} else {
					return new Response('Method not allowed', { status: 405 })
				}

			case '/login':
				// Last.fm authentication - redirect to Last.fm
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleLogin(request, env)

			case '/callback':
				// Last.fm authentication callback - exchange tokens
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleCallback(request, env)

			case '/mcp-auth':
				// MCP authentication endpoint for programmatic access
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleMCPAuth(request, env)

			case '/health':
				// Health check endpoint
				return new Response(
					JSON.stringify({
						status: 'ok',
						timestamp: new Date().toISOString(),
						version: '1.0.0',
						service: 'lastfm-mcp',
					}),
					{
						status: 200,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					},
				)

			case '/sitemap.xml':
				// Sitemap for search engines
				return new Response(
					`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://lastfm-mcp.com/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://lastfm-mcp.com/api</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://lastfm-mcp.com/health</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>`,
					{
						status: 200,
						headers: {
							'Content-Type': 'application/xml',
							'Cache-Control': 'public, max-age=86400', // Cache for 1 day
						},
					},
				)

			case '/robots.txt':
				// Robots.txt for search engines
				return new Response(
					`User-agent: *
Allow: /
Allow: /api
Allow: /health
Disallow: /login
Disallow: /callback
Disallow: /mcp-auth
Disallow: /sse

Sitemap: https://lastfm-mcp.com/sitemap.xml`,
					{
						status: 200,
						headers: {
							'Content-Type': 'text/plain',
							'Cache-Control': 'public, max-age=86400', // Cache for 1 day
						},
					},
				)

			default:
				return new Response('Not found', { status: 404 })
		}
	},
}

/**
 * Handle Last.fm authentication login request
 */
async function handleLogin(request: Request, env: Env): Promise<Response> {
	try {
		// Debug: Log environment variables (without secrets)
		console.log('Environment check:', {
			hasApiKey: !!env.LASTFM_API_KEY,
			hasSharedSecret: !!env.LASTFM_SHARED_SECRET,
			apiKeyLength: env.LASTFM_API_KEY?.length || 0,
			sharedSecretLength: env.LASTFM_SHARED_SECRET?.length || 0,
		})

		if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
			console.error('Missing Last.fm API credentials')
			return new Response('Authentication configuration error: Missing credentials', { status: 500 })
		}

		const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)

		// Get callback URL based on the current request URL
		const url = new URL(request.url)
		const sessionId = url.searchParams.get('session_id')
		const callbackUrl = `${url.protocol}//${url.host}/callback${sessionId ? `?session_id=${sessionId}` : ''}`

		console.log('Redirecting to Last.fm authentication...', { sessionId })

		// Store session ID temporarily for callback
		if (sessionId) {
			await env.MCP_SESSIONS.put(
				`auth-pending:${sessionId}`,
				JSON.stringify({
					sessionId: sessionId,
					timestamp: Date.now(),
				}),
				{
					expirationTtl: 600, // 10 minutes - Authentication flow should complete within this time
				},
			)
		}

		// Redirect to Last.fm authorization page
		const authorizeUrl = auth.getAuthUrl(callbackUrl)
		console.log('Redirecting to:', authorizeUrl)

		return Response.redirect(authorizeUrl, 302)
	} catch (error) {
		console.error('Last.fm authentication error:', error)

		// Provide more detailed error information
		let errorMessage = 'Last.fm authentication failed'
		if (error instanceof Error) {
			errorMessage += `: ${error.message}`
		}

		return new Response(errorMessage, { status: 500 })
	}
}

/**
 * Handle Last.fm authentication callback
 */
async function handleCallback(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url)
		const token = url.searchParams.get('token')
		const sessionId = url.searchParams.get('session_id')

		if (!token) {
			return new Response('Missing authentication token from Last.fm', { status: 400 })
		}

		if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
			console.error('Missing Last.fm API credentials')
			return new Response('Authentication configuration error: Missing credentials', { status: 500 })
		}

		// Exchange token for session key
		const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const { sessionKey, username } = await auth.getSessionKey(token)

		// Create JWT session token
		const sessionToken = await createSessionToken(
			{
				userId: username,
				sessionKey,
				username,
			},
			env.JWT_SECRET,
			168, // expires in 7 days (168 hours)
		)

		// Store session in KV with session-specific key
		if (env.MCP_SESSIONS && sessionId) {
			try {
				const sessionData = {
					token: sessionToken,
					userId: username,
					sessionKey,
					username,
					timestamp: Date.now(),
					expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
					sessionId: sessionId,
				}

				// Debug log what we're storing
				console.log('Storing session data for session ID:', sessionId, {
					hasUserId: !!sessionData.userId,
					hasUsername: !!sessionData.username,
					hasSessionKey: !!sessionData.sessionKey,
					userId: sessionData.userId,
					username: sessionData.username,
					sessionKey: sessionData.sessionKey ? 'present' : 'missing',
				})

				// Store with session-specific key
				await env.MCP_SESSIONS.put(`session:${sessionId}`, JSON.stringify(sessionData), {
					expirationTtl: 7 * 24 * 60 * 60, // 7 days to match JWT expiration
				})

				console.log(`Last.fm session stored for session ${sessionId}, user: ${username}`)
			} catch (error) {
				console.warn('Could not save session to KV:', error)
			}
		}

		// Set secure HTTP-only cookie
		const cookieOptions = [
			'HttpOnly',
			'Secure',
			'SameSite=Lax',
			'Path=/',
			'Max-Age=604800', // 7 days in seconds (7 * 24 * 60 * 60)
		].join('; ')

		const responseMessage = sessionId
			? `Authentication successful! Your Last.fm account (${username}) is now connected to your MCP session.`
			: `Authentication successful! You can now use the MCP server to access your Last.fm listening data for ${username}.`

		return new Response(responseMessage, {
			status: 200,
			headers: {
				'Content-Type': 'text/plain',
				'Set-Cookie': `session=${sessionToken}; ${cookieOptions}`,
			},
		})
	} catch (error) {
		console.error('Last.fm authentication callback error:', error)
		return new Response(`Last.fm authentication callback failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
			status: 500,
		})
	}
}

/**
 * Handle SSE connection request
 */
function handleSSEConnection(): Response {
	const { response, connectionId } = createSSEResponse()
	console.log(`New SSE connection established: ${connectionId}`)
	return response as unknown as Response
}

/**
 * Handle MCP JSON-RPC request with SSE context for mcp-remote compatibility
 * This handles the case where mcp-remote makes POST requests to /sse without proper connection headers
 */
async function handleMCPRequestWithSSEContext(request: Request, env?: Env): Promise<Response> {
	// Check if we already have a connection ID header
	let connectionId = request.headers.get('X-Connection-ID')

	// If no connection ID, create a consistent one for this client session
	// This enables mcp-remote to work properly by providing stable connection-specific URLs
	if (!connectionId) {
		// Create a deterministic connection ID based on client characteristics
		// This ensures the same client gets the same connection ID across requests
		const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown'
		const userAgent = request.headers.get('User-Agent') || 'unknown'
		// Use weekly timestamp to ensure connection ID is stable for 7 days
		const timestamp = Math.floor(Date.now() / (1000 * 60 * 60 * 24 * 7)) // Changes every 7 days

		// Create a hash-based connection ID that's consistent for the same client/week
		const encoder = new TextEncoder()
		const data = encoder.encode(`${clientIP}-${userAgent}-${timestamp}`)
		const hashBuffer = await crypto.subtle.digest('SHA-256', data)
		const hashArray = new Uint8Array(hashBuffer)
		const hashHex = Array.from(hashArray)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')

		connectionId = `mcp-remote-${hashHex.substring(0, 16)}`

		// Create a new request with the connection ID header
		const newHeaders = new Headers(request.headers)
		newHeaders.set('X-Connection-ID', connectionId)

		const newRequest = new Request(request.url, {
			method: request.method,
			headers: newHeaders,
			body: request.body,
		})

		return handleMCPRequest(newRequest, env)
	}

	// If we have a connection ID, use the normal handler
	return handleMCPRequest(request, env)
}

/**
 * Handle MCP JSON-RPC request
 */
async function handleMCPRequest(request: Request, env?: Env): Promise<Response> {
	const startTime = Date.now()
	let userId = 'anonymous'
	let method = 'unknown'
	let params: unknown = null

	// Initialize utilities
	const logger = env?.MCP_LOGS ? new KVLogger(env.MCP_LOGS) : null
	const rateLimiter = env?.MCP_RL
		? new RateLimiter(env.MCP_RL, {
				requestsPerMinute: 60, // TODO: Make configurable via env vars
				requestsPerHour: 1000,
			})
		: null

	try {
		// Get session ID from Mcp-Session-Id header (primary) or X-Connection-ID (legacy)
		let sessionId = request.headers.get('Mcp-Session-Id')
		const legacyConnectionId = request.headers.get('X-Connection-ID')

		// Use connection ID as fallback for backwards compatibility
		if (!sessionId && legacyConnectionId) {
			sessionId = legacyConnectionId
			const connection = getConnection(legacyConnectionId)
			if (!connection) {
				console.warn(`Invalid connection ID: ${legacyConnectionId}`)
			}
		}

		// Parse request body
		const body = await request.text()

		// Handle empty body
		if (!body) {
			const errorResponse = createError(null, ErrorCode.InvalidRequest, 'Empty request body')

			// Log the error
			if (logger) {
				const latency = Date.now() - startTime
				await logger.log(userId, method, params, {
					status: 'error',
					latency,
					errorCode: ErrorCode.InvalidRequest,
					errorMessage: 'Empty request body',
				})
			}

			return new Response(serializeResponse(errorResponse), {
				headers: addCorsHeaders({ 'Content-Type': 'application/json' }),
			})
		}

		// Parse JSON-RPC message
		let jsonrpcRequest
		try {
			jsonrpcRequest = parseMessage(body)
			method = jsonrpcRequest.method
			params = jsonrpcRequest.params
		} catch (error) {
			// Parse error or invalid request
			const jsonrpcError = error as JSONRPCError
			const errorResponse = createError(null, jsonrpcError.code || ErrorCode.ParseError, jsonrpcError.message || 'Parse error')

			// Log the parse error
			if (logger) {
				const latency = Date.now() - startTime
				await logger.log(userId, method, params, {
					status: 'error',
					latency,
					errorCode: jsonrpcError.code || ErrorCode.ParseError,
					errorMessage: jsonrpcError.message || 'Parse error',
				})
			}

			return new Response(serializeResponse(errorResponse), {
				headers: addCorsHeaders({ 'Content-Type': 'application/json' }),
			})
		}

		// Get user ID for rate limiting and logging
		if (env?.JWT_SECRET) {
			const session = await verifyAuthentication(request, env.JWT_SECRET)
			if (session) {
				userId = session.userId
			}
		}

		// Apply rate limiting (skip for initialize method)
		if (rateLimiter && method !== 'initialize' && method !== 'initialized') {
			const rateLimitResult = await rateLimiter.checkLimit(userId)

			if (!rateLimitResult.allowed) {
				const errorResponse = createError(
					jsonrpcRequest.id || null,
					rateLimitResult.errorCode || -32000,
					rateLimitResult.errorMessage || 'Rate limit exceeded',
				)

				// Log the rate limit error
				if (logger) {
					const latency = Date.now() - startTime
					await logger.log(userId, method, params, {
						status: 'error',
						latency,
						errorCode: rateLimitResult.errorCode || -32000,
						errorMessage: rateLimitResult.errorMessage || 'Rate limit exceeded',
					})
				}

				return new Response(serializeResponse(errorResponse), {
					status: 429,
					headers: addCorsHeaders({
						'Content-Type': 'application/json',
						'Retry-After': rateLimitResult.resetTime ? Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString() : '60',
					}),
				})
			}
		}

		// Generate new session ID for initialize requests if none exists
		if (method === 'initialize' && !sessionId) {
			sessionId = crypto.randomUUID()
			console.log(`Generated new session ID for initialize: ${sessionId}`)
		}

		// Handle the method
		const response = await handleMethod(jsonrpcRequest, request, env?.JWT_SECRET, env, sessionId)

		// Calculate latency
		const latency = Date.now() - startTime

		// Log successful request
		if (logger) {
			await logger.log(userId, method, params, {
				status: 'success',
				latency,
			})
		}

		// Prepare response headers with session ID
		const responseHeaders: HeadersInit = { 'Content-Type': 'application/json' }
		if (sessionId) {
			responseHeaders['Mcp-Session-Id'] = sessionId
		}

		// If no response (notification), return 204 No Content
		if (!response) {
			return new Response(null, {
				status: 204,
				headers: addCorsHeaders(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
			})
		}

		// Return JSON-RPC response with session ID header
		return new Response(serializeResponse(response), {
			headers: addCorsHeaders(responseHeaders),
		})
	} catch (error) {
		// Internal server error
		console.error('Internal error:', error)
		const errorResponse = createError(null, ErrorCode.InternalError, 'Internal server error')

		// Log the internal error
		if (logger) {
			const latency = Date.now() - startTime
			await logger.log(userId, method, params, {
				status: 'error',
				latency,
				errorCode: ErrorCode.InternalError,
				errorMessage: error instanceof Error ? error.message : 'Internal server error',
			})
		}

		return new Response(serializeResponse(errorResponse), {
			status: 500,
			headers: addCorsHeaders({ 'Content-Type': 'application/json' }),
		})
	}
}

/**
 * Handle MCP authentication endpoint - returns latest session token
 */
async function handleMCPAuth(request: Request, env: Env): Promise<Response> {
	try {
		// Try to get the latest session from KV storage
		if (env.MCP_SESSIONS) {
			const sessionDataStr = await env.MCP_SESSIONS.get('latest-session')
			if (sessionDataStr) {
				const sessionData = JSON.parse(sessionDataStr)

				// Return the session token (KV TTL handles expiration)
				return new Response(
					JSON.stringify({
						session_token: sessionData.token,
						user_id: sessionData.userId,
						message: 'Use this token in the Cookie header as: session=' + sessionData.token,
						expires_at: new Date(sessionData.expiresAt).toISOString(),
					}),
					{
						headers: addCorsHeaders({ 'Content-Type': 'application/json' }),
					},
				)
			}
		}

		// Fallback: check if user has a valid session cookie
		const session = await verifyAuthentication(request, env.JWT_SECRET)
		if (session) {
			// Extract session token from cookie
			const cookieHeader = request.headers.get('Cookie')
			if (cookieHeader) {
				const cookies = cookieHeader.split(';').reduce(
					(acc, cookie) => {
						const [key, value] = cookie.trim().split('=')
						if (key && value) {
							acc[key] = value
						}
						return acc
					},
					{} as Record<string, string>,
				)

				const sessionToken = cookies.session
				if (sessionToken) {
					return new Response(
						JSON.stringify({
							session_token: sessionToken,
							user_id: session.userId,
							message: 'Use this token in the Cookie header as: session=' + sessionToken,
						}),
						{
							headers: addCorsHeaders({ 'Content-Type': 'application/json' }),
						},
					)
				}
			}
		}

		const baseUrl = 'https://lastfm-mcp-prod.rian-db8.workers.dev'

		// Check for connection ID to provide connection-specific login URL
		const connectionId = request.headers.get('X-Connection-ID')
		const loginUrl = connectionId ? `${baseUrl}/login?connection_id=${connectionId}` : `${baseUrl}/login`

		return new Response(
			JSON.stringify({
				error: 'Not authenticated',
				message: `Please visit ${loginUrl} to authenticate with Last.fm first`,
			}),
			{
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			},
		)
	} catch (error) {
		console.error('MCP auth error:', error)
		return new Response(
			JSON.stringify({
				error: 'Authentication check failed',
			}),
			{
				status: 500,
				headers: addCorsHeaders({ 'Content-Type': 'application/json' }),
			},
		)
	}
}
