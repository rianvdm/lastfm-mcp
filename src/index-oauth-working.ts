/**
 * ABOUTME: Working OAuth implementation using OAuth provider's built-in methods
 * ABOUTME: Properly implements OAuth flow with Last.fm authentication bridge
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { LastfmAuth } from './auth/lastfm'
import type { Env } from './types/env'

// OAuth-protected API handler  
const apiHandler = {
	async fetch(request: Request, env: any, ctx: any): Promise<Response> {
		console.log('OAuth API Handler called')
		
		return new Response(JSON.stringify({
			message: 'OAuth authentication successful! MCP endpoint would be here.',
			url: request.url,
			method: request.method,
			timestamp: new Date().toISOString()
		}), {
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*'
			}
		})
	}
}

// Default handler with manual authorization implementation
class DefaultHandler {
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

		// Handle OAuth authorization endpoint
		if (url.pathname === '/oauth/authorize' && request.method === 'GET') {
			return await this.handleAuthorize(request, env, ctx)
		}

		// Handle Last.fm callback
		if (url.pathname === '/oauth/lastfm/callback' && request.method === 'GET') {
			return await this.handleLastFmCallback(request, env, ctx)
		}

		// Other endpoints
		switch (url.pathname) {
			case '/':
				return new Response(JSON.stringify({
					name: 'Last.fm MCP OAuth Working Test',
					version: '2.0.0-working',
					oauth_endpoints: {
						authorization: `${url.origin}/oauth/authorize`,
						token: `${url.origin}/oauth/token`, 
						registration: `${url.origin}/oauth/register`
					},
					protected_endpoints: {
						sse: `${url.origin}/sse`
					},
					test_instructions: {
						"1": "Register client: POST /oauth/register",
						"2": "Start authorization: GET /oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:5173/callback&state=test123&scope=lastfm:read",
						"3": "Follow Last.fm auth flow",
						"4": "Exchange code for token: POST /oauth/token",
						"5": "Use token: GET /sse with Authorization: Bearer TOKEN"
					}
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})

			case '/health':
				return new Response(JSON.stringify({
					status: 'ok',
					oauth: 'working',
					lastfm_api_configured: !!env.LASTFM_API_KEY,
					lastfm_secret_configured: !!env.LASTFM_SHARED_SECRET
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})

			default:
				return new Response(JSON.stringify({
					error: 'Not found',
					message: `${url.pathname} not found`,
					available_endpoints: ['/', '/health', '/sse', '/oauth/*']
				}), {
					status: 404,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})
		}
	}

	async handleAuthorize(request: Request, env: any, ctx: any) {
		// Get OAuth helpers from the provider
		const oauthHelpers = ctx.oauth as any
		
		try {
			// Parse the authorization request
			const authRequest = await oauthHelpers.parseAuthRequest(request)
			console.log('OAuth authorization request:', authRequest)

			// Validate client
			const client = await oauthHelpers.lookupClient(authRequest.clientId)
			if (!client) {
				const errorUrl = new URL(authRequest.redirectUri)
				errorUrl.searchParams.set('error', 'invalid_client')
				errorUrl.searchParams.set('state', authRequest.state)
				return Response.redirect(errorUrl.toString(), 302)
			}

			// Check if user is already authenticated
			const sessionCookie = this.getCookie(request, 'lastfm_session')
			if (sessionCookie) {
				const sessionData = await env.MCP_SESSIONS?.get(`session:lastfm:${sessionCookie}`)
				if (sessionData) {
					const session = JSON.parse(sessionData)
					if (!session.expires_at || Date.now() < session.expires_at) {
						// User is authenticated - complete authorization
						return await this.completeAuthorization(authRequest, session, oauthHelpers)
					}
				}
			}

			// User not authenticated - redirect to Last.fm
			if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
				const errorUrl = new URL(authRequest.redirectUri)
				errorUrl.searchParams.set('error', 'server_error')
				errorUrl.searchParams.set('error_description', 'Authentication not configured')
				errorUrl.searchParams.set('state', authRequest.state)
				return Response.redirect(errorUrl.toString(), 302)
			}

			// Store auth request for callback
			const stateKey = `oauth:auth:${authRequest.state}`
			await env.MCP_SESSIONS?.put(stateKey, JSON.stringify(authRequest), {
				expirationTtl: 600 // 10 minutes
			})

			// Redirect to Last.fm
			const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
			const url = new URL(request.url)
			const callbackUrl = `${url.protocol}//${url.host}/oauth/lastfm/callback?state=${authRequest.state}`
			const lastfmAuthUrl = auth.getAuthUrl(callbackUrl)

			console.log('Redirecting to Last.fm auth:', { state: authRequest.state, client: authRequest.clientId })
			return Response.redirect(lastfmAuthUrl, 302)

		} catch (error) {
			console.error('Authorization error:', error)
			return new Response(JSON.stringify({
				error: 'invalid_request',
				error_description: error.message
			}), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			})
		}
	}

	async handleLastFmCallback(request: Request, env: any, ctx: any) {
		const oauthHelpers = ctx.oauth as any
		const url = new URL(request.url)
		const lastfmToken = url.searchParams.get('token')
		const state = url.searchParams.get('state')

		if (!lastfmToken || !state) {
			return new Response('Missing Last.fm token or OAuth state', { status: 400 })
		}

		try {
			// Get stored auth request
			const stateKey = `oauth:auth:${state}`
			const authRequestData = await env.MCP_SESSIONS?.get(stateKey)
			
			if (!authRequestData) {
				return new Response('Invalid or expired OAuth state', { status: 400 })
			}

			const authRequest = JSON.parse(authRequestData)
			await env.MCP_SESSIONS?.delete(stateKey)

			// Exchange Last.fm token for session
			const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
			const { sessionKey, username } = await auth.getSessionKey(lastfmToken)

			// Create Last.fm session
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

			console.log('Last.fm auth successful for:', username)

			// Complete OAuth authorization using provider helpers
			const authResponse = await this.completeAuthorization(authRequest, sessionData, oauthHelpers)

			// Set session cookie
			const cookieOptions = 'HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400'
			authResponse.headers.set('Set-Cookie', `lastfm_session=${sessionId}; ${cookieOptions}`)

			return authResponse

		} catch (error) {
			console.error('Last.fm callback error:', error)
			return new Response(`Authentication failed: ${error.message}`, { status: 500 })
		}
	}

	async completeAuthorization(authRequest: any, lastfmSession: any, oauthHelpers: any) {
		try {
			const result = await oauthHelpers.completeAuthorization({
				request: authRequest,
				userId: lastfmSession.username,
				metadata: {
					username: lastfmSession.username,
					authenticated_at: Date.now()
				},
				scope: authRequest.scope || ['lastfm:read'],
				props: {
					user: {
						id: lastfmSession.username,
						username: lastfmSession.username,
						lastfm_session_key: lastfmSession.sessionKey
					}
				}
			})

			console.log('OAuth authorization completed:', { user: lastfmSession.username })
			return Response.redirect(result.redirectTo, 302)

		} catch (error) {
			console.error('Failed to complete authorization:', error)
			
			const errorUrl = new URL(authRequest.redirectUri)
			errorUrl.searchParams.set('error', 'server_error')
			errorUrl.searchParams.set('state', authRequest.state)
			return Response.redirect(errorUrl.toString(), 302)
		}
	}

	getCookie(request: Request, name: string): string | null {
		const cookieHeader = request.headers.get('Cookie')
		if (!cookieHeader) return null
		
		const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
			const [key, value] = cookie.trim().split('=')
			if (key && value) acc[key] = value
			return acc
		}, {} as Record<string, string>)
		
		return cookies[name] || null
	}
}

// Create OAuth provider
export default new OAuthProvider({
	apiRoute: '/sse',
	apiHandler,
	defaultHandler: new DefaultHandler(),
	
	authorizeEndpoint: '/oauth/authorize',
	tokenEndpoint: '/oauth/token', 
	clientRegistrationEndpoint: '/oauth/register',
	
	scopesSupported: ['lastfm:read', 'lastfm:profile', 'lastfm:recommendations'],
	disallowPublicClientRegistration: false,
	allowImplicitFlow: false,
	
	onError: (error) => {
		console.error('OAuth Provider Error:', error)
	}
})