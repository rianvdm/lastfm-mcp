/**
 * ABOUTME: Last.fm MCP Server with OAuth 2.0 support - Complete implementation
 * ABOUTME: Main worker entry point with OAuth provider integration and backward compatibility
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { parseMessage, createError, serializeResponse } from './protocol/parser'
import { handleMethod } from './protocol/handlers'
import { ErrorCode, JSONRPCError } from './types/jsonrpc'
import { handleLastFmOAuthLogin, handleLastFmOAuthCallback } from './oauth/lastfm-bridge'
import { KVLogger } from './utils/kvLogger'
import { RateLimiter } from './utils/rateLimit'
import type { Env } from './types/env'

/**
 * MCP API handler for OAuth-protected SSE endpoint
 */
const mcpApiHandler = {
	async fetch(request: Request, env: Env, ctx: any, props: any): Promise<Response> {
		const { user, grant } = props
		console.log('OAuth MCP request for user:', user?.id || 'unknown')
		
		return await handleMCPWithOAuth(request, env, user, grant)
	}
}

/**
 * Default handler for non-protected endpoints
 */
const defaultHandler = {
	async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
		const url = new URL(request.url)
		
		// CORS headers
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		}

		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 200, headers: corsHeaders })
		}

		switch (url.pathname) {
			case '/oauth/lastfm/login':
				return await handleLastFmOAuthLogin(request, env)
			
			case '/oauth/lastfm/callback':
				return await handleLastFmOAuthCallback(request, env)
			
			case '/':
				return new Response(JSON.stringify({
					name: 'Last.fm MCP Server with OAuth',
					version: '2.0.0',
					authentication: {
						type: 'oauth2',
						authorization_url: `${url.origin}/oauth/authorize`,
						token_url: `${url.origin}/oauth/token`,
						registration_url: `${url.origin}/oauth/register`,
						scopes: ['lastfm:read', 'lastfm:profile', 'lastfm:recommendations']
					}
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})
			
			case '/health':
				return new Response(JSON.stringify({
					status: 'ok',
					version: '2.0.0',
					authentication: 'oauth2'
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})
			
			default:
				return new Response('Not found', { status: 404, headers: corsHeaders })
		}
	}
}

/**
 * OAuth provider configuration
 */
const oauthProvider = new OAuthProvider({
	apiRoute: '/sse',
	apiHandler: mcpApiHandler,
	defaultHandler: defaultHandler,
	
	authorizeEndpoint: '/oauth/authorize',
	tokenEndpoint: '/oauth/token',
	clientRegistrationEndpoint: '/oauth/register',
	
	scopesSupported: ['lastfm:read', 'lastfm:profile', 'lastfm:recommendations'],
	allowImplicitFlow: false,
	disallowPublicClientRegistration: false,
	
	// User authentication for OAuth flow
	async authenticateUser(request, env) {
		// Check for Last.fm session cookie
		const cookieHeader = request.headers.get('Cookie')
		if (!cookieHeader) return null
		
		const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
			const [key, value] = cookie.trim().split('=')
			if (key && value) acc[key] = value
			return acc
		}, {} as Record<string, string>)
		
		const sessionId = cookies.lastfm_session
		if (!sessionId) return null
		
		// Get Last.fm session from KV
		const sessionData = await env.MCP_SESSIONS.get(`session:lastfm:${sessionId}`)
		if (!sessionData) return null
		
		const session = JSON.parse(sessionData)
		if (session.expires_at && Date.now() > session.expires_at) {
			await env.MCP_SESSIONS.delete(`session:lastfm:${sessionId}`)
			return null
		}
		
		return {
			id: session.username,
			username: session.username,
			lastfm_session_key: session.sessionKey
		}
	},
	
	// Create grant with Last.fm session data
	async createGrant(user, client, scopes, env) {
		return {
			userId: user.id,
			scope: scopes,
			props: {
				user: {
					id: user.id,
					username: user.username,
					lastfm_session_key: user.lastfm_session_key
				},
				grant: {
					scope: scopes,
					client_id: client.client_id
				}
			}
		}
	},
	
	// Redirect unauthenticated users to Last.fm auth
	async getAuthorizationUrl(request, state, redirectUri, env) {
		const authUrl = new URL('/oauth/lastfm/login', request.url)
		authUrl.searchParams.set('state', state)
		authUrl.searchParams.set('redirect_uri', redirectUri)
		return authUrl.toString()
	}
})

/**
 * Handle MCP requests with OAuth authentication
 */
async function handleMCPWithOAuth(
	request: Request, 
	env: Env, 
	user: any, 
	grant: any
): Promise<Response> {
	const startTime = Date.now()
	const userId = user?.id || 'anonymous'
	
	try {
		// Handle SSE connection establishment
		if (request.method === 'GET') {
			// Import SSE handling
			const { createSSEResponse } = await import('./transport/sse')
			const { response, connectionId } = createSSEResponse()
			
			// Store OAuth context for this connection
			if (connectionId && user) {
				await env.MCP_SESSIONS.put(`oauth-connection:${connectionId}`, JSON.stringify({
					userId: user.id,
					username: user.username,
					scopes: grant?.scope || [],
					lastfm_session_key: user.lastfm_session_key,
					established_at: Date.now()
				}), { expirationTtl: 30 * 60 })
			}
			
			console.log('OAuth SSE connection established for:', user.username)
			return response as unknown as Response
		}
		
		// Handle JSON-RPC requests
		if (request.method === 'POST') {
			const body = await request.text()
			if (!body) {
				return new Response(serializeResponse(
					createError(null, ErrorCode.InvalidRequest, 'Empty request body')
				), {
					headers: { 
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*'
					}
				})
			}
			
			// Parse JSON-RPC
			const jsonrpcRequest = parseMessage(body)
			
			// Create request with OAuth context
			const contextRequest = new Request(request.url, {
				method: request.method,
				headers: new Headers(request.headers),
				body: body
			})
			
			// Add OAuth user context headers
			contextRequest.headers.set('X-User-ID', user?.id || 'unknown')
			contextRequest.headers.set('X-Username', user?.username || 'unknown')
			contextRequest.headers.set('X-Scopes', (grant?.scope || []).join(','))
			if (user?.lastfm_session_key) {
				contextRequest.headers.set('X-LastFM-Session', user.lastfm_session_key)
			}
			
			// Handle the MCP method
			const response = await handleMethod(jsonrpcRequest, contextRequest, env.JWT_SECRET, env)
			
			// Log successful request
			const logger = env?.MCP_LOGS ? new KVLogger(env.MCP_LOGS) : null
			if (logger) {
				await logger.log(userId, jsonrpcRequest.method, jsonrpcRequest.params, {
					status: 'success',
					latency: Date.now() - startTime,
					oauth_scopes: grant?.scope || []
				})
			}
			
			if (!response) {
				return new Response(null, { status: 204 })
			}
			
			return new Response(serializeResponse(response), {
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*'
				}
			})
		}
		
		return new Response('Method not allowed', { status: 405 })
		
	} catch (error) {
		console.error('OAuth MCP handler error:', error)
		
		return new Response(serializeResponse(
			createError(null, ErrorCode.InternalError, 'Internal server error')
		), {
			status: 500,
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*'
			}
		})
	}
}

// Export the OAuth provider as the worker default
export default oauthProvider