/**
 * ABOUTME: Fixed OAuth implementation that properly integrates with the OAuth provider
 * ABOUTME: Handles authorization codes in a way compatible with @cloudflare/workers-oauth-provider
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { LastfmAuth } from './auth/lastfm'
import type { Env } from './types/env'

// Import MCP protocol handlers
import { parseMessage, createError, serializeResponse } from './protocol/parser'
import { handleMethod } from './protocol/handlers'
import { ErrorCode } from './types/jsonrpc'

// Store environment reference for callbacks
let globalEnv: Env | null = null

// OAuth-protected MCP API handler
const apiHandler = {
	async fetch(request: Request, env: any, ctx: any): Promise<Response> {
		console.log('OAuth-protected MCP endpoint accessed:', {
			method: request.method,
			url: request.url,
			hasAuthContext: !!ctx.oauth
		})

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 200,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Connection-ID',
					'Access-Control-Max-Age': '86400',
				},
			})
		}

		// Handle GET requests (info endpoint)
		if (request.method === 'GET') {
			return new Response(JSON.stringify({
				message: 'Last.fm MCP Server - OAuth Protected Endpoint',
				authentication: 'OAuth 2.0 Bearer Token Required',
				protocol: 'Model Context Protocol (MCP) 2024-11-05',
				url: request.url,
				timestamp: new Date().toISOString(),
				usage: 'Send JSON-RPC 2.0 requests to this endpoint with Bearer token authentication'
			}), {
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*'
				}
			})
		}

		// Handle POST requests (MCP JSON-RPC)
		if (request.method === 'POST') {
			return await handleOAuthMCPRequest(request, env, ctx)
		}

		return new Response('Method not allowed', { 
			status: 405,
			headers: {
				'Access-Control-Allow-Origin': '*'
			}
		})
	}
}

/**
 * Create an OAuth-compatible session payload for MCP handlers
 */
function createOAuthSessionPayload(oauthUser: any): any {
	return {
		userId: oauthUser.id,
		username: oauthUser.username,
		sessionKey: oauthUser.lastfm_session_key,
		iat: Math.floor(Date.now() / 1000),
		exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours from now
	}
}

/**
 * Handle MCP JSON-RPC requests with OAuth authentication context
 */
async function handleOAuthMCPRequest(request: Request, env: any, ctx: any): Promise<Response> {
	const startTime = Date.now()
	
	try {
		// Get OAuth user context from the OAuth provider
		const oauthContext = ctx.oauth
		if (!oauthContext || !oauthContext.user) {
			console.log('No OAuth user context available')
			return new Response(JSON.stringify({
				error: 'Authentication required',
				message: 'Valid OAuth Bearer token required'
			}), {
				status: 401,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*'
				}
			})
		}

		console.log('OAuth user context:', {
			userId: oauthContext.user.id,
			username: oauthContext.user.username,
			hasLastFmSession: !!oauthContext.user.lastfm_session_key
		})

		// Parse request body
		const body = await request.text()
		if (!body) {
			const errorResponse = createError(null, ErrorCode.InvalidRequest, 'Empty request body')
			return new Response(serializeResponse(errorResponse), {
				status: 400,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*'
				}
			})
		}

		// Parse JSON-RPC message
		let jsonrpcRequest
		try {
			jsonrpcRequest = parseMessage(body)
		} catch (error) {
			const errorResponse = createError(null, ErrorCode.ParseError, 'Invalid JSON-RPC request')
			return new Response(serializeResponse(errorResponse), {
				status: 400,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*'
				}
			})
		}

		// Create a modified request with OAuth user info and simulate a connection ID
		const modifiedHeaders = new Headers(request.headers)
		const oauthConnectionId = `oauth-${oauthContext.user.id}`
		modifiedHeaders.set('X-Connection-ID', oauthConnectionId)
		modifiedHeaders.set('X-OAuth-User-ID', oauthContext.user.id)
		modifiedHeaders.set('X-OAuth-Username', oauthContext.user.username)
		
		// Store OAuth session data in KV temporarily for MCP handlers to access
		const sessionPayload = createOAuthSessionPayload(oauthContext.user)
		if (env.MCP_SESSIONS) {
			await env.MCP_SESSIONS.put(
				`session:${oauthConnectionId}`,
				JSON.stringify({
					userId: sessionPayload.userId,
					username: sessionPayload.username,
					sessionKey: sessionPayload.sessionKey,
					expiresAt: new Date(sessionPayload.exp * 1000).toISOString(),
					source: 'oauth'
				}),
				{ expirationTtl: 3600 } // 1 hour
			)
		}

		const modifiedRequest = new Request(request.url, {
			method: request.method,
			headers: modifiedHeaders,
			body: JSON.stringify(jsonrpcRequest)
		})

		// Handle the method using existing MCP handlers
		const response = await handleMethod(jsonrpcRequest, modifiedRequest, env?.JWT_SECRET, env)

		// Clean up temporary session after request
		if (env.MCP_SESSIONS) {
			await env.MCP_SESSIONS.delete(`session:${oauthConnectionId}`)
		}

		// Calculate latency
		const latency = Date.now() - startTime
		console.log('OAuth MCP request processed:', {
			method: jsonrpcRequest.method,
			user: sessionPayload.username,
			latency: `${latency}ms`,
			hasResponse: !!response
		})

		// If no response (notification), return 204 No Content
		if (!response) {
			return new Response(null, {
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': '*'
				}
			})
		}

		// Return JSON-RPC response
		return new Response(serializeResponse(response), {
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*'
			}
		})

	} catch (error) {
		console.error('OAuth MCP request error:', error)
		const errorResponse = createError(null, ErrorCode.InternalError, 'Internal server error')
		
		return new Response(serializeResponse(errorResponse), {
			status: 500,
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*'
			}
		})
	}
}

// Default handler with custom authorization
const defaultHandler = {
	async fetch(request: Request, env: any, ctx: any): Promise<Response> {
		// Store env reference for callbacks
		globalEnv = env
		
		const url = new URL(request.url)
		
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		}

		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 200, headers: corsHeaders })
		}

		// Override authorization to handle Last.fm bridge
		if (url.pathname === '/oauth/authorize' && request.method === 'GET') {
			// The OAuth provider will handle basic validation
			// We just need to check if user is authenticated with Last.fm
			
			const state = url.searchParams.get('state')
			const clientId = url.searchParams.get('client_id')
			const redirectUri = url.searchParams.get('redirect_uri')
			
			// Check for existing Last.fm session
			const sessionCookie = getCookie(request, 'lastfm_session')
			if (sessionCookie) {
				const sessionData = await env.MCP_SESSIONS?.get(`session:lastfm:${sessionCookie}`)
				if (sessionData) {
					const session = JSON.parse(sessionData)
					// User is authenticated, let OAuth provider handle the authorization
					// The provider will call our authorizationApprovalCallback
					return new Response(null, { status: 404 }) // Let OAuth provider handle
				}
			}
			
			// User not authenticated - redirect to Last.fm
			if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
				const errorUrl = new URL(redirectUri || 'http://localhost:5173/callback')
				errorUrl.searchParams.set('error', 'server_error')
				errorUrl.searchParams.set('error_description', 'Last.fm not configured')
				if (state) errorUrl.searchParams.set('state', state)
				return Response.redirect(errorUrl.toString(), 302)
			}
			
			// Store OAuth request for callback
			const stateKey = `oauth:auth:${state}`
			await env.MCP_SESSIONS?.put(stateKey, JSON.stringify({
				client_id: clientId,
				redirect_uri: redirectUri,
				state,
				scope: url.searchParams.get('scope') || 'lastfm:read',
				timestamp: Date.now()
			}), { expirationTtl: 600 })
			
			// Redirect to Last.fm
			const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
			const callbackUrl = `${url.protocol}//${url.host}/oauth/lastfm/callback?state=${state}`
			const lastfmAuthUrl = auth.getAuthUrl(callbackUrl)
			
			console.log('Redirecting to Last.fm:', { state, lastfmAuthUrl })
			return Response.redirect(lastfmAuthUrl, 302)
		}

		// Last.fm authentication callback
		if (url.pathname === '/oauth/lastfm/callback' && request.method === 'GET') {
			return await handleLastFmCallback(request, env)
		}

		// Test MCP endpoint
		if (url.pathname === '/test-mcp' && request.method === 'POST') {
			const fakeOAuthContext = {
				oauth: {
					user: {
						id: 'bordesak',
						username: 'bordesak',
						lastfm_session_key: 'test-session-key'
					}
				}
			}
			return await handleOAuthMCPRequest(request, env, fakeOAuthContext)
		}

		// Direct test authorization endpoint
		if (url.pathname === '/test-direct-auth' && request.method === 'GET') {
			const clientId = url.searchParams.get('client_id')
			const redirectUri = url.searchParams.get('redirect_uri')
			const state = url.searchParams.get('state')
			
			// Generate an authorization code that the OAuth provider will recognize
			const authCode = crypto.randomUUID()
			
			// Store in format that matches OAuth provider expectations
			// This mimics what the OAuth provider would store
			const codeData = {
				client_id: clientId,
				user_id: 'bordesak',
				scope: 'lastfm:read',
				redirect_uri: redirectUri,
				code_challenge: null,
				code_challenge_method: null,
				expires_at: new Date(Date.now() + 600000).toISOString(),
				created_at: new Date().toISOString(),
				metadata: {
					username: 'bordesak',
					lastfm_session_key: 'test-session-key' // This would be real in production
				}
			}
			
			// Store with the exact key format the provider expects
			await env.OAUTH_KV?.put(`oauth2:code:${authCode}`, JSON.stringify(codeData), {
				expirationTtl: 600
			})
			
			const redirectUrl = new URL(redirectUri || 'http://localhost:5173/callback')
			redirectUrl.searchParams.set('code', authCode)
			if (state) redirectUrl.searchParams.set('state', state)
			
			return new Response(JSON.stringify({
				message: 'Test authorization code generated',
				code: authCode,
				redirect_url: redirectUrl.toString(),
				instructions: 'Use this code with POST /oauth/token to get an access token'
			}), {
				headers: { 'Content-Type': 'application/json' }
			})
		}

		// Other endpoints
		switch (url.pathname) {
			case '/':
				return new Response(JSON.stringify({
					name: 'Last.fm MCP OAuth Fixed',
					version: '2.0.0-fixed',
					oauth_endpoints: {
						authorization: `${url.origin}/oauth/authorize`,
						token: `${url.origin}/oauth/token`,
						registration: `${url.origin}/oauth/register`
					},
					protected_endpoints: {
						sse: `${url.origin}/sse`
					}
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})

			case '/health':
				return new Response(JSON.stringify({
					status: 'ok',
					oauth: 'fixed',
					lastfm_configured: !!(env.LASTFM_API_KEY && env.LASTFM_SHARED_SECRET)
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})

			default:
				// Let OAuth provider handle its own endpoints
				return new Response(null, { status: 404 })
		}
	}
}

/**
 * Handle Last.fm callback and complete OAuth
 */
async function handleLastFmCallback(request: Request, env: any): Promise<Response> {
	const url = new URL(request.url)
	const lastfmToken = url.searchParams.get('token')
	const state = url.searchParams.get('state')

	console.log('Last.fm callback:', { hasToken: !!lastfmToken, state })

	if (!lastfmToken || !state) {
		return new Response('Missing Last.fm token or state', { status: 400 })
	}

	try {
		// Get stored authorization request
		const stateKey = `oauth:auth:${state}`
		const authData = await env.MCP_SESSIONS?.get(stateKey)
		
		if (!authData) {
			return new Response('Invalid or expired OAuth state', { status: 400 })
		}

		const authRequest = JSON.parse(authData)
		await env.MCP_SESSIONS?.delete(stateKey)

		// Exchange Last.fm token for session
		const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const { sessionKey, username } = await auth.getSessionKey(lastfmToken)

		console.log('Last.fm authentication successful:', username)

		// Create session
		const sessionId = crypto.randomUUID()
		const sessionData = {
			username,
			sessionKey,
			expires_at: Date.now() + (24 * 60 * 60 * 1000),
			created_at: Date.now()
		}

		await env.MCP_SESSIONS?.put(`session:lastfm:${sessionId}`, JSON.stringify(sessionData), {
			expirationTtl: 24 * 60 * 60
		})

		// Redirect back to OAuth authorize with session cookie
		const authorizeUrl = new URL(`${url.protocol}//${url.host}/oauth/authorize`)
		authorizeUrl.searchParams.set('response_type', 'code')
		authorizeUrl.searchParams.set('client_id', authRequest.client_id)
		authorizeUrl.searchParams.set('redirect_uri', authRequest.redirect_uri)
		authorizeUrl.searchParams.set('state', authRequest.state)
		authorizeUrl.searchParams.set('scope', authRequest.scope)

		const response = Response.redirect(authorizeUrl.toString(), 302)
		response.headers.set('Set-Cookie', `lastfm_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`)

		return response

	} catch (error) {
		console.error('Last.fm callback error:', error)
		return new Response(`Authentication failed: ${error.message}`, { status: 500 })
	}
}

/**
 * Extract cookie from request
 */
function getCookie(request: Request, name: string): string | null {
	const cookieHeader = request.headers.get('Cookie')
	if (!cookieHeader) return null
	
	const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
		const [key, value] = cookie.trim().split('=')
		if (key && value) acc[key] = value
		return acc
	}, {} as Record<string, string>)
	
	return cookies[name] || null
}

// Create OAuth provider with proper configuration
export default new OAuthProvider({
	apiRoute: '/sse',
	apiHandler,
	defaultHandler,
	
	authorizeEndpoint: '/oauth/authorize',
	tokenEndpoint: '/oauth/token',
	clientRegistrationEndpoint: '/oauth/register',
	
	scopesSupported: ['lastfm:read', 'lastfm:profile', 'lastfm:recommendations'],
	disallowPublicClientRegistration: false,
	allowImplicitFlow: false,
	
	// Handle authorization approval - called when user approves authorization
	authorizationApprovalCallback: async (options) => {
		console.log('Authorization approval callback:', {
			clientId: options.client_id,
			userId: options.user_id,
			scope: options.scope
		})
		
		// Get the current user's Last.fm session from request context
		// This is a bit tricky since we don't have direct access to the request
		// We'll use the stored session data
		
		if (globalEnv && options.user_id) {
			// Look for Last.fm session
			const sessionData = await globalEnv.MCP_SESSIONS?.get(`session:lastfm:${options.user_id}`)
			if (sessionData) {
				const session = JSON.parse(sessionData)
				// Return user data that will be included in the token
				return {
					user_id: session.username,
					metadata: {
						username: session.username,
						lastfm_session_key: session.sessionKey
					}
				}
			}
		}
		
		// Default response
		return {
			user_id: options.user_id || 'unknown',
			metadata: {}
		}
	},
	
	// Handle token exchange
	tokenExchangeCallback: async (options) => {
		console.log('Token exchange:', options.grantType)
		
		if (options.grantType === 'authorization_code') {
			// The OAuth provider has already validated the code
			// We just need to return the token properties
			// The user data from authorizationApprovalCallback is available in options
			
			return {
				accessTokenProps: {
					user: {
						id: options.userId,
						username: options.userId,
						// The metadata from authorization approval should be available
						lastfm_session_key: options.metadata?.lastfm_session_key
					},
					grant: {
						client_id: options.clientId,
						scope: options.scope
					}
				}
			}
		}
		
		return {}
	},
	
	onError: (error) => {
		console.error('OAuth Provider Error:', error)
	}
})