/**
 * ABOUTME: Manual OAuth implementation that properly integrates with OAuth provider
 * ABOUTME: Complete OAuth flow without relying on undocumented helper methods
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { LastfmAuth } from './auth/lastfm'
import type { Env } from './types/env'

// Import MCP protocol handlers
import { parseMessage, createError, serializeResponse } from './protocol/parser'
import { handleMethod } from './protocol/handlers'
import { ErrorCode } from './types/jsonrpc'

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

// Default handler that implements authorization manually
const defaultHandler = {
	async fetch(request: Request, env: any, ctx: any): Promise<Response> {
		const url = new URL(request.url)
		
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		}

		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 200, headers: corsHeaders })
		}

		// Manual OAuth authorization endpoint
		if (url.pathname === '/oauth/authorize' && request.method === 'GET') {
			return await handleManualAuthorize(request, env)
		}

		// Last.fm authentication callback
		if (url.pathname === '/oauth/lastfm/callback' && request.method === 'GET') {
			return await handleLastFmCallback(request, env)
		}

		// Test MCP endpoint with simulated OAuth context
		if (url.pathname === '/test-mcp' && request.method === 'POST') {
			// Simulate OAuth context for bordesak user
			const fakeOAuthContext = {
				oauth: {
					user: {
						id: 'bordesak',
						username: 'bordesak',
						lastfm_session_key: 'test-session-key' // We'll need a real one for actual Last.fm calls
					}
				}
			}
			return await handleOAuthMCPRequest(request, env, fakeOAuthContext)
		}

		// Test the authorization URL generation
		if (url.pathname === '/test-auth-url' && request.method === 'GET') {
			const testUrl = `${url.origin}/oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:5173/callback&state=test123&scope=lastfm:read`
			return new Response(JSON.stringify({
				message: 'Test authorization URL',
				auth_url: testUrl,
				instructions: 'Replace YOUR_CLIENT_ID with actual client ID from registration'
			}), {
				headers: { ...corsHeaders, 'Content-Type': 'application/json' }
			})
		}

		// Other endpoints
		switch (url.pathname) {
			case '/':
				return new Response(JSON.stringify({
					name: 'Last.fm MCP OAuth Manual Test',
					version: '2.0.0-manual',
					oauth_endpoints: {
						authorization: `${url.origin}/oauth/authorize`,
						token: `${url.origin}/oauth/token`,
						registration: `${url.origin}/oauth/register`
					},
					protected_endpoints: {
						sse: `${url.origin}/sse`
					},
					test_flow: {
						"1": "POST /oauth/register - Register client",
						"2": "GET /oauth/authorize?params - Start auth (redirects to Last.fm)",
						"3": "Complete Last.fm auth",
						"4": "POST /oauth/token - Exchange code for token", 
						"5": "GET /sse with Bearer token - Access protected endpoint"
					},
					test_helper: {
						"test_auth_url": "GET /test-auth-url - Get sample authorization URL"
					}
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})

			case '/health':
				return new Response(JSON.stringify({
					status: 'ok',
					oauth: 'manual',
					lastfm_configured: !!(env.LASTFM_API_KEY && env.LASTFM_SHARED_SECRET)
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})

			default:
				return new Response(JSON.stringify({
					error: 'Not found',
					path: url.pathname,
					available: ['/', '/health', '/test-auth-url', '/sse', '/oauth/*']
				}), {
					status: 404,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})
		}
	}
}

/**
 * Handle OAuth authorization manually
 */
async function handleManualAuthorize(request: Request, env: any): Promise<Response> {
	const url = new URL(request.url)
	const clientId = url.searchParams.get('client_id')
	const redirectUri = url.searchParams.get('redirect_uri')
	const state = url.searchParams.get('state')
	const responseType = url.searchParams.get('response_type')
	const scope = url.searchParams.get('scope')

	console.log('Authorization request:', { clientId, redirectUri, state, responseType, scope })

	// Validate required parameters
	if (!clientId || !redirectUri || !state || responseType !== 'code') {
		return new Response(JSON.stringify({
			error: 'invalid_request',
			error_description: 'Missing required parameters: client_id, redirect_uri, state, response_type=code'
		}), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		})
	}

	// Validate client exists by checking OAUTH_KV
	const clientData = await env.OAUTH_KV?.get(`client:${clientId}`)
	if (!clientData) {
		const errorUrl = new URL(redirectUri)
		errorUrl.searchParams.set('error', 'invalid_client')
		errorUrl.searchParams.set('error_description', 'Client not found')
		errorUrl.searchParams.set('state', state)
		return Response.redirect(errorUrl.toString(), 302)
	}

	// Check if user is already authenticated
	const sessionCookie = getCookie(request, 'lastfm_session')
	if (sessionCookie) {
		const sessionData = await env.MCP_SESSIONS?.get(`session:lastfm:${sessionCookie}`)
		if (sessionData) {
			const session = JSON.parse(sessionData)
			if (!session.expires_at || Date.now() < session.expires_at) {
				console.log('User already authenticated:', session.username)
				return await completeAuthorizationManual(clientId, redirectUri, state, scope, session, env)
			}
		}
	}

	// User not authenticated - redirect to Last.fm
	if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
		const errorUrl = new URL(redirectUri)
		errorUrl.searchParams.set('error', 'server_error')
		errorUrl.searchParams.set('error_description', 'Last.fm not configured')
		errorUrl.searchParams.set('state', state)
		return Response.redirect(errorUrl.toString(), 302)
	}

	// Store authorization request for callback
	const stateKey = `oauth:auth:${state}`
	await env.MCP_SESSIONS?.put(stateKey, JSON.stringify({
		client_id: clientId,
		redirect_uri: redirectUri,
		state,
		scope: scope || 'lastfm:read',
		timestamp: Date.now()
	}), { expirationTtl: 600 })

	// Redirect to Last.fm authentication
	const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
	const callbackUrl = `${url.protocol}//${url.host}/oauth/lastfm/callback?state=${state}`
	const lastfmAuthUrl = auth.getAuthUrl(callbackUrl)

	console.log('Redirecting to Last.fm:', { state, lastfmAuthUrl })
	return Response.redirect(lastfmAuthUrl, 302)
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

		// Complete OAuth authorization
		const authResponse = await completeAuthorizationManual(
			authRequest.client_id,
			authRequest.redirect_uri,
			authRequest.state,
			authRequest.scope,
			sessionData,
			env
		)

		// Create new response with session cookie (can't modify immutable response)
		const finalResponse = new Response(authResponse.body, {
			status: authResponse.status,
			headers: new Headers(authResponse.headers)
		})
		
		// Set session cookie
		finalResponse.headers.set('Set-Cookie', `lastfm_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`)

		return finalResponse

	} catch (error) {
		console.error('Last.fm callback error:', error)
		return new Response(`Authentication failed: ${error.message}`, { status: 500 })
	}
}

/**
 * Complete OAuth authorization by generating authorization code
 */
async function completeAuthorizationManual(
	clientId: string,
	redirectUri: string,
	state: string,
	scope: string,
	session: any,
	env: any
): Promise<Response> {
	try {
		// Generate authorization code
		const authCode = crypto.randomUUID()
		
		// Store authorization code with all necessary data
		const codeKey = `code:${authCode}`
		const codeData = {
			client_id: clientId,
			user_id: session.username,
			username: session.username,
			lastfm_session_key: session.sessionKey,
			scopes: (scope || 'lastfm:read').split(' '),
			redirect_uri: redirectUri,
			expires_at: Date.now() + (10 * 60 * 1000), // 10 minutes
			created_at: Date.now()
		}

		await env.OAUTH_KV?.put(codeKey, JSON.stringify(codeData), {
			expirationTtl: 600 // 10 minutes
		})

		// Redirect back to client with authorization code
		const redirectUrl = new URL(redirectUri)
		redirectUrl.searchParams.set('code', authCode)
		redirectUrl.searchParams.set('state', state)

		console.log('Authorization completed:', { 
			code: authCode.substring(0, 8) + '...', 
			user: session.username,
			redirectTo: redirectUrl.toString()
		})

		return Response.redirect(redirectUrl.toString(), 302)

	} catch (error) {
		console.error('Authorization completion failed:', error)
		
		const errorUrl = new URL(redirectUri)
		errorUrl.searchParams.set('error', 'server_error')
		errorUrl.searchParams.set('state', state)
		return Response.redirect(errorUrl.toString(), 302)
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

// Create OAuth provider with token exchange handling
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
	
	// Handle token exchange when authorization code is presented
	tokenExchangeCallback: async (options) => {
		console.log('Token exchange:', options.grantType, 'for user:', options.userId)
		
		if (options.grantType === 'authorization_code') {
			// The OAuth provider has already validated the authorization code
			// We just need to return the user props for the access token
			return {
				accessTokenProps: {
					user: {
						id: options.userId,
						username: options.userId, // OAuth provider uses userId as the user identifier
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