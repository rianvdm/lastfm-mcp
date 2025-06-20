// ABOUTME: API handler for authenticated MCP requests with OAuth token validation
// ABOUTME: Processes MCP JSON-RPC calls and SSE connections with OAuth bearer tokens

import type { ExportedHandler } from '@cloudflare/workers-types'
import type { Env } from '../types/env'
import { parseMessage, createError, serializeResponse } from '../protocol/parser'
import { handleMethod } from '../protocol/handlers'
import { ErrorCode } from '../types/jsonrpc'
import { createSSEResponse } from '../transport/sse'
import { KVLogger } from '../utils/kvLogger'
import { RateLimiter } from '../utils/rateLimit'

/**
 * API handler for authenticated requests
 * This receives requests that have valid OAuth tokens and user context
 */
export const apiHandler: ExportedHandler<Env> = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		// Add CORS headers
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Connection-ID, Cookie',
		}

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 200,
				headers: corsHeaders,
			})
		}

		try {
			// The OAuth provider should have validated the token and added user context
			// We can access this through request headers or context
			let userContext = extractUserContext(request)
			
			// If we can't get context from headers, try to extract from the Authorization token
			if (!userContext && env.OAUTH_PROVIDER) {
				const authHeader = request.headers.get('Authorization')
				if (authHeader && authHeader.startsWith('Bearer ')) {
					const token = authHeader.substring(7)
					try {
						// We would need a way to validate and extract token info
						// For now, let's assume the OAuth provider has already validated it
						// and we need to find another way to get user context
						userContext = null // TODO: Implement token info extraction
					} catch (error) {
						console.error('Token validation error:', error)
					}
				}
			}

			switch (url.pathname) {
				case '/':
					// Main MCP endpoint
					if (request.method === 'POST') {
						return handleMCPRequest(request, env, userContext)
					} else if (request.method === 'GET') {
						return new Response(
							JSON.stringify({
								name: 'Last.fm MCP Server - Authenticated API',
								version: '1.0.0',
								authenticated: true,
								user: userContext?.username || 'unknown',
								endpoints: {
									'/': 'POST - MCP JSON-RPC endpoint',
									'/sse': 'GET - Server-Sent Events endpoint',
								},
							}),
							{
								status: 200,
								headers: {
									'Content-Type': 'application/json',
									...corsHeaders,
								},
							}
						)
					}
					break

				case '/sse':
					// SSE endpoint for real-time communication
					if (request.method === 'GET') {
						return handleSSEConnection(userContext)
					} else if (request.method === 'POST') {
						return handleMCPRequest(request, env, userContext)
					}
					break

				default:
					return new Response('Not found in API', { 
						status: 404,
						headers: corsHeaders,
					})
			}

			return new Response('Method not allowed', { 
				status: 405,
				headers: corsHeaders,
			})

		} catch (error) {
			console.error('API handler error:', error)
			return new Response(
				JSON.stringify({
					error: 'internal_error',
					description: 'An internal error occurred',
				}),
				{
					status: 500,
					headers: {
						'Content-Type': 'application/json',
						...corsHeaders,
					},
				}
			)
		}
	},
}

/**
 * Extract user context from OAuth-validated request
 * The OAuth provider should inject user context through some mechanism
 */
function extractUserContext(request: Request): { username: string; sessionKey: string } | null {
	// The OAuth provider might add context in different ways
	// Let's check for various possible locations
	
	// Check custom headers first
	const username = request.headers.get('X-OAuth-User-ID') || request.headers.get('X-User-ID')
	const sessionKey = request.headers.get('X-OAuth-Session-Key') || request.headers.get('X-Session-Key')
	
	if (username && sessionKey) {
		return { username, sessionKey }
	}

	// The OAuth provider might set user info in the request context
	// We'll need to access this through the env.OAUTH_PROVIDER or similar
	// For now, return null - we'll need to check how the provider actually passes this
	return null
}

/**
 * Extract user context from OAuth token props
 * This is called when the OAuth provider validates a token and we need to get the user context
 */
function extractUserContextFromProps(props: any): { username: string; sessionKey: string } | null {
	if (props && props.lastfmSessionKey && props.username) {
		return {
			username: props.username,
			sessionKey: props.lastfmSessionKey,
		}
	}
	return null
}

/**
 * Handle MCP JSON-RPC request with OAuth authentication
 */
async function handleMCPRequest(
	request: Request,
	env: Env,
	userContext: { username: string; sessionKey: string } | null
): Promise<Response> {
	const startTime = Date.now()
	let userId = userContext?.username || 'anonymous'
	let method = 'unknown'
	let params: unknown = null

	// Initialize utilities
	const logger = env.MCP_LOGS ? new KVLogger(env.MCP_LOGS) : null
	const rateLimiter = env.MCP_RL
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
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				},
			})
		}

		// Parse JSON-RPC message
		let jsonrpcRequest
		try {
			jsonrpcRequest = parseMessage(body)
			method = jsonrpcRequest.method
			params = jsonrpcRequest.params
		} catch (error: any) {
			const errorResponse = createError(
				null,
				error.code || ErrorCode.ParseError,
				error.message || 'Parse error'
			)
			return new Response(serializeResponse(errorResponse), {
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				},
			})
		}

		// Apply rate limiting (skip for initialize method)
		if (rateLimiter && method !== 'initialize' && method !== 'initialized') {
			const rateLimitResult = await rateLimiter.checkLimit(userId)

			if (!rateLimitResult.allowed) {
				const errorResponse = createError(
					jsonrpcRequest.id || null,
					rateLimitResult.errorCode || -32000,
					rateLimitResult.errorMessage || 'Rate limit exceeded'
				)

				return new Response(serializeResponse(errorResponse), {
					status: 429,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
						'Retry-After': rateLimitResult.resetTime
							? Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString()
							: '60',
					},
				})
			}
		}

		// Create a mock session for the handler (bridge OAuth to existing auth system)
		const mockRequest = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		})

		// Add session info as a cookie for compatibility with existing handlers
		if (userContext) {
			const existingCookies = mockRequest.headers.get('Cookie') || ''
			const sessionCookie = `lastfm_user=${userContext.username}; lastfm_session=${userContext.sessionKey}`
			const newCookies = existingCookies ? `${existingCookies}; ${sessionCookie}` : sessionCookie
			mockRequest.headers.set('Cookie', newCookies)
		}

		// Handle the method using existing MCP handlers
		const response = await handleMethod(jsonrpcRequest, mockRequest, env.JWT_SECRET, env)

		// Log successful request
		if (logger) {
			const latency = Date.now() - startTime
			await logger.log(userId, method, params, {
				status: 'success',
				latency,
			})
		}

		// Return response
		if (!response) {
			return new Response(null, {
				status: 204,
				headers: { 'Access-Control-Allow-Origin': '*' },
			})
		}

		return new Response(serializeResponse(response), {
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
			},
		})
	} catch (error) {
		console.error('MCP request error:', error)
		const errorResponse = createError(null, ErrorCode.InternalError, 'Internal server error')

		// Log error
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
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
			},
		})
	}
}

/**
 * Handle SSE connection for real-time communication
 */
function handleSSEConnection(userContext: { username: string; sessionKey: string } | null): Response {
	const { response, connectionId } = createSSEResponse()
	
	if (userContext) {
		console.log(`New authenticated SSE connection: ${connectionId} for user ${userContext.username}`)
	} else {
		console.log(`New SSE connection: ${connectionId} (no user context)`)
	}
	
	return response as unknown as Response
}