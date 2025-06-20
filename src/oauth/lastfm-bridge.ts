/**
 * ABOUTME: Last.fm authentication bridge for OAuth flow integration
 * ABOUTME: Bridges Last.fm Web Auth to OAuth 2.0 for Claude custom integrations
 */

import { LastfmAuth } from '../auth/lastfm'
import type { Env } from '../types/env'

/**
 * Handle Last.fm OAuth bridge login - redirects to Last.fm with OAuth state
 */
export async function handleLastFmOAuthLogin(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url)
		const state = url.searchParams.get('state')
		const redirectUri = url.searchParams.get('redirect_uri')
		
		if (!state) {
			return new Response('Missing OAuth state parameter', { status: 400 })
		}
		
		if (!redirectUri) {
			return new Response('Missing redirect_uri parameter', { status: 400 })
		}
		
		// Validate environment
		if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
			console.error('Missing Last.fm API credentials')
			return new Response('Authentication configuration error: Missing credentials', { status: 500 })
		}
		
		// Store OAuth state for validation in callback
		const stateKey = `oauth:state:${state}`
		await env.MCP_SESSIONS.put(stateKey, JSON.stringify({
			state,
			redirectUri,
			timestamp: Date.now()
		}), {
			expirationTtl: 600 // 10 minutes
		})
		
		// Create Last.fm auth instance
		const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		
		// Build callback URL for Last.fm (returns to our bridge callback)
		const baseUrl = env.BASE_URL || `${url.protocol}//${url.host}`
		const callbackUrl = `${baseUrl}/oauth/lastfm/callback?state=${state}`
		
		// Redirect to Last.fm authorization
		const lastfmAuthUrl = auth.getAuthUrl(callbackUrl)
		
		console.log('OAuth bridge: Redirecting to Last.fm', { 
			state: state.substring(0, 8) + '...', 
			redirectUri,
			callbackUrl
		})
		
		return Response.redirect(lastfmAuthUrl, 302)
		
	} catch (error) {
		console.error('Last.fm OAuth bridge login error:', error)
		
		const errorMessage = error instanceof Error 
			? `Last.fm OAuth bridge failed: ${error.message}`
			: 'Last.fm OAuth bridge failed'
			
		return new Response(errorMessage, { status: 500 })
	}
}

/**
 * Handle Last.fm OAuth bridge callback - exchanges Last.fm token and redirects back to OAuth flow
 */
export async function handleLastFmOAuthCallback(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url)
		const lastfmToken = url.searchParams.get('token')
		const state = url.searchParams.get('state')
		
		if (!lastfmToken) {
			return new Response('Missing Last.fm authentication token', { status: 400 })
		}
		
		if (!state) {
			return new Response('Missing OAuth state parameter', { status: 400 })
		}
		
		// Validate OAuth state
		const stateKey = `oauth:state:${state}`
		const stateData = await env.MCP_SESSIONS.get(stateKey)
		
		if (!stateData) {
			return new Response('Invalid or expired OAuth state', { status: 400 })
		}
		
		const { redirectUri } = JSON.parse(stateData)
		
		// Clean up state
		await env.MCP_SESSIONS.delete(stateKey)
		
		// Validate environment
		if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
			console.error('Missing Last.fm API credentials')
			return new Response('Authentication configuration error: Missing credentials', { status: 500 })
		}
		
		// Exchange Last.fm token for session
		const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const { sessionKey, username } = await auth.getSessionKey(lastfmToken)
		
		// For OAuth flow, we need to create a user grant with the Last.fm session
		// The OAuth provider will handle this through the tokenExchangeCallback
		
		// Generate a secure session ID for the bridge
		const sessionId = crypto.randomUUID()
		
		// Store Last.fm session for OAuth flow
		const sessionKey_lastfm = `session:lastfm:${sessionId}`
		const sessionData = {
			username,
			sessionKey,
			expires_at: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
			created_at: Date.now()
		}
		
		await env.MCP_SESSIONS.put(sessionKey_lastfm, JSON.stringify(sessionData), {
			expirationTtl: 24 * 60 * 60 // 24 hours
		})
		
		// We need to store the user authentication state for the OAuth provider
		// This will be used in the tokenExchangeCallback
		const authStateKey = `oauth:auth:${state}`
		const authStateData = {
			user_id: username,
			username: username,
			lastfm_session_key: sessionKey,
			authenticated_at: Date.now()
		}
		
		await env.MCP_SESSIONS.put(authStateKey, JSON.stringify(authStateData), {
			expirationTtl: 600 // 10 minutes
		})
		
		console.log('OAuth bridge: Last.fm session created for user:', username)
		
		// Set session cookie and redirect back to OAuth authorize endpoint
		const baseUrl = env.BASE_URL || `${url.protocol}//${url.host}`
		const authorizeUrl = `${baseUrl}/oauth/authorize?state=${state}`
		
		const cookieOptions = [
			'HttpOnly',
			'Secure',
			'SameSite=Lax',
			'Path=/',
			'Max-Age=86400' // 24 hours
		].join('; ')
		
		const response = Response.redirect(authorizeUrl, 302)
		response.headers.set('Set-Cookie', `lastfm_session=${sessionId}; ${cookieOptions}`)
		
		console.log('OAuth bridge: Redirecting back to OAuth flow with session')
		
		return response
		
	} catch (error) {
		console.error('Last.fm OAuth bridge callback error:', error)
		
		const errorMessage = error instanceof Error 
			? `Last.fm OAuth callback failed: ${error.message}`
			: 'Last.fm OAuth callback failed'
			
		return new Response(errorMessage, { status: 500 })
	}
}

/**
 * Get Last.fm user information for OAuth user context
 */
export async function getLastFmUserInfo(sessionKey: string, env: Env): Promise<{
	username: string
	realname?: string
	url?: string
	image?: string
} | null> {
	try {
		if (!env.LASTFM_API_KEY) {
			return null
		}
		
		// Call Last.fm API to get user info
		const apiUrl = new URL('https://ws.audioscrobbler.com/2.0/')
		apiUrl.searchParams.set('method', 'user.getInfo')
		apiUrl.searchParams.set('api_key', env.LASTFM_API_KEY)
		apiUrl.searchParams.set('sk', sessionKey)
		apiUrl.searchParams.set('format', 'json')
		
		const response = await fetch(apiUrl.toString())
		
		if (!response.ok) {
			console.error('Last.fm API error:', response.status, response.statusText)
			return null
		}
		
		const data = await response.json()
		
		if (data.error) {
			console.error('Last.fm API error:', data.error, data.message)
			return null
		}
		
		const user = data.user
		if (!user) {
			return null
		}
		
		return {
			username: user.name,
			realname: user.realname,
			url: user.url,
			image: user.image?.[user.image.length - 1]?.['#text'] // Get largest image
		}
		
	} catch (error) {
		console.error('Error fetching Last.fm user info:', error)
		return null
	}
}