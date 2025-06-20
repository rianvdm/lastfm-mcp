/**
 * ABOUTME: MCP request handler for OAuth-authenticated requests
 * ABOUTME: Handles MCP JSON-RPC requests with authenticated user context from OAuth tokens
 */

import { parseMessage, createError, serializeResponse } from '../protocol/parser'
import { handleMethod } from '../protocol/handlers'
import { ErrorCode, JSONRPCError } from '../types/jsonrpc'
import { KVLogger } from '../utils/kvLogger'
import { RateLimiter } from '../utils/rateLimit'
import type { Env } from '../types/env'

/**
 * Handle MCP requests with OAuth user context
 */
export async function handleMCPWithOAuthContext(
	request: Request,
	env: Env,
	user: any,
	grant: any
): Promise<Response> {
	const startTime = Date.now()
	const userId = user?.id || 'anonymous'
	let method = 'unknown'
	let params: unknown = null

	// Initialize utilities
	const logger = env?.MCP_LOGS ? new KVLogger(env.MCP_LOGS) : null
	const rateLimiter = env?.MCP_RL
		? new RateLimiter(env.MCP_RL, {
				requestsPerMinute: 120, // Higher limit for authenticated users
				requestsPerHour: 2000,
			})
		: null

	try {
		// Add CORS headers for all responses
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Authorization, Content-Type',
		}

		// Handle SSE connection setup
		if (request.method === 'GET') {
			return handleOAuthSSEConnection(request, env, user, grant)
		}

		// Handle JSON-RPC requests (POST)
		if (request.method !== 'POST') {
			return new Response('Method not allowed', { 
				status: 405,
				headers: corsHeaders
			})
		}

		// Parse request body
		const body = await request.text()

		if (!body) {
			const errorResponse = createError(null, ErrorCode.InvalidRequest, 'Empty request body')
			
			if (logger) {
				await logger.log(userId, method, params, {
					status: 'error',
					latency: Date.now() - startTime,
					errorCode: ErrorCode.InvalidRequest,
					errorMessage: 'Empty request body',
				})
			}

			return new Response(serializeResponse(errorResponse), {
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
			const errorResponse = createError(
				null, 
				jsonrpcError.code || ErrorCode.ParseError, 
				jsonrpcError.message || 'Parse error'
			)

			if (logger) {
				await logger.log(userId, method, params, {
					status: 'error',
					latency: Date.now() - startTime,
					errorCode: jsonrpcError.code || ErrorCode.ParseError,
					errorMessage: jsonrpcError.message || 'Parse error',
				})
			}

			return new Response(serializeResponse(errorResponse), {
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			})
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

				if (logger) {
					await logger.log(userId, method, params, {
						status: 'error',
						latency: Date.now() - startTime,
						errorCode: rateLimitResult.errorCode || -32000,
						errorMessage: rateLimitResult.errorMessage || 'Rate limit exceeded',
					})
				}

				return new Response(serializeResponse(errorResponse), {
					status: 429,
					headers: {
						...corsHeaders,
						'Content-Type': 'application/json',
						'Retry-After': rateLimitResult.resetTime 
							? Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString() 
							: '60',
					},
				})
			}
		}

		// Create request with OAuth user context
		const oauthRequest = new Request(request.url, {
			method: request.method,
			headers: new Headers(request.headers),
			body: body
		})

		// Add user context headers for the MCP handler
		oauthRequest.headers.set('X-User-ID', user?.id || 'unknown')
		oauthRequest.headers.set('X-Username', user?.username || 'unknown')
		oauthRequest.headers.set('X-Scopes', (grant?.scope || []).join(','))
		
		if (user?.lastfm_session_key) {
			oauthRequest.headers.set('X-LastFM-Session', user.lastfm_session_key)
		}

		// Handle the method with OAuth context
		const response = await handleMethod(jsonrpcRequest, oauthRequest, env.JWT_SECRET, env)

		// Calculate latency
		const latency = Date.now() - startTime

		// Log successful request
		if (logger) {
			await logger.log(userId, method, params, {
				status: 'success',
				latency,
				oauth_scopes: grant?.scope || [],
			})
		}

		// If no response (notification), return 204 No Content
		if (!response) {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			})
		}

		// Return JSON-RPC response
		return new Response(serializeResponse(response), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		})

	} catch (error) {
		// Internal server error
		console.error('OAuth MCP handler error:', error)
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
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Content-Type': 'application/json',
			},
		})
	}
}

/**
 * Handle OAuth-authenticated SSE connection
 */
async function handleOAuthSSEConnection(
	request: Request,
	env: Env,
	user: any,
	grant: any
): Promise<Response> {
	try {
		// Import SSE handling from the existing implementation
		const { createSSEResponse } = await import('../transport/sse')
		
		console.log('OAuth SSE connection established for user:', user?.username || user?.id)
		
		// Create SSE response with OAuth user context
		const { response, connectionId } = createSSEResponse()
		
		// Store OAuth user context for this connection
		if (env.MCP_SESSIONS && connectionId && user) {
			const connectionData = {
				userId: user.id,
				username: user.username,
				scopes: grant?.scope || [],
				lastfm_session_key: user.lastfm_session_key,
				connection_type: 'oauth',
				established_at: Date.now()
			}
			
			await env.MCP_SESSIONS.put(
				`oauth-connection:${connectionId}`, 
				JSON.stringify(connectionData),
				{ expirationTtl: 30 * 60 } // 30 minutes
			)
		}
		
		// Add CORS headers
		response.headers.set('Access-Control-Allow-Origin', '*')
		response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
		response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
		
		return response as unknown as Response
		
	} catch (error) {
		console.error('OAuth SSE connection error:', error)
		
		return new Response('Failed to establish SSE connection', {
			status: 500,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Content-Type': 'text/plain'
			}
		})
	}
}

/**
 * Check if user has required scopes for a given operation
 */
export function hasRequiredScopes(userScopes: string[], requiredScopes: string[]): boolean {
	if (requiredScopes.length === 0) {
		return true // No scopes required
	}
	
	return requiredScopes.every(scope => 
		userScopes.includes(scope) || 
		userScopes.includes('*') ||
		userScopes.includes('lastfm:*') // Wildcard for all Last.fm scopes
	)
}

/**
 * Get OAuth scopes required for specific MCP tools
 */
export function getToolScopes(toolName: string): string[] {
	const scopeMap: Record<string, string[]> = {
		// Public tools (no authentication required)
		'ping': [],
		'server_info': [],
		'get_track_info': [],
		'get_artist_info': [],
		'get_album_info': [],
		'get_similar_artists': [],
		'get_similar_tracks': [],
		
		// User data tools (require authentication)
		'get_recent_tracks': ['lastfm:read'],
		'get_top_artists': ['lastfm:read'],
		'get_top_albums': ['lastfm:read'],
		'get_loved_tracks': ['lastfm:read'],
		'get_user_info': ['lastfm:profile'],
		'get_listening_stats': ['lastfm:read'],
		'get_music_recommendations': ['lastfm:recommendations']
	}
	
	return scopeMap[toolName] || ['lastfm:read']
}