/**
 * ABOUTME: Last.fm MCP Server with OAuth 2.0 support for Claude native integration
 * ABOUTME: Supports both legacy mcp-remote connections and native OAuth authentication
 */

import { parseMessage, createError, serializeResponse } from './protocol/parser'
import { handleMethod, verifyAuthentication } from './protocol/handlers'
import { createSessionToken } from './auth/jwt'
import { ErrorCode, JSONRPCError } from './types/jsonrpc'
import { createSSEResponse, getConnection, authenticateConnection } from './transport/sse'
import { handleOAuthSSEConnection, createOAuthMCPServer } from './transport/sse-oauth'
import { createOAuthProvider, validateBearerToken } from './oauth/provider'
import { handleLastFmOAuthLogin, handleLastFmOAuthCallback } from './oauth/lastfm-bridge'
import { LastfmAuth } from './auth/lastfm'
import { KVLogger } from './utils/kvLogger'
import { RateLimiter } from './utils/rateLimit'
import type { Env } from './types/env'
import type { ExecutionContext } from '@cloudflare/workers-types'

// Global MCP server instance for OAuth connections
let mcpServer: any = null

/**
 * Helper function to add CORS headers to responses
 */
function addCorsHeaders(headers: HeadersInit = {}): Headers {
	const corsHeaders = new Headers(headers)
	corsHeaders.set('Access-Control-Allow-Origin', '*')
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
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Connection-ID, Cookie',
					'Access-Control-Max-Age': '86400',
				},
			})
		}

		// Initialize OAuth provider
		const oauthProvider = createOAuthProvider(env)
		
		// Initialize MCP server for OAuth connections if not already done
		if (!mcpServer) {
			mcpServer = createOAuthMCPServer()
		}

		// Handle different endpoints
		switch (url.pathname) {
			// OAuth 2.0 endpoints
			case '/oauth/register':
				if (request.method === 'POST') {
					return await oauthProvider.handleClientRegistration(request, env)
				}
				return new Response('Method not allowed', { status: 405 })

			case '/oauth/authorize':
				if (request.method === 'GET') {
					return await oauthProvider.handleAuthorization(request, env)
				}
				return new Response('Method not allowed', { status: 405 })

			case '/oauth/token':
				if (request.method === 'POST') {
					return await oauthProvider.handleTokenExchange(request, env)
				}
				return new Response('Method not allowed', { status: 405 })

			// Last.fm OAuth bridge endpoints
			case '/oauth/lastfm/login':
				if (request.method === 'GET') {
					return await handleLastFmOAuthLogin(request, env)
				}
				return new Response('Method not allowed', { status: 405 })

			case '/oauth/lastfm/callback':
				if (request.method === 'GET') {
					return await handleLastFmOAuthCallback(request, env)
				}
				return new Response('Method not allowed', { status: 405 })

			case '/':
				// Main MCP endpoint - accepts JSON-RPC messages for POST, info for GET
				if (request.method === 'POST') {
					return handleMCPRequest(request, env)
				} else if (request.method === 'GET') {
					return new Response(
						JSON.stringify({
							name: 'Last.fm MCP Server with OAuth',
							version: '2.0.0',
							description: 'Model Context Protocol server for Last.fm with OAuth 2.0 authentication',
							authentication: {
								type: 'oauth2',
								authorization_url: `${url.origin}/oauth/authorize`,
								token_url: `${url.origin}/oauth/token`,
								registration_url: `${url.origin}/oauth/register`,
								scopes: ['lastfm:read', 'lastfm:profile', 'lastfm:recommendations']
							},
							endpoints: {
								'/': 'POST - MCP JSON-RPC endpoint',
								'/sse': 'GET - Server-Sent Events endpoint (OAuth Bearer token required)',
								'/oauth/register': 'POST - Dynamic Client Registration',
								'/oauth/authorize': 'GET - OAuth Authorization',
								'/oauth/token': 'POST - OAuth Token Exchange',
								'/health': 'GET - Health check',
								// Legacy endpoints for backward compatibility
								'/login': 'GET - Legacy Last.fm authentication',
								'/callback': 'GET - Legacy Last.fm callback',
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
				// SSE endpoint - OAuth Bearer token required for new connections
				if (request.method === 'GET') {
					const authHeader = request.headers.get('Authorization')
					
					// Check if this is an OAuth Bearer token request
					if (authHeader?.startsWith('Bearer ')) {
						return await handleOAuthSSEConnection(request, env, mcpServer)
					} else {
						// Legacy SSE connection for mcp-remote compatibility
						return handleLegacySSEConnection()
					}
				} else if (request.method === 'POST') {
					// Handle JSON-RPC requests on SSE endpoint for mcp-remote compatibility
					return handleMCPRequestWithSSEContext(request, env)
				} else {
					return new Response('Method not allowed', { status: 405 })
				}

			// Legacy endpoints for backward compatibility
			case '/login':
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleLegacyLogin(request, env)

			case '/callback':
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleLegacyCallback(request, env)

			case '/mcp-auth':
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleLegacyMCPAuth(request, env)

			case '/health':
				// Health check endpoint
				return new Response(
					JSON.stringify({
						status: 'ok',
						timestamp: new Date().toISOString(),
						version: '2.0.0',
						service: 'lastfm-mcp-oauth',
						authentication: 'oauth2',
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
 * Handle legacy SSE connection for mcp-remote compatibility
 */
function handleLegacySSEConnection(): Response {
	const { response, connectionId } = createSSEResponse()
	console.log(`Legacy SSE connection established: ${connectionId}`)
	return response as unknown as Response
}

/**
 * Handle MCP JSON-RPC request with OAuth or legacy authentication
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
				requestsPerMinute: 60,
				requestsPerHour: 1000,
			})
		: null

	try {
		// Parse request body
		const body = await request.text()

		if (!body) {
			const errorResponse = createError(null, ErrorCode.InvalidRequest, 'Empty request body')
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
			const jsonrpcError = error as JSONRPCError
			const errorResponse = createError(null, jsonrpcError.code || ErrorCode.ParseError, jsonrpcError.message || 'Parse error')
			return new Response(serializeResponse(errorResponse), {
				headers: addCorsHeaders({ 'Content-Type': 'application/json' }),
			})
		}

		// Check for OAuth Bearer token first
		const authHeader = request.headers.get('Authorization')
		if (authHeader?.startsWith('Bearer ') && env) {
			const userContext = await validateBearerToken(authHeader, env)
			if (userContext) {
				userId = userContext.userId
				
				// Create request with OAuth user context
				const oauthRequest = new Request(request.url, {
					method: request.method,
					headers: new Headers(request.headers),
					body: body
				})
				
				// Add user context headers
				oauthRequest.headers.set('X-User-ID', userContext.userId)
				oauthRequest.headers.set('X-Username', userContext.username)
				oauthRequest.headers.set('X-Scopes', userContext.scopes.join(','))
				if (userContext.lastfmSessionKey) {
					oauthRequest.headers.set('X-LastFM-Session', userContext.lastfmSessionKey)
				}
				
				// Handle with OAuth context
				const response = await handleMethod(jsonrpcRequest, oauthRequest, env.JWT_SECRET, env)
				
				// Log and return
				if (logger) {
					await logger.log(userId, method, params, {
						status: 'success',
						latency: Date.now() - startTime,
					})
				}
				
				return new Response(serializeResponse(response), {
					headers: addCorsHeaders({ 'Content-Type': 'application/json' }),
				})
			}
		}

		// Fallback to legacy JWT authentication
		if (env?.JWT_SECRET) {
			const session = await verifyAuthentication(request, env.JWT_SECRET)
			if (session) {
				userId = session.userId
			}
		}

		// Apply rate limiting
		if (rateLimiter && method !== 'initialize' && method !== 'initialized') {
			const rateLimitResult = await rateLimiter.checkLimit(userId)
			if (!rateLimitResult.allowed) {
				const errorResponse = createError(
					jsonrpcRequest.id || null,
					rateLimitResult.errorCode || -32000,
					rateLimitResult.errorMessage || 'Rate limit exceeded',
				)
				return new Response(serializeResponse(errorResponse), {
					status: 429,
					headers: addCorsHeaders({
						'Content-Type': 'application/json',
						'Retry-After': rateLimitResult.resetTime ? Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString() : '60',
					}),
				})
			}
		}

		// Handle the method with legacy authentication
		const response = await handleMethod(jsonrpcRequest, request, env?.JWT_SECRET, env)

		// Log successful request
		if (logger) {
			await logger.log(userId, method, params, {
				status: 'success',
				latency: Date.now() - startTime,
			})
		}

		if (!response) {
			return new Response(null, {
				status: 204,
				headers: addCorsHeaders(),
			})
		}

		return new Response(serializeResponse(response), {
			headers: addCorsHeaders({ 'Content-Type': 'application/json' }),
		})
	} catch (error) {
		console.error('Internal error:', error)
		const errorResponse = createError(null, ErrorCode.InternalError, 'Internal server error')

		if (logger) {
			await logger.log(userId, method, params, {
				status: 'error',
				latency: Date.now() - startTime,
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
 * Handle MCP JSON-RPC request with SSE context for mcp-remote compatibility
 */
async function handleMCPRequestWithSSEContext(request: Request, env?: Env): Promise<Response> {
	// Check if we already have a connection ID header
	let connectionId = request.headers.get('X-Connection-ID')

	// If no connection ID, create a consistent one for this client session
	if (!connectionId) {
		const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown'
		const userAgent = request.headers.get('User-Agent') || 'unknown'
		const timestamp = Math.floor(Date.now() / (1000 * 60 * 60 * 24)) // Daily rotation

		const encoder = new TextEncoder()
		const data = encoder.encode(`${clientIP}-${userAgent}-${timestamp}`)
		const hashBuffer = await crypto.subtle.digest('SHA-256', data)
		const hashArray = new Uint8Array(hashBuffer)
		const hashHex = Array.from(hashArray)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')

		connectionId = `mcp-remote-${hashHex.substring(0, 16)}`

		const newHeaders = new Headers(request.headers)
		newHeaders.set('X-Connection-ID', connectionId)

		const newRequest = new Request(request.url, {
			method: request.method,
			headers: newHeaders,
			body: request.body,
		})

		return handleMCPRequest(newRequest, env)
	}

	return handleMCPRequest(request, env)
}

// Legacy endpoint handlers for backward compatibility
async function handleLegacyLogin(request: Request, env: Env): Promise<Response> {
	try {
		if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
			return new Response('Authentication configuration error: Missing credentials', { status: 500 })
		}

		const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const url = new URL(request.url)
		const connectionId = url.searchParams.get('connection_id')
		const callbackUrl = `${url.protocol}//${url.host}/callback${connectionId ? `?connection_id=${connectionId}` : ''}`

		if (connectionId) {
			await env.MCP_SESSIONS.put(
				`auth-connection:${connectionId}`,
				JSON.stringify({
					connectionId: connectionId,
					timestamp: Date.now(),
				}),
				{ expirationTtl: 600 }
			)
		}

		const authorizeUrl = auth.getAuthUrl(callbackUrl)
		return Response.redirect(authorizeUrl, 302)
	} catch (error) {
		console.error('Legacy login error:', error)
		return new Response(`Legacy authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 })
	}
}

async function handleLegacyCallback(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url)
		const token = url.searchParams.get('token')
		const connectionId = url.searchParams.get('connection_id')

		if (!token) {
			return new Response('Missing authentication token from Last.fm', { status: 400 })
		}

		if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
			return new Response('Authentication configuration error: Missing credentials', { status: 500 })
		}

		const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const { sessionKey, username } = await auth.getSessionKey(token)

		const sessionToken = await createSessionToken(
			{
				userId: username,
				sessionKey,
				username,
			},
			env.JWT_SECRET,
			24
		)

		let finalConnectionId = connectionId || 'unknown'

		if (env.MCP_SESSIONS && finalConnectionId !== 'unknown') {
			const sessionData = {
				token: sessionToken,
				userId: username,
				sessionKey,
				username,
				timestamp: Date.now(),
				expiresAt: Date.now() + 24 * 60 * 60 * 1000,
				connectionId: finalConnectionId,
			}

			await env.MCP_SESSIONS.put(`session:${finalConnectionId}`, JSON.stringify(sessionData), {
				expirationTtl: 7 * 24 * 60 * 60,
			})

			if (!finalConnectionId.startsWith('mcp-remote-')) {
				authenticateConnection(finalConnectionId, username)
			}
		}

		const cookieOptions = [
			'HttpOnly',
			'Secure',
			'SameSite=Strict',
			'Path=/',
			'Max-Age=86400',
		].join('; ')

		const responseMessage = `Legacy authentication successful! Your Last.fm account (${username}) is now connected.`

		return new Response(responseMessage, {
			status: 200,
			headers: {
				'Content-Type': 'text/plain',
				'Set-Cookie': `session=${sessionToken}; ${cookieOptions}`,
			},
		})
	} catch (error) {
		console.error('Legacy callback error:', error)
		return new Response(`Legacy authentication callback failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 })
	}
}

async function handleLegacyMCPAuth(request: Request, env: Env): Promise<Response> {
	try {
		const session = await verifyAuthentication(request, env.JWT_SECRET)
		if (session) {
			const cookieHeader = request.headers.get('Cookie')
			if (cookieHeader) {
				const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
					const [key, value] = cookie.trim().split('=')
					if (key && value) {
						acc[key] = value
					}
					return acc
				}, {} as Record<string, string>)

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
						}
					)
				}
			}
		}

		const baseUrl = 'https://lastfm-mcp-prod.rian-db8.workers.dev'
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
			}
		)
	} catch (error) {
		console.error('Legacy MCP auth error:', error)
		return new Response(
			JSON.stringify({
				error: 'Authentication check failed',
			}),
			{
				status: 500,
				headers: addCorsHeaders({ 'Content-Type': 'application/json' }),
			}
		)
	}
}