/**
 * Last.fm MCP Server - Cloudflare Worker
 * Implements Model Context Protocol for Last.fm listening data access
 */

import { parseMessage, createError, serializeResponse } from './protocol/parser'
import { handleMethod, verifyAuthentication } from './protocol/handlers'
import { createSessionToken } from './auth/jwt'
import { ErrorCode, JSONRPCError } from './types/jsonrpc'
import { createSSEResponse, getConnection, authenticateConnection } from './transport/sse'
import { LastfmAuth } from './auth/lastfm'
import { KVLogger } from './utils/kvLogger'
import { RateLimiter } from './utils/rateLimit'
import type { Env } from './types/env'
import type { ExecutionContext } from '@cloudflare/workers-types'
import {
	validateOAuthClient,
	validateRedirectUri,
	validateScopes,
	generateAuthorizationCode,
	storeAuthorizationCode,
	validateAuthorizationCode,
	storeAccessToken,
	registerOAuthClient,
} from './auth/oauth'
import { OAuthError, OAUTH_ERRORS } from './types/oauth'

// These types are available globally in Workers runtime
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="webworker" />

/**
 * Helper function to add CORS headers to responses
 */
function addCorsHeaders(headers: HeadersInit = {}, request?: Request): Headers {
	const corsHeaders = new Headers(headers)

	// Allow Claude domains and localhost for development
	const allowedOrigins = [
		'https://claude.ai',
		'https://app.claude.ai',
		'https://console.anthropic.com',
		'http://localhost:3000',
		'http://localhost:8080',
		'http://127.0.0.1:3000',
	]

	const origin = request?.headers.get('Origin')
	if (origin && allowedOrigins.includes(origin)) {
		corsHeaders.set('Access-Control-Allow-Origin', origin)
		corsHeaders.set('Access-Control-Allow-Credentials', 'true')
	} else {
		// Fallback for testing and other legitimate clients
		corsHeaders.set('Access-Control-Allow-Origin', '*')
	}

	corsHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
	corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Connection-ID, Cookie')
	return corsHeaders
}

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 200,
				headers: addCorsHeaders({ 'Access-Control-Max-Age': '86400' }, request),
			})
		}

		// Handle different endpoints
		switch (url.pathname) {
			case '/.well-known/integration-manifest':
			case '/manifest.json': {
				// Claude Integration Manifest (as per claude-native.md)
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}

				const baseUrl = `${url.protocol}//${url.host}`
				const manifest = {
					name: 'Last.fm Music Data',
					description: 'Access your Last.fm listening history through the Model Context Protocol',
					version: '1.0.0',
					homepage_url: 'https://github.com/your-username/lastfm-mcp',
					icon_url: 'https://www.last.fm/static/images/lastfm_avatar_twitter.png',
					// Simple MCP configuration without OAuth for now
					servers: [
						{
							type: 'remote',
							transport: 'sse',
							url: `${baseUrl}/sse`,
						},
					],
				}

				return new Response(JSON.stringify(manifest, null, 2), {
					headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
				})
			}

			case '/.well-known/oauth-authorization-server': {
				// OAuth 2.1 Authorization Server Metadata (RFC 8414)
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}

				const baseUrl = `${url.protocol}//${url.host}`
				const metadata = {
					issuer: baseUrl,
					authorization_endpoint: `${baseUrl}/oauth/authorize`,
					token_endpoint: `${baseUrl}/oauth/token`,
					registration_endpoint: `${baseUrl}/oauth/register`, // Dynamic Client Registration
					scopes_supported: ['read:listening_history', 'read:recommendations', 'read:profile', 'read:library'],
					response_types_supported: ['code'],
					grant_types_supported: ['authorization_code'],
					code_challenge_methods_supported: ['S256'], // PKCE
					token_endpoint_auth_methods_supported: ['none', 'client_secret_post'], // Support public clients (none first for Claude)
					revocation_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
					// Additional metadata that Claude might require
					subject_types_supported: ['public'],
					id_token_signing_alg_values_supported: ['RS256'],
					userinfo_endpoint: `${baseUrl}/userinfo`,
					jwks_uri: `${baseUrl}/.well-known/jwks.json`,
				}

				return new Response(JSON.stringify(metadata, null, 2), {
					headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
				})
			}

			case '/oauth/register':
				// Dynamic Client Registration (RFC 7591)
				if (request.method !== 'POST') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleDynamicClientRegistration(request, env)

			case '/':
				// Main MCP endpoint - accepts JSON-RPC messages for POST, info for GET
				if (request.method === 'POST') {
					return handleMCPRequest(request, env)
				} else if (request.method === 'GET') {
					return new Response(
						JSON.stringify({
							name: 'Last.fm MCP Server',
							version: '1.0.0',
							description: 'Model Context Protocol server for Last.fm listening data access',
							endpoints: {
								'/': 'POST - MCP JSON-RPC endpoint',
								'/sse': 'GET - Server-Sent Events endpoint',
								'/login': 'GET - Last.fm authentication',
								'/callback': 'GET - Last.fm authentication callback',
								'/mcp-auth': 'GET - MCP authentication',
								'/health': 'GET - Health check',
								'/.well-known/oauth-authorization-server': 'GET - OAuth 2.1 Authorization Server Metadata',
								'/oauth/authorize': 'GET - OAuth authorization endpoint',
								'/oauth/token': 'POST - OAuth token endpoint',
								'/oauth/register': 'POST - Dynamic Client Registration (RFC 7591)',
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

			case '/sse':
				// SSE endpoint for bidirectional communication
				if (request.method === 'GET') {
					return handleSSEConnection(request)
				} else if (request.method === 'POST') {
					// Check for Bearer token authentication on POST requests too
					const authHeader = request.headers.get('Authorization')
					if (!authHeader || !authHeader.startsWith('Bearer ')) {
						return new Response(
							JSON.stringify({
								error: 'unauthorized',
								message: 'Authentication required',
							}),
							{
								status: 401,
								headers: {
									'Content-Type': 'application/json',
									'WWW-Authenticate': 'Bearer realm="OAuth", error="invalid_token", error_description="Missing or invalid access token"',
									'Access-Control-Allow-Origin': '*',
									'Access-Control-Allow-Headers': 'Authorization, Content-Type',
								},
							},
						)
					}
					// Handle JSON-RPC requests on SSE endpoint for mcp-remote compatibility
					// For mcp-remote, we need to infer the connection ID from the request context
					// since it doesn't always include the X-Connection-ID header properly
					return handleMCPRequestWithSSEContext(request, env)
				} else {
					return new Response('Method not allowed', { status: 405 })
				}

			case '/oauth/authorize':
				// OAuth 2.0 authorization endpoint for Claude integration
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleOAuthAuthorize(request, env)

			case '/oauth/token':
				// OAuth 2.0 token endpoint for code-to-token exchange
				if (request.method !== 'POST') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleOAuthToken(request, env)

			case '/oauth/callback':
				// OAuth callback endpoint (Last.fm auth completion)
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleOAuthCallback(request, env)

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
		const connectionId = url.searchParams.get('connection_id')
		const callbackUrl = `${url.protocol}//${url.host}/callback${connectionId ? `?connection_id=${connectionId}` : ''}`

		console.log('Redirecting to Last.fm authentication...', { connectionId })

		// Store connection ID temporarily for callback
		if (connectionId) {
			await env.MCP_SESSIONS.put(
				`auth-connection:${connectionId}`,
				JSON.stringify({
					connectionId: connectionId,
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
		const connectionId = url.searchParams.get('connection_id')

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
			24, // expires in 24 hours
		)

		// Determine final connection ID
		let finalConnectionId = connectionId || 'unknown'

		// Try to retrieve stored connection ID if not provided
		if (!connectionId) {
			// Look for any stored connection for this session
			// This is a fallback for cases where connection ID isn't preserved
			const storedConnectionData = await env.MCP_SESSIONS.get(`auth-connection:last`)
			if (storedConnectionData) {
				const data = JSON.parse(storedConnectionData)
				finalConnectionId = data.connectionId || 'unknown'
			}
		}

		// Store session in KV with connection-specific key
		if (env.MCP_SESSIONS && finalConnectionId !== 'unknown') {
			try {
				const sessionData = {
					token: sessionToken,
					userId: username,
					sessionKey,
					username,
					timestamp: Date.now(),
					expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
					connectionId: finalConnectionId,
				}

				// Debug log what we're storing
				console.log('Storing session data for connection:', finalConnectionId, {
					hasUserId: !!sessionData.userId,
					hasUsername: !!sessionData.username,
					hasSessionKey: !!sessionData.sessionKey,
					userId: sessionData.userId,
					username: sessionData.username,
					sessionKey: sessionData.sessionKey ? 'present' : 'missing',
				})

				// Store with connection-specific key
				await env.MCP_SESSIONS.put(`session:${finalConnectionId}`, JSON.stringify(sessionData), {
					expirationTtl: 7 * 24 * 60 * 60, // 7 days to match JWT expiration
				})

				// Mark the SSE connection as authenticated (only for non-mcp-remote connections)
				// mcp-remote connections don't have SSE connections, they use HTTP POST
				if (!finalConnectionId.startsWith('mcp-remote-')) {
					authenticateConnection(finalConnectionId, username)
				}

				console.log(`Last.fm session stored for connection ${finalConnectionId}, user: ${username}`)
			} catch (error) {
				console.warn('Could not save session to KV:', error)
			}
		}

		// Set secure HTTP-only cookie
		const cookieOptions = [
			'HttpOnly',
			'Secure',
			'SameSite=Strict',
			'Path=/',
			'Max-Age=86400', // 24 hours in seconds
		].join('; ')

		const responseMessage =
			finalConnectionId !== 'unknown'
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
function handleSSEConnection(request?: Request): Response {
	// Check for Bearer token authentication
	const authHeader = request?.headers.get('Authorization')
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		// Return 401 with OAuth challenge like other MCP integrations
		return new Response(
			JSON.stringify({
				error: 'unauthorized',
				message: 'Authentication required',
			}),
			{
				status: 401,
				headers: {
					'Content-Type': 'application/json',
					'WWW-Authenticate': 'Bearer realm="OAuth", error="invalid_token", error_description="Missing or invalid access token"',
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Headers': 'Authorization, Content-Type',
				},
			},
		)
	}

	// If authenticated, create SSE connection
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
		// Use daily timestamp to ensure connection ID is stable for 24 hours
		const timestamp = Math.floor(Date.now() / (1000 * 60 * 60 * 24)) // Changes every 24 hours

		// Create a hash-based connection ID that's consistent for the same client/day
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
		// Check for connection ID header (for SSE-connected clients)
		const connectionId = request.headers.get('X-Connection-ID')
		if (connectionId) {
			const connection = getConnection(connectionId)
			if (!connection) {
				console.warn(`Invalid connection ID: ${connectionId}`)
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
				headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
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
				headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
			})
		}

		// Get user ID for rate limiting and logging
		if (env?.JWT_SECRET) {
			const session = await verifyAuthentication(request, env.JWT_SECRET, env)
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
					headers: addCorsHeaders(
						{
							'Content-Type': 'application/json',
							'Retry-After': rateLimitResult.resetTime ? Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString() : '60',
						},
						request,
					),
				})
			}
		}

		// Handle the method
		const response = await handleMethod(jsonrpcRequest, request, env?.JWT_SECRET, env)

		// Calculate latency
		const latency = Date.now() - startTime

		// Log successful request
		if (logger) {
			await logger.log(userId, method, params, {
				status: 'success',
				latency,
			})
		}

		// If no response (notification), return 204 No Content
		if (!response) {
			return new Response(null, {
				status: 204,
				headers: addCorsHeaders({}, request),
			})
		}

		// Return JSON-RPC response
		return new Response(serializeResponse(response), {
			headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
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
			headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
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
						headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
					},
				)
			}
		}

		// Fallback: check if user has a valid session cookie
		const session = await verifyAuthentication(request, env.JWT_SECRET, env)
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
							headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
						},
					)
				}
			}
		}

		const url = new URL(request.url)
		const baseUrl = `${url.protocol}//${url.host}`

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
				headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
			},
		)
	}
}

/**
 * Handle OAuth 2.0 authorization endpoint for Claude integration
 */
async function handleOAuthAuthorize(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url)
		const clientId = url.searchParams.get('client_id')
		const redirectUri = url.searchParams.get('redirect_uri')
		const responseType = url.searchParams.get('response_type')
		const scope = url.searchParams.get('scope')
		const state = url.searchParams.get('state')

		// Validate required parameters
		if (!clientId) {
			throw new OAuthError(OAUTH_ERRORS.INVALID_REQUEST, 'Missing client_id parameter')
		}
		if (!redirectUri) {
			throw new OAuthError(OAUTH_ERRORS.INVALID_REQUEST, 'Missing redirect_uri parameter')
		}
		if (responseType !== 'code') {
			throw new OAuthError(OAUTH_ERRORS.UNSUPPORTED_GRANT_TYPE, 'Only response_type=code is supported')
		}

		// Validate OAuth client
		const client = await validateOAuthClient(env, clientId)
		validateRedirectUri(client, redirectUri)
		const validScopes = validateScopes(client, scope || '')

		// Check if user already has a valid Last.fm session
		const sessionCookie = request.headers.get('Cookie')
		let existingSession = null
		if (sessionCookie) {
			// Try to extract and validate existing JWT session
			const sessionMatch = sessionCookie.match(/session=([^;]+)/)
			if (sessionMatch) {
				try {
					existingSession = await verifyAuthentication(request, env.JWT_SECRET, env)
				} catch {
					// Invalid session, continue with auth flow
				}
			}
		}

		if (existingSession) {
			// User already authenticated, generate authorization code
			const authCode = generateAuthorizationCode()
			await storeAuthorizationCode(
				env,
				authCode,
				clientId,
				existingSession.userId,
				existingSession.username,
				validScopes.join(' '),
				redirectUri,
			)

			// Redirect back to client with authorization code
			const callbackUrl = new URL(redirectUri)
			callbackUrl.searchParams.set('code', authCode)
			if (state) {
				callbackUrl.searchParams.set('state', state)
			}
			return Response.redirect(callbackUrl.toString())
		} else {
			// User needs to authenticate with Last.fm first
			// Store OAuth parameters for after Last.fm auth completes
			const oauthParams = new URLSearchParams({
				client_id: clientId,
				redirect_uri: redirectUri,
				response_type: responseType,
				...(scope && { scope }),
				...(state && { state }),
			})

			// Redirect to Last.fm auth with OAuth parameters preserved
			const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
			const callbackUrl = `${new URL(request.url).origin}/oauth/callback?${oauthParams}`
			const lastfmAuthUrl = auth.getAuthUrl(callbackUrl)
			return Response.redirect(lastfmAuthUrl)
		}
	} catch (error) {
		console.error('OAuth authorization error:', error)
		console.error('Request URL:', request.url)
		console.error('Request headers:', Object.fromEntries(request.headers.entries()))

		if (error instanceof OAuthError) {
			// If we have a redirect URI, redirect with error
			const redirectUri = request.url ? new URL(request.url).searchParams.get('redirect_uri') : null
			if (redirectUri) {
				try {
					const errorUrl = new URL(redirectUri)
					errorUrl.searchParams.set('error', error.error)
					if (error.description) {
						errorUrl.searchParams.set('error_description', error.description)
					}
					const state = request.url ? new URL(request.url).searchParams.get('state') : null
					if (state) {
						errorUrl.searchParams.set('state', state)
					}
					return Response.redirect(errorUrl.toString())
				} catch {
					// Invalid redirect URI, fall through to error response
				}
			}
			return new Response(error.message, { status: error.statusCode })
		}

		return new Response('Internal server error', { status: 500 })
	}
}

/**
 * Handle OAuth callback endpoint (Last.fm auth completion)
 */
async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url)
	const token = url.searchParams.get('token')
	const clientId = url.searchParams.get('client_id')
	const redirectUri = url.searchParams.get('redirect_uri')
	const scope = url.searchParams.get('scope')
	const state = url.searchParams.get('state')

	if (!token) {
		return new Response('Missing authentication token', { status: 400 })
	}

	if (!clientId || !redirectUri) {
		return new Response('Missing OAuth parameters', { status: 400 })
	}

	try {
		// Complete Last.fm authentication
		const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const sessionData = await auth.getSessionKey(token)

		// Validate OAuth client again
		const client = await validateOAuthClient(env, clientId)
		validateRedirectUri(client, redirectUri)
		const validScopes = validateScopes(client, scope || '')

		// Generate authorization code
		const authCode = generateAuthorizationCode()
		await storeAuthorizationCode(
			env,
			authCode,
			clientId,
			sessionData.name, // Last.fm username as user ID
			sessionData.name,
			validScopes.join(' '),
			redirectUri,
		)

		// Redirect back to client with authorization code
		const callbackUrl = new URL(redirectUri)
		callbackUrl.searchParams.set('code', authCode)
		if (state) {
			callbackUrl.searchParams.set('state', state)
		}
		return Response.redirect(callbackUrl.toString())
	} catch (error) {
		console.error('OAuth callback error:', error)

		// Redirect with error
		try {
			const errorUrl = new URL(redirectUri)
			errorUrl.searchParams.set('error', OAUTH_ERRORS.SERVER_ERROR)
			errorUrl.searchParams.set('error_description', 'Authentication failed')
			if (state) {
				errorUrl.searchParams.set('state', state)
			}
			return Response.redirect(errorUrl.toString())
		} catch {
			return new Response(`Authentication failed: ${error}`, { status: 400 })
		}
	}
}

/**
 * Handle OAuth 2.0 token endpoint for code-to-token exchange
 */
async function handleOAuthToken(request: Request, env: Env): Promise<Response> {
	try {
		// Parse form data
		const formData = await request.formData()
		const grantType = formData.get('grant_type') as string
		const code = formData.get('code') as string
		console.log('OAuth Token request:', Object.fromEntries(formData.entries()))
		const clientId = formData.get('client_id') as string
		const clientSecret = formData.get('client_secret') as string
		const redirectUri = formData.get('redirect_uri') as string

		// Validate grant type
		if (grantType !== 'authorization_code') {
			return new Response(
				JSON.stringify({
					error: 'unsupported_grant_type',
					error_description: 'Only authorization_code grant type is supported',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		// Validate required parameters
		if (!code) {
			return new Response(
				JSON.stringify({
					error: 'invalid_request',
					error_description: 'Missing authorization code',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		if (!clientId || !clientSecret) {
			return new Response(
				JSON.stringify({
					error: 'invalid_client',
					error_description: 'Missing client credentials',
				}),
				{
					status: 401,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		if (!redirectUri) {
			return new Response(
				JSON.stringify({
					error: 'invalid_request',
					error_description: 'Missing redirect_uri',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		// Validate client credentials
		// For public clients (Claude), client_secret might be missing
		await validateOAuthClient(env, clientId, clientSecret || undefined)

		// Validate and consume authorization code
		const authCode = await validateAuthorizationCode(env, code, clientId, redirectUri)

		// Generate access token (JWT)
		const accessToken = await createSessionToken(
			{
				userId: authCode.userId,
				sessionKey: `oauth-${authCode.clientId}`, // OAuth-specific session key
				username: authCode.username,
			},
			env.JWT_SECRET,
			168, // 7 days (same as existing JWT tokens)
		)

		// Store access token mapping
		await storeAccessToken(
			env,
			accessToken,
			clientId,
			authCode.userId,
			authCode.username,
			authCode.scope,
			7 * 24 * 60 * 60, // 7 days
		)

		// Return OAuth token response
		return new Response(
			JSON.stringify({
				access_token: accessToken,
				token_type: 'Bearer',
				expires_in: 7 * 24 * 60 * 60, // 7 days in seconds
				scope: authCode.scope,
			}),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-store',
					Pragma: 'no-cache',
				},
			},
		)
	} catch (error) {
		console.error('OAuth token error:', error)

		// Handle OAuth-specific errors
		if (error instanceof OAuthError) {
			return new Response(
				JSON.stringify({
					error: error.error,
					error_description: error.description || error.message,
				}),
				{
					status: error.statusCode,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		// Generic server error
		return new Response(
			JSON.stringify({
				error: 'server_error',
				error_description: 'Internal server error',
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			},
		)
	}
}

/**
 * Handle Dynamic Client Registration (RFC 7591)
 * Allows Claude Desktop to automatically register as an OAuth client
 */
async function handleDynamicClientRegistration(request: Request, env: Env): Promise<Response> {
	try {
		const body = (await request.json()) as Record<string, unknown>
		console.log('Dynamic Client Registration request:', body)

		// Validate registration request
		if (!body || typeof body !== 'object') {
			return new Response(
				JSON.stringify({
					error: 'invalid_client_metadata',
					error_description: 'Invalid registration request',
				}),
				{
					status: 400,
					headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
				},
			)
		}

		// Extract client metadata
		const clientName = body.client_name || 'Claude Desktop'
		const redirectUris = body.redirect_uris || ['https://claude.ai/oauth/callback', 'https://app.claude.ai/oauth/callback']

		// Handle scopes - convert from string to array format expected by registerOAuthClient
		let scopes: string[]
		if (typeof body.scope === 'string') {
			scopes = body.scope.split(' ').filter((s) => s.length > 0)
		} else {
			scopes = ['read:listening_history', 'read:profile']
		}

		// Special handling for Claude's 'claudeai' scope - map it to ALL our scopes
		if (scopes.length === 1 && scopes[0] === 'claudeai') {
			console.log('Mapping claudeai scope to all available scopes')
			scopes = ['read:listening_history', 'read:recommendations', 'read:profile', 'read:library']
		}

		// Validate that all requested scopes are supported
		const supportedScopes = ['read:listening_history', 'read:recommendations', 'read:profile', 'read:library']
		const invalidScopes = scopes.filter((scope) => !supportedScopes.includes(scope))
		if (invalidScopes.length > 0) {
			return new Response(
				JSON.stringify({
					error: 'invalid_scope',
					error_description: `Unsupported scopes: ${invalidScopes.join(', ')}`,
				}),
				{
					status: 400,
					headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
				},
			)
		}

		// Validate redirect URIs
		if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
			return new Response(
				JSON.stringify({
					error: 'invalid_redirect_uri',
					error_description: 'At least one redirect URI is required',
				}),
				{
					status: 400,
					headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
				},
			)
		}

		// Register the client using our existing OAuth utilities
		const client = await registerOAuthClient(env, clientName, redirectUris, scopes)
		console.log('Successfully registered OAuth client:', client.id)

		// Prepare Dynamic Client Registration response
		// For Claude (token_endpoint_auth_method: 'none'), don't return client_secret
		const isPublicClient = body.token_endpoint_auth_method === 'none'
		const response: any = {
			client_id: client.id,
			client_name: client.name,
			redirect_uris: client.redirectUris,
			scope: client.allowedScopes.join(' '),
			grant_types: ['authorization_code'],
			response_types: ['code'],
			token_endpoint_auth_method: isPublicClient ? 'none' : 'client_secret_post',
			client_id_issued_at: Math.floor(client.createdAt / 1000),
		}

		// Only include client_secret for confidential clients
		if (!isPublicClient) {
			response.client_secret = client.secret
		}

		return new Response(JSON.stringify(response), {
			status: 201, // Created
			headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
		})
	} catch (error) {
		console.error('Dynamic client registration error:', error)
		const errorMessage = error instanceof Error ? error.message : 'Unknown error'
		return new Response(
			JSON.stringify({
				error: 'server_error',
				error_description: `Failed to register client: ${errorMessage}`,
			}),
			{
				status: 500,
				headers: addCorsHeaders({ 'Content-Type': 'application/json' }, request),
			},
		)
	}
}
