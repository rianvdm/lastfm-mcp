/**
 * ABOUTME: Default handler for non-API requests in OAuth-enabled MCP server
 * ABOUTME: Handles OAuth flow endpoints, Last.fm bridge, health checks, and legacy compatibility
 */

import { handleLastFmOAuthLogin, handleLastFmOAuthCallback } from './lastfm-bridge'
import type { Env } from '../types/env'

/**
 * Handle non-API requests (OAuth endpoints, health checks, legacy endpoints)
 */
export async function handleNonAPIRequest(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url)
	
	// Add CORS headers for all responses
	const corsHeaders = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Connection-ID, Cookie',
	}

	// Handle CORS preflight requests
	if (request.method === 'OPTIONS') {
		return new Response(null, {
			status: 200,
			headers: {
				...corsHeaders,
				'Access-Control-Max-Age': '86400',
			},
		})
	}

	// Route based on pathname
	switch (url.pathname) {
		// Last.fm OAuth bridge endpoints
		case '/oauth/lastfm/login':
			if (request.method === 'GET') {
				return await handleLastFmOAuthLogin(request, env)
			}
			return new Response('Method not allowed', { status: 405, headers: corsHeaders })

		case '/oauth/lastfm/callback':
			if (request.method === 'GET') {
				return await handleLastFmOAuthCallback(request, env)
			}
			return new Response('Method not allowed', { status: 405, headers: corsHeaders })

		// Server information endpoint
		case '/':
			if (request.method === 'GET') {
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
							scopes: {
								'lastfm:read': 'Read access to listening data and music information',
								'lastfm:profile': 'Access to user profile information',
								'lastfm:recommendations': 'Access to music recommendations'
							}
						},
						endpoints: {
							'/sse': 'GET - Server-Sent Events endpoint (OAuth Bearer token required)',
							'/oauth/register': 'POST - Dynamic Client Registration',
							'/oauth/authorize': 'GET - OAuth Authorization',
							'/oauth/token': 'POST - OAuth Token Exchange',
							'/health': 'GET - Health check',
							// Legacy endpoints for backward compatibility
							'/login': 'GET - Legacy Last.fm authentication (deprecated)',
							'/callback': 'GET - Legacy Last.fm callback (deprecated)',
						},
						migration: {
							from_mcp_remote: {
								old_config: 'npx mcp-remote https://lastfm-mcp-prod.rian-db8.workers.dev/sse',
								new_config: 'Direct connection with OAuth to /sse endpoint'
							}
						}
					}),
					{
						status: 200,
						headers: {
							...corsHeaders,
							'Content-Type': 'application/json',
						},
					},
				)
			}
			return new Response('Method not allowed', { status: 405, headers: corsHeaders })

		// Health check endpoint
		case '/health':
			return new Response(
				JSON.stringify({
					status: 'ok',
					timestamp: new Date().toISOString(),
					version: '2.0.0',
					service: 'lastfm-mcp-oauth',
					authentication: 'oauth2',
					oauth_endpoints: {
						authorization: '/oauth/authorize',
						token: '/oauth/token',
						registration: '/oauth/register'
					}
				}),
				{
					status: 200,
					headers: {
						...corsHeaders,
						'Content-Type': 'application/json',
					},
				},
			)

		// Legacy endpoints for backward compatibility
		case '/login':
			return handleLegacyLogin(request, env, corsHeaders)

		case '/callback':
			return handleLegacyCallback(request, env, corsHeaders)

		case '/mcp-auth':
			return handleLegacyMCPAuth(request, env, corsHeaders)

		default:
			return new Response(
				JSON.stringify({
					error: 'Not found',
					message: `Endpoint ${url.pathname} not found`,
					available_endpoints: [
						'/sse',
						'/oauth/authorize',
						'/oauth/token', 
						'/oauth/register',
						'/health'
					]
				}),
				{ 
					status: 404,
					headers: {
						...corsHeaders,
						'Content-Type': 'application/json'
					}
				}
			)
	}
}

/**
 * Handle legacy login endpoint (deprecated)
 */
async function handleLegacyLogin(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	if (request.method !== 'GET') {
		return new Response('Method not allowed', { status: 405, headers: corsHeaders })
	}

	try {
		// Import legacy auth handler
		const { LastfmAuth } = await import('../auth/lastfm')
		
		if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
			return new Response('Authentication configuration error: Missing credentials', { 
				status: 500, 
				headers: corsHeaders 
			})
		}

		const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const url = new URL(request.url)
		const connectionId = url.searchParams.get('connection_id')
		const callbackUrl = `${url.protocol}//${url.host}/callback${connectionId ? `?connection_id=${connectionId}` : ''}`

		// Store connection ID temporarily for callback
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

		console.log('Legacy login: Redirecting to Last.fm', { connectionId })
		
		const authorizeUrl = auth.getAuthUrl(callbackUrl)
		return Response.redirect(authorizeUrl, 302)
		
	} catch (error) {
		console.error('Legacy login error:', error)
		return new Response(
			`Legacy authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 
			{ status: 500, headers: corsHeaders }
		)
	}
}

/**
 * Handle legacy callback endpoint (deprecated)
 */
async function handleLegacyCallback(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	if (request.method !== 'GET') {
		return new Response('Method not allowed', { status: 405, headers: corsHeaders })
	}

	try {
		const url = new URL(request.url)
		const token = url.searchParams.get('token')
		const connectionId = url.searchParams.get('connection_id')

		if (!token) {
			return new Response('Missing authentication token from Last.fm', { 
				status: 400, 
				headers: corsHeaders 
			})
		}

		if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
			return new Response('Authentication configuration error: Missing credentials', { 
				status: 500, 
				headers: corsHeaders 
			})
		}

		// Import legacy auth components
		const { LastfmAuth } = await import('../auth/lastfm')
		const { createSessionToken } = await import('../auth/jwt')
		const { authenticateConnection } = await import('../transport/sse')

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

		// Store legacy session
		if (env.MCP_SESSIONS && finalConnectionId !== 'unknown') {
			const sessionData = {
				token: sessionToken,
				userId: username,
				sessionKey,
				username,
				timestamp: Date.now(),
				expiresAt: Date.now() + 24 * 60 * 60 * 1000,
				connectionId: finalConnectionId,
				type: 'legacy'
			}

			await env.MCP_SESSIONS.put(`session:${finalConnectionId}`, JSON.stringify(sessionData), {
				expirationTtl: 7 * 24 * 60 * 60,
			})

			// Authenticate SSE connection if not mcp-remote
			if (!finalConnectionId.startsWith('mcp-remote-')) {
				authenticateConnection(finalConnectionId, username)
			}

			console.log('Legacy callback: Session stored for user', username)
		}

		const cookieOptions = [
			'HttpOnly',
			'Secure',
			'SameSite=Strict',
			'Path=/',
			'Max-Age=86400',
		].join('; ')

		const responseMessage = `Legacy authentication successful! Your Last.fm account (${username}) is now connected. 
		
Note: Legacy authentication is deprecated. Please migrate to OAuth 2.0 for better security and features.`

		return new Response(responseMessage, {
			status: 200,
			headers: {
				...corsHeaders,
				'Content-Type': 'text/plain',
				'Set-Cookie': `session=${sessionToken}; ${cookieOptions}`,
			},
		})
		
	} catch (error) {
		console.error('Legacy callback error:', error)
		return new Response(
			`Legacy authentication callback failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 
			{ status: 500, headers: corsHeaders }
		)
	}
}

/**
 * Handle legacy MCP auth endpoint (deprecated)
 */
async function handleLegacyMCPAuth(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	if (request.method !== 'GET') {
		return new Response('Method not allowed', { status: 405, headers: corsHeaders })
	}

	try {
		// Import legacy auth verification
		const { verifyAuthentication } = await import('../protocol/handlers')
		
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
							deprecated: true,
							migration_info: 'Please migrate to OAuth 2.0 authentication'
						}),
						{
							headers: {
								...corsHeaders,
								'Content-Type': 'application/json'
							}
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
				deprecated: true,
				migration_info: 'Legacy authentication is deprecated. Please migrate to OAuth 2.0.'
			}),
			{
				status: 401,
				headers: {
					...corsHeaders,
					'Content-Type': 'application/json'
				}
			}
		)
		
	} catch (error) {
		console.error('Legacy MCP auth error:', error)
		return new Response(
			JSON.stringify({
				error: 'Authentication check failed',
				deprecated: true
			}),
			{
				status: 500,
				headers: {
					...corsHeaders,
					'Content-Type': 'application/json'
				}
			}
		)
	}
}