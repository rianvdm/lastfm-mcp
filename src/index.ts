/**
 * Discogs MCP Server - Cloudflare Worker
 * Implements Model Context Protocol for Discogs collection access
 */

import { parseMessage, createError, serializeResponse } from './protocol/parser'
import { handleMethod, verifyAuthentication } from './protocol/handlers'
import { ErrorCode, JSONRPCError } from './types/jsonrpc'
import { createSSEResponse, getConnection } from './transport/sse'
import { DiscogsAuth } from './auth/discogs'
import { createSessionToken } from './auth/jwt'
import { KVLogger } from './utils/kvLogger'
import { RateLimiter } from './utils/rateLimit'
import type { Env } from './types/env'
import type { ExecutionContext } from '@cloudflare/workers-types'

// These types are available globally in Workers runtime
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="webworker" />

// Store for temporary OAuth tokens (in production, use KV storage)
const oauthTokenStore = new Map<string, string>()

export default {
	async fetch(
		request: Request,
		env: Env,
		_ctx: ExecutionContext
	): Promise<Response> {
		const url = new URL(request.url)

		// Handle different endpoints
		switch (url.pathname) {
			case '/':
				// Main MCP endpoint - accepts JSON-RPC messages
				if (request.method !== 'POST') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleMCPRequest(request, env)

			case '/sse':
				// SSE endpoint for bidirectional communication
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleSSEConnection()

			case '/login':
				// OAuth login - redirect to Discogs
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleLogin(env)

			case '/callback':
				// OAuth callback - exchange tokens
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleCallback(request, env)

			default:
				return new Response('Not found', { status: 404 })
		}
	},
}

/**
 * Handle OAuth login request
 */
async function handleLogin(env: Env): Promise<Response> {
	try {
		// Debug: Log environment variables (without secrets)
		console.log('Environment check:', {
			hasConsumerKey: !!env.DISCOGS_CONSUMER_KEY,
			hasConsumerSecret: !!env.DISCOGS_CONSUMER_SECRET,
			consumerKeyLength: env.DISCOGS_CONSUMER_KEY?.length || 0,
			consumerSecretLength: env.DISCOGS_CONSUMER_SECRET?.length || 0
		})
		
		if (!env.DISCOGS_CONSUMER_KEY || !env.DISCOGS_CONSUMER_SECRET) {
			console.error('Missing Discogs OAuth credentials')
			return new Response('OAuth configuration error: Missing credentials', { status: 500 })
		}
		
		const auth = new DiscogsAuth(env.DISCOGS_CONSUMER_KEY, env.DISCOGS_CONSUMER_SECRET)
		
		// Get callback URL (in production, use proper domain)
		const callbackUrl = 'http://localhost:8787/callback'
		
		console.log('Requesting OAuth token from Discogs...')
		
		// Get request token
		const { oauth_token, oauth_token_secret } = await auth.getRequestToken(callbackUrl)
		
		console.log('Successfully received OAuth token:', { 
			tokenLength: oauth_token.length,
			secretLength: oauth_token_secret.length 
		})
		
		// Store token secret temporarily (in production, use KV storage)
		oauthTokenStore.set(oauth_token, oauth_token_secret)
		
		// Redirect to Discogs authorization page
		const authorizeUrl = auth.getAuthorizeUrl(oauth_token)
		console.log('Redirecting to:', authorizeUrl)
		
		return Response.redirect(authorizeUrl, 302)
	} catch (error) {
		console.error('OAuth login error:', error)
		
		// Provide more detailed error information
		let errorMessage = 'OAuth login failed'
		if (error instanceof Error) {
			errorMessage += `: ${error.message}`
		}
		
		return new Response(errorMessage, { status: 500 })
	}
}

/**
 * Handle OAuth callback
 */
async function handleCallback(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url)
		const oauthToken = url.searchParams.get('oauth_token')
		const oauthVerifier = url.searchParams.get('oauth_verifier')
		
		if (!oauthToken || !oauthVerifier) {
			return new Response('Missing OAuth parameters', { status: 400 })
		}
		
		// Retrieve token secret
		const oauthTokenSecret = oauthTokenStore.get(oauthToken)
		if (!oauthTokenSecret) {
			return new Response('Invalid OAuth token', { status: 400 })
		}
		
		// Clean up temporary storage
		oauthTokenStore.delete(oauthToken)
		
		// Exchange for access token
		const auth = new DiscogsAuth(env.DISCOGS_CONSUMER_KEY, env.DISCOGS_CONSUMER_SECRET)
		const { oauth_token: accessToken, oauth_token_secret: accessTokenSecret } = 
			await auth.getAccessToken(oauthToken, oauthTokenSecret, oauthVerifier)
		
		// Create JWT session token
		const sessionToken = await createSessionToken(
			{
				userId: accessToken, // Use access token as user ID for now
				accessToken,
				accessTokenSecret
			},
			env.JWT_SECRET,
			24 // expires in 24 hours
		)
		
		// Set secure HTTP-only cookie
		const cookieOptions = [
			'HttpOnly',
			'Secure',
			'SameSite=Strict',
			'Path=/',
			'Max-Age=86400' // 24 hours in seconds
		].join('; ')
		
		return new Response(
			`Authentication successful! You can now use the MCP server to access your Discogs collection.`,
			{ 
				status: 200,
				headers: { 
					'Content-Type': 'text/plain',
					'Set-Cookie': `session=${sessionToken}; ${cookieOptions}`
				}
			}
		)
	} catch (error) {
		console.error('OAuth callback error:', error)
		return new Response('OAuth callback failed', { status: 500 })
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
 * Handle MCP JSON-RPC request
 */
async function handleMCPRequest(request: Request, env?: Env): Promise<Response> {
	const startTime = Date.now()
	let userId = 'anonymous'
	let method = 'unknown'
	let params: unknown = null
	
	// Initialize utilities
	const logger = env?.MCP_LOGS ? new KVLogger(env.MCP_LOGS) : null
	const rateLimiter = env?.MCP_RL ? new RateLimiter(env.MCP_RL, {
		requestsPerMinute: 60,  // TODO: Make configurable via env vars
		requestsPerHour: 1000
	}) : null

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
					errorMessage: 'Empty request body'
				})
			}
			
			return new Response(serializeResponse(errorResponse), {
				headers: { 'Content-Type': 'application/json' },
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
					errorMessage: jsonrpcError.message || 'Parse error'
				})
			}
			
			return new Response(serializeResponse(errorResponse), {
				headers: { 'Content-Type': 'application/json' },
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
					rateLimitResult.errorMessage || 'Rate limit exceeded'
				)
				
				// Log the rate limit error
				if (logger) {
					const latency = Date.now() - startTime
					await logger.log(userId, method, params, {
						status: 'error',
						latency,
						errorCode: rateLimitResult.errorCode || -32000,
						errorMessage: rateLimitResult.errorMessage || 'Rate limit exceeded'
					})
				}
				
				return new Response(serializeResponse(errorResponse), {
					status: 429,
					headers: { 
						'Content-Type': 'application/json',
						'Retry-After': rateLimitResult.resetTime ? 
							Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString() : '60'
					},
				})
			}
		}

		// Handle the method
		const response = await handleMethod(jsonrpcRequest, request, env?.JWT_SECRET)

		// Calculate latency
		const latency = Date.now() - startTime

		// Log successful request
		if (logger) {
			await logger.log(userId, method, params, {
				status: 'success',
				latency
			})
		}

		// If no response (notification), return 204 No Content
		if (!response) {
			return new Response(null, { status: 204 })
		}

		// Return JSON-RPC response
		return new Response(serializeResponse(response), {
			headers: { 'Content-Type': 'application/json' },
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
				errorMessage: error instanceof Error ? error.message : 'Internal server error'
			})
		}
		
		return new Response(serializeResponse(errorResponse), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		})
	}
}
