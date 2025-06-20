/**
 * ABOUTME: Complete OAuth implementation with Last.fm authentication bridge
 * ABOUTME: Full OAuth flow including authorization page and Last.fm integration
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { LastfmAuth } from './auth/lastfm'
import type { Env } from './types/env'

// OAuth-protected API handler
const apiHandler = {
	async fetch(request: Request, env: any, ctx: any): Promise<Response> {
		console.log('OAuth API Handler called for:', request.url)
		
		return new Response(JSON.stringify({
			message: 'OAuth authentication successful!',
			url: request.url,
			method: request.method,
			timestamp: new Date().toISOString(),
			note: 'This would normally handle MCP requests'
		}), {
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*'
			}
		})
	}
}

// Default handler that implements the authorization flow
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

		// Handle OAuth authorization endpoint manually
		if (url.pathname === '/oauth/authorize' && request.method === 'GET') {
			return await handleOAuthAuthorize(request, env)
		}

		// Handle Last.fm authentication callback
		if (url.pathname === '/oauth/lastfm/callback' && request.method === 'GET') {
			return await handleLastFmCallback(request, env)
		}

		// Other endpoints
		switch (url.pathname) {
			case '/':
				return new Response(JSON.stringify({
					name: 'Last.fm MCP OAuth Complete Test',
					version: '2.0.0-complete',
					oauth_endpoints: {
						authorization: `${url.origin}/oauth/authorize`,
						token: `${url.origin}/oauth/token`,
						registration: `${url.origin}/oauth/register`
					},
					protected_endpoints: {
						sse: `${url.origin}/sse`
					},
					test_flow: {
						"1": "Register client: POST /oauth/register",
						"2": "Start auth: GET /oauth/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=REDIRECT_URI&state=STATE",
						"3": "Complete Last.fm auth",
						"4": "Exchange code: POST /oauth/token",
						"5": "Access protected endpoint: GET /sse with Bearer token"
					}
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})

			case '/health':
				return new Response(JSON.stringify({
					status: 'ok',
					oauth: 'complete',
					lastfm_configured: !!(env.LASTFM_API_KEY && env.LASTFM_SHARED_SECRET)
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})

			default:
				return new Response(JSON.stringify({
					error: 'Not found',
					available_endpoints: ['/', '/health', '/sse', '/oauth/*']
				}), {
					status: 404,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})
		}
	}
}

/**
 * Handle OAuth authorization request - redirect to Last.fm or show approval page
 */
async function handleOAuthAuthorize(request: Request, env: any): Promise<Response> {
	const url = new URL(request.url)
	const clientId = url.searchParams.get('client_id')
	const redirectUri = url.searchParams.get('redirect_uri')
	const state = url.searchParams.get('state')
	const responseType = url.searchParams.get('response_type')
	const scope = url.searchParams.get('scope')

	// Validate required OAuth parameters
	if (!clientId || !redirectUri || !state || responseType !== 'code') {
		return new Response(JSON.stringify({
			error: 'invalid_request',
			error_description: 'Missing or invalid OAuth parameters'
		}), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		})
	}

	// Check if user is already authenticated with Last.fm
	const sessionCookie = getCookie(request, 'lastfm_session')
	if (sessionCookie) {
		const sessionData = await env.MCP_SESSIONS?.get(`session:lastfm:${sessionCookie}`)
		if (sessionData) {
			const session = JSON.parse(sessionData)
			if (!session.expires_at || Date.now() < session.expires_at) {
				// User is authenticated - complete authorization
				return await completeOAuthAuthorization(clientId, redirectUri, state, scope, session, env)
			}
		}
	}

	// User not authenticated - redirect to Last.fm
	if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
		return new Response(JSON.stringify({
			error: 'server_error',
			error_description: 'Last.fm authentication not configured'
		}), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		})
	}

	// Store OAuth parameters for after Last.fm auth
	const stateKey = `oauth:state:${state}`
	await env.MCP_SESSIONS?.put(stateKey, JSON.stringify({
		client_id: clientId,
		redirect_uri: redirectUri,
		state,
		scope,
		timestamp: Date.now()
	}), { expirationTtl: 600 }) // 10 minutes

	// Redirect to Last.fm authentication
	const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
	const callbackUrl = `${url.protocol}//${url.host}/oauth/lastfm/callback?state=${state}`
	const lastfmAuthUrl = auth.getAuthUrl(callbackUrl)

	console.log('Redirecting to Last.fm auth:', { state, clientId })
	return Response.redirect(lastfmAuthUrl, 302)
}

/**
 * Handle Last.fm authentication callback
 */
async function handleLastFmCallback(request: Request, env: any): Promise<Response> {
	const url = new URL(request.url)
	const lastfmToken = url.searchParams.get('token')
	const state = url.searchParams.get('state')

	if (!lastfmToken || !state) {
		return new Response('Missing Last.fm token or OAuth state', { status: 400 })
	}

	// Get stored OAuth parameters
	const stateKey = `oauth:state:${state}`
	const stateData = await env.MCP_SESSIONS?.get(stateKey)
	
	if (!stateData) {
		return new Response('Invalid or expired OAuth state', { status: 400 })
	}

	const oauthParams = JSON.parse(stateData)
	await env.MCP_SESSIONS?.delete(stateKey)

	try {
		// Exchange Last.fm token for session
		const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const { sessionKey, username } = await auth.getSessionKey(lastfmToken)

		// Store Last.fm session
		const sessionId = crypto.randomUUID()
		const sessionData = {
			username,
			sessionKey,
			expires_at: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
			created_at: Date.now()
		}

		await env.MCP_SESSIONS?.put(`session:lastfm:${sessionId}`, JSON.stringify(sessionData), {
			expirationTtl: 24 * 60 * 60
		})

		console.log('Last.fm authentication successful for:', username)

		// Complete OAuth authorization
		const response = await completeOAuthAuthorization(
			oauthParams.client_id,
			oauthParams.redirect_uri,
			oauthParams.state,
			oauthParams.scope,
			sessionData,
			env
		)

		// Set session cookie
		const cookieOptions = [
			'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=86400'
		].join('; ')
		response.headers.set('Set-Cookie', `lastfm_session=${sessionId}; ${cookieOptions}`)

		return response

	} catch (error) {
		console.error('Last.fm authentication failed:', error)
		return new Response(`Last.fm authentication failed: ${error.message}`, { status: 500 })
	}
}

/**
 * Complete OAuth authorization by creating a grant and authorization code
 */
async function completeOAuthAuthorization(
	clientId: string,
	redirectUri: string, 
	state: string,
	scope: string | null,
	lastfmSession: any,
	env: any
): Promise<Response> {
	try {
		// Create authorization code manually 
		const authCode = crypto.randomUUID()
		const scopes = scope ? scope.split(' ') : ['test:read']
		
		// Store authorization code with user data
		const codeKey = `oauth:code:${authCode}`
		const codeData = {
			client_id: clientId,
			user_id: lastfmSession.username,
			username: lastfmSession.username,
			lastfm_session_key: lastfmSession.sessionKey,
			scopes,
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

		console.log('OAuth authorization completed:', { 
			code: authCode.substring(0, 8) + '...', 
			user: lastfmSession.username 
		})

		return Response.redirect(redirectUrl.toString(), 302)

	} catch (error) {
		console.error('Failed to complete OAuth authorization:', error)
		
		// Redirect back with error
		const redirectUrl = new URL(redirectUri)
		redirectUrl.searchParams.set('error', 'server_error')
		redirectUrl.searchParams.set('state', state)
		
		return Response.redirect(redirectUrl.toString(), 302)
	}
}

/**
 * Extract cookie value from request
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

// Create OAuth provider with complete configuration
export default new OAuthProvider({
	apiRoute: '/sse',
	apiHandler,
	defaultHandler,
	
	authorizeEndpoint: '/oauth/authorize',
	tokenEndpoint: '/oauth/token',
	clientRegistrationEndpoint: '/oauth/register',
	
	scopesSupported: ['test:read', 'test:write', 'lastfm:read', 'lastfm:profile'],
	disallowPublicClientRegistration: false,
	allowImplicitFlow: false,
	
	// Handle token exchange with Last.fm session data
	tokenExchangeCallback: async (options) => {
		console.log('Token exchange for:', options.userId)
		
		if (options.grantType === 'authorization_code') {
			// Get authorization code data
			const codeKey = `oauth:code:${options.props.code}`
			const codeDataStr = await options.props.env?.OAUTH_KV?.get(codeKey)
			
			if (codeDataStr) {
				const codeData = JSON.parse(codeDataStr)
				
				return {
					accessTokenProps: {
						user: {
							id: codeData.user_id,
							username: codeData.username,
							lastfm_session_key: codeData.lastfm_session_key
						},
						grant: {
							client_id: options.clientId,
							scope: options.scope
						}
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