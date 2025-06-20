/**
 * ABOUTME: Custom OAuth 2.0 implementation for Last.fm MCP Server
 * ABOUTME: Implements Dynamic Client Registration and authorization code flow without third-party dependencies
 */

import type { Env } from './types/env'
import { LastfmAuth } from './auth/lastfm'
import { parseMessage, createError, serializeResponse } from './protocol/parser'
import { handleMethod } from './protocol/handlers'
import { ErrorCode } from './types/jsonrpc'

interface OAuthClient {
	client_id: string
	client_secret: string
	client_name: string
	redirect_uris: string[]
	grant_types: string[]
	response_types: string[]
	scope: string
	created_at: number
}

interface AuthorizationCode {
	client_id: string
	user_id: string
	username: string
	lastfm_session_key: string
	scope: string
	redirect_uri: string
	code_challenge?: string
	code_challenge_method?: string
	expires_at: number
	created_at: number
}

interface AccessToken {
	token: string
	client_id: string
	user_id: string
	username: string
	lastfm_session_key: string
	scope: string
	expires_at: number
	created_at: number
}

/**
 * Generate a secure random string
 */
function generateSecureId(length: number = 16): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
	const randomValues = new Uint8Array(length)
	crypto.getRandomValues(randomValues)
	return Array.from(randomValues, byte => chars[byte % chars.length]).join('')
}

/**
 * Verify PKCE code challenge
 */
async function verifyPKCE(codeVerifier: string, codeChallenge: string, method: string): Promise<boolean> {
	if (method === 'plain') {
		return codeVerifier === codeChallenge
	} else if (method === 'S256') {
		const encoder = new TextEncoder()
		const data = encoder.encode(codeVerifier)
		const digest = await crypto.subtle.digest('SHA-256', data)
		const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
		// Convert to URL-safe base64
		const urlSafeBase64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
		return urlSafeBase64 === codeChallenge
	}
	return false
}

/**
 * Add CORS headers to response
 */
function corsHeaders(headers: HeadersInit = {}): HeadersInit {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Max-Age': '86400',
		...headers
	}
}

/**
 * Extract bearer token from Authorization header
 */
function extractBearerToken(request: Request): string | null {
	const authHeader = request.headers.get('Authorization')
	if (!authHeader?.startsWith('Bearer ')) {
		return null
	}
	return authHeader.substring(7)
}

/**
 * Extract cookie value
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

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url)

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 200,
				headers: corsHeaders()
			})
		}

		try {
			// Route to appropriate handler
			switch (url.pathname) {
				case '/':
					return handleRoot(request)
				
				case '/oauth/register':
					return handleClientRegistration(request, env)
				
				case '/oauth/authorize':
				case '/authorize': // Claude calls this endpoint
					return handleAuthorization(request, env)
				
				case '/oauth/token':
				case '/token': // Claude might call this endpoint too
					return handleTokenExchange(request, env)
				
				case '/.well-known/oauth-authorization-server':
					return handleWellKnownOAuth(request, env)
				
				case '/.well-known/oauth-protected-resource':
					return handleWellKnownProtectedResource(request, env)
				
				case '/oauth/lastfm/callback':
					return handleLastFmCallback(request, env)
				
				case '/sse':
					// Use the original working SSE endpoint logic
					if (request.method === 'GET') {
						const { createSSEResponse } = await import('./transport/sse')
						const { response } = createSSEResponse()
						return response
					} else if (request.method === 'POST') {
						// Handle JSON-RPC requests exactly like the original implementation
						const { handleMethod } = await import('./protocol/handlers')
						const { parseMessage, serializeResponse } = await import('./protocol/parser')
						
						try {
							const body = await request.text()
							const jsonrpcRequest = parseMessage(body)
							console.log('MCP Request:', jsonrpcRequest.method)
							
							const response = await handleMethod(jsonrpcRequest, request, env?.JWT_SECRET, env)
							
							if (!response) {
								return new Response(null, { status: 204 })
							}
							
							console.log('MCP Response for', jsonrpcRequest.method, ':', response.result ? 'has result' : 'no result')
							
							return new Response(serializeResponse(response), {
								headers: { 'Content-Type': 'application/json' }
							})
						} catch (error) {
							console.error('MCP request error:', error)
							return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 })
						}
					}
					return new Response('Method not allowed', { status: 405 })
				
				case '/health':
					return handleHealth(request, env)
				
				default:
					return new Response('Not Found', { 
						status: 404,
						headers: corsHeaders()
					})
			}
		} catch (error) {
			console.error('Server error:', error)
			return new Response(JSON.stringify({
				error: 'server_error',
				error_description: error instanceof Error ? error.message : 'Internal server error'
			}), {
				status: 500,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}
	}
}

/**
 * Root endpoint - API information
 */
async function handleRoot(_request: Request): Promise<Response> {
	return new Response(JSON.stringify({
		name: 'Last.fm MCP Server - Custom OAuth',
		version: '2.0.0-custom',
		description: 'OAuth 2.0 server with Dynamic Client Registration for Last.fm MCP',
		endpoints: {
			authorization: '/oauth/authorize',
			token: '/oauth/token',
			registration: '/oauth/register',
			protected: '/sse'
		},
		oauth: {
			grant_types_supported: ['authorization_code'],
			response_types_supported: ['code'],
			scopes_supported: ['lastfm:read', 'lastfm:profile', 'lastfm:recommendations'],
			token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post']
		}
	}), {
		headers: corsHeaders({ 'Content-Type': 'application/json' })
	})
}

/**
 * OAuth Authorization Server Metadata (RFC 8414)
 */
async function handleWellKnownOAuth(request: Request, _env: Env): Promise<Response> {
	const baseUrl = new URL(request.url).origin
	
	return new Response(JSON.stringify({
		issuer: baseUrl,
		authorization_endpoint: `${baseUrl}/authorize`,
		token_endpoint: `${baseUrl}/token`,
		registration_endpoint: `${baseUrl}/oauth/register`,
		scopes_supported: ['lastfm:read', 'lastfm:profile', 'lastfm:recommendations', 'claudeai'],
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code'],
		token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
		code_challenge_methods_supported: ['S256', 'plain']
	}), {
		headers: corsHeaders({ 'Content-Type': 'application/json' })
	})
}

/**
 * OAuth Protected Resource Metadata (RFC 8693)
 */
async function handleWellKnownProtectedResource(request: Request, _env: Env): Promise<Response> {
	const baseUrl = new URL(request.url).origin
	
	return new Response(JSON.stringify({
		resource: `${baseUrl}/sse`,
		resource_documentation: `${baseUrl}/`,
		resource_schemas_supported: ["lastfm-mcp"],
		authorization_servers: [`${baseUrl}`],
		bearer_methods_supported: ["header"],
		resource_signing_alg_values_supported: ["RS256"]
	}), {
		headers: corsHeaders({ 'Content-Type': 'application/json' })
	})
}

/**
 * Health check endpoint
 */
async function handleHealth(request: Request, env: Env): Promise<Response> {
	return new Response(JSON.stringify({
		status: 'healthy',
		timestamp: new Date().toISOString(),
		oauth: 'custom',
		lastfm_configured: !!(env.LASTFM_API_KEY && env.LASTFM_SHARED_SECRET)
	}), {
		headers: corsHeaders({ 'Content-Type': 'application/json' })
	})
}

/**
 * Dynamic Client Registration endpoint
 */
async function handleClientRegistration(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response('Method Not Allowed', { 
			status: 405,
			headers: corsHeaders()
		})
	}

	try {
		const body = await request.json() as any
		
		// Validate required fields
		if (!body.client_name || !body.redirect_uris || !Array.isArray(body.redirect_uris)) {
			return new Response(JSON.stringify({
				error: 'invalid_client_metadata',
				error_description: 'client_name and redirect_uris are required'
			}), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		// Generate client credentials
		const client: OAuthClient = {
			client_id: generateSecureId(),
			client_secret: generateSecureId(32),
			client_name: body.client_name,
			redirect_uris: body.redirect_uris,
			grant_types: body.grant_types || ['authorization_code'],
			response_types: body.response_types || ['code'],
			scope: body.scope || 'lastfm:read',
			created_at: Date.now()
		}

		// Store client in KV
		await env.MCP_SESSIONS.put(
			`oauth:client:${client.client_id}`,
			JSON.stringify(client),
			{ expirationTtl: 365 * 24 * 60 * 60 } // 1 year
		)

		// Return client information
		const response = {
			client_id: client.client_id,
			client_secret: client.client_secret,
			client_name: client.client_name,
			redirect_uris: client.redirect_uris,
			grant_types: client.grant_types,
			response_types: client.response_types,
			token_endpoint_auth_method: 'client_secret_basic',
			registration_client_uri: `/oauth/register/${client.client_id}`,
			client_id_issued_at: Math.floor(client.created_at / 1000)
		}

		console.log('Client registered:', client.client_id)

		return new Response(JSON.stringify(response), {
			status: 201,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})

	} catch (error) {
		console.error('Client registration error:', error)
		return new Response(JSON.stringify({
			error: 'invalid_request',
			error_description: 'Invalid request body'
		}), {
			status: 400,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}
}

/**
 * Authorization endpoint
 */
async function handleAuthorization(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'GET') {
		return new Response('Method Not Allowed', { 
			status: 405,
			headers: corsHeaders()
		})
	}

	const url = new URL(request.url)
	const clientId = url.searchParams.get('client_id')
	const redirectUri = url.searchParams.get('redirect_uri')
	const responseType = url.searchParams.get('response_type')
	const state = url.searchParams.get('state')
	const scope = url.searchParams.get('scope') || 'lastfm:read'
	const codeChallenge = url.searchParams.get('code_challenge')
	const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'plain'

	// Validate required parameters
	if (!clientId || !redirectUri || responseType !== 'code') {
		return new Response(JSON.stringify({
			error: 'invalid_request',
			error_description: 'Missing or invalid required parameters'
		}), {
			status: 400,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}

	// Validate client - auto-register Claude clients
	const clientData = await env.MCP_SESSIONS.get(`oauth:client:${clientId}`)
	let client: OAuthClient
	
	if (!clientData) {
		// Auto-register Claude clients based on redirect_uri
		if (redirectUri.startsWith('https://claude.ai/')) {
			console.log('Auto-registering Claude client:', clientId)
			
			client = {
				client_id: clientId,
				client_secret: generateSecureId(32), // Claude doesn't use client_secret for PKCE
				client_name: 'Claude Desktop Auto-Registered',
				redirect_uris: [redirectUri],
				grant_types: ['authorization_code'],
				response_types: ['code'],
				scope: 'lastfm:read lastfm:profile lastfm:recommendations claudeai',
				created_at: Date.now()
			}
			
			// Store auto-registered client
			await env.MCP_SESSIONS.put(
				`oauth:client:${clientId}`,
				JSON.stringify(client),
				{ expirationTtl: 365 * 24 * 60 * 60 } // 1 year
			)
		} else {
			return new Response(JSON.stringify({
				error: 'invalid_client',
				error_description: 'Client not found'
			}), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}
	} else {
		client = JSON.parse(clientData) as OAuthClient
	}
	
	// Validate redirect URI - be flexible for Claude auto-registered clients
	const isValidRedirectUri = client.redirect_uris.includes(redirectUri) || 
		(redirectUri.startsWith('https://claude.ai/') && client.client_name === 'Claude Desktop Auto-Registered')
	
	if (!isValidRedirectUri) {
		return new Response(JSON.stringify({
			error: 'invalid_request',
			error_description: 'Invalid redirect_uri'
		}), {
			status: 400,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}

	// Check if user is already authenticated with Last.fm
	const sessionCookie = getCookie(request, 'lastfm_session')
	if (sessionCookie) {
		const sessionData = await env.MCP_SESSIONS.get(`session:lastfm:${sessionCookie}`)
		if (sessionData) {
			const session = JSON.parse(sessionData)
			console.log('User already authenticated:', session.username)
			
			// Generate authorization code
			const authCode = generateSecureId(32)
			
			// Store authorization code
			const codeData: AuthorizationCode = {
				client_id: clientId,
				user_id: session.username,
				username: session.username,
				lastfm_session_key: session.sessionKey,
				scope: scope,
				redirect_uri: redirectUri,
				code_challenge: codeChallenge,
				code_challenge_method: codeChallengeMethod,
				expires_at: Date.now() + (10 * 60 * 1000), // 10 minutes
				created_at: Date.now()
			}
			
			await env.MCP_SESSIONS.put(
				`oauth:code:${authCode}`,
				JSON.stringify(codeData),
				{ expirationTtl: 600 } // 10 minutes
			)
			
			// Redirect with authorization code
			const redirectUrl = new URL(redirectUri)
			redirectUrl.searchParams.set('code', authCode)
			if (state) redirectUrl.searchParams.set('state', state)
			
			console.log('Authorization code generated:', authCode.substring(0, 8) + '...')
			return Response.redirect(redirectUrl.toString(), 302)
		}
	}

	// User not authenticated - redirect to Last.fm
	if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
		const errorUrl = new URL(redirectUri)
		errorUrl.searchParams.set('error', 'server_error')
		errorUrl.searchParams.set('error_description', 'Last.fm not configured')
		if (state) errorUrl.searchParams.set('state', state)
		return Response.redirect(errorUrl.toString(), 302)
	}

	// Store OAuth request for callback
	const authRequest = {
		client_id: clientId,
		redirect_uri: redirectUri,
		state: state,
		scope: scope,
		code_challenge: codeChallenge,
		code_challenge_method: codeChallengeMethod
	}
	
	await env.MCP_SESSIONS.put(
		`oauth:request:${state || 'default'}`,
		JSON.stringify(authRequest),
		{ expirationTtl: 600 } // 10 minutes
	)

	// Redirect to Last.fm authentication
	const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
	const callbackUrl = `${url.protocol}//${url.host}/oauth/lastfm/callback?state=${state || 'default'}`
	const lastfmAuthUrl = auth.getAuthUrl(callbackUrl)
	
	console.log('Redirecting to Last.fm auth')
	return Response.redirect(lastfmAuthUrl, 302)
}

/**
 * Last.fm callback handler
 */
async function handleLastFmCallback(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url)
	const token = url.searchParams.get('token')
	const state = url.searchParams.get('state') || 'default'

	if (!token) {
		return new Response('Missing Last.fm token', { status: 400 })
	}

	try {
		// Get stored OAuth request
		const authRequestData = await env.MCP_SESSIONS.get(`oauth:request:${state}`)
		if (!authRequestData) {
			return new Response('Invalid or expired state', { status: 400 })
		}

		const authRequest = JSON.parse(authRequestData)
		await env.MCP_SESSIONS.delete(`oauth:request:${state}`)

		// Exchange Last.fm token for session
		const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const { sessionKey, username } = await auth.getSessionKey(token)

		console.log('Last.fm authentication successful:', username)

		// Store Last.fm session
		const sessionId = generateSecureId()
		await env.MCP_SESSIONS.put(
			`session:lastfm:${sessionId}`,
			JSON.stringify({
				username,
				sessionKey,
				created_at: Date.now()
			}),
			{ expirationTtl: 24 * 60 * 60 } // 24 hours
		)

		// Redirect back to authorization endpoint with session cookie
		const authorizeUrl = new URL(`${url.protocol}//${url.host}/authorize`)
		authorizeUrl.searchParams.set('response_type', 'code')
		authorizeUrl.searchParams.set('client_id', authRequest.client_id)
		authorizeUrl.searchParams.set('redirect_uri', authRequest.redirect_uri)
		if (authRequest.state) authorizeUrl.searchParams.set('state', authRequest.state)
		authorizeUrl.searchParams.set('scope', authRequest.scope)
		if (authRequest.code_challenge) {
			authorizeUrl.searchParams.set('code_challenge', authRequest.code_challenge)
			authorizeUrl.searchParams.set('code_challenge_method', authRequest.code_challenge_method || 'plain')
		}

		return new Response(null, {
			status: 302,
			headers: {
				'Location': authorizeUrl.toString(),
				'Set-Cookie': `lastfm_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`
			}
		})

	} catch (error) {
		console.error('Last.fm callback error:', error)
		return new Response(`Authentication failed: ${error.message}`, { status: 500 })
	}
}

/**
 * Token exchange endpoint
 */
async function handleTokenExchange(request: Request, env: Env): Promise<Response> {
	console.log('Token exchange endpoint called')
	
	if (request.method !== 'POST') {
		return new Response('Method Not Allowed', { 
			status: 405,
			headers: corsHeaders()
		})
	}

	try {
		// Parse form data
		const formData = await request.formData()
		const grantType = formData.get('grant_type')
		const code = formData.get('code')
		const clientId = formData.get('client_id')
		const clientSecret = formData.get('client_secret')
		const redirectUri = formData.get('redirect_uri')
		const codeVerifier = formData.get('code_verifier')
		
		console.log('Token exchange params:', {
			grantType,
			code: code?.toString().substring(0, 8) + '...',
			clientId,
			redirectUri,
			hasCodeVerifier: !!codeVerifier
		})

		// Validate grant type
		if (grantType !== 'authorization_code') {
			return new Response(JSON.stringify({
				error: 'unsupported_grant_type',
				error_description: 'Only authorization_code grant type is supported'
			}), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		// Validate required parameters
		if (!code || !clientId || !clientSecret || !redirectUri) {
			return new Response(JSON.stringify({
				error: 'invalid_request',
				error_description: 'Missing required parameters'
			}), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		// Validate client credentials
		const clientData = await env.MCP_SESSIONS.get(`oauth:client:${clientId}`)
		if (!clientData) {
			return new Response(JSON.stringify({
				error: 'invalid_client',
				error_description: 'Client authentication failed'
			}), {
				status: 401,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		const client = JSON.parse(clientData) as OAuthClient
		if (client.client_secret !== clientSecret) {
			return new Response(JSON.stringify({
				error: 'invalid_client',
				error_description: 'Client authentication failed'
			}), {
				status: 401,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		// Validate authorization code
		const codeData = await env.MCP_SESSIONS.get(`oauth:code:${code}`)
		if (!codeData) {
			return new Response(JSON.stringify({
				error: 'invalid_grant',
				error_description: 'Invalid authorization code'
			}), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		const authCode = JSON.parse(codeData) as AuthorizationCode

		// Validate code hasn't expired
		if (Date.now() > authCode.expires_at) {
			await env.MCP_SESSIONS.delete(`oauth:code:${code}`)
			return new Response(JSON.stringify({
				error: 'invalid_grant',
				error_description: 'Authorization code expired'
			}), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		// Validate code matches client and redirect URI
		if (authCode.client_id !== clientId || authCode.redirect_uri !== redirectUri) {
			return new Response(JSON.stringify({
				error: 'invalid_grant',
				error_description: 'Authorization code validation failed'
			}), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		// Verify PKCE if code challenge was provided
		if (authCode.code_challenge) {
			if (!codeVerifier) {
				return new Response(JSON.stringify({
					error: 'invalid_request',
					error_description: 'code_verifier required for PKCE'
				}), {
					status: 400,
					headers: corsHeaders({ 'Content-Type': 'application/json' })
				})
			}

			const pkceValid = await verifyPKCE(
				codeVerifier as string,
				authCode.code_challenge,
				authCode.code_challenge_method || 'plain'
			)

			if (!pkceValid) {
				return new Response(JSON.stringify({
					error: 'invalid_grant',
					error_description: 'PKCE verification failed'
				}), {
					status: 400,
					headers: corsHeaders({ 'Content-Type': 'application/json' })
				})
			}
		}

		// Delete used authorization code
		await env.MCP_SESSIONS.delete(`oauth:code:${code}`)

		// Generate access token
		const accessToken = generateSecureId(32)
		const tokenData: AccessToken = {
			token: accessToken,
			client_id: clientId,
			user_id: authCode.user_id,
			username: authCode.username,
			lastfm_session_key: authCode.lastfm_session_key,
			scope: authCode.scope,
			expires_at: Date.now() + (3600 * 1000), // 1 hour
			created_at: Date.now()
		}

		// Store access token
		await env.MCP_SESSIONS.put(
			`oauth:token:${accessToken}`,
			JSON.stringify(tokenData),
			{ expirationTtl: 3600 } // 1 hour
		)

		// Return token response
		const response = {
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: 3600,
			scope: authCode.scope
		}

		console.log('Access token issued for user:', authCode.username)
		console.log('Token response:', JSON.stringify(response, null, 2))

		return new Response(JSON.stringify(response), {
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})

	} catch (error) {
		console.error('Token exchange error:', error)
		return new Response(JSON.stringify({
			error: 'server_error',
			error_description: 'Token exchange failed'
		}), {
			status: 500,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}
}

/**
 * SSE endpoint - simplified to work like the original
 */
async function handleSSEEndpoint(request: Request, env: Env): Promise<Response> {
	console.log('SSE endpoint called, method:', request.method)
	
	if (request.method === 'GET') {
		// Create SSE connection using the original transport
		console.log('Creating SSE connection')
		const { createSSEResponse, authenticateConnection } = await import('./transport/sse')
		const { response, connectionId } = createSSEResponse()
		
		// For OAuth users, we need to pre-authenticate the connection
		// Check if this is an OAuth-authenticated request context
		// For now, let's assume OAuth users are pre-authenticated
		console.log('Pre-authenticating connection for OAuth user')
		
		// We'll handle authentication through the POST requests instead
		console.log('SSE connection established:', connectionId)
		return response
	}
	
	if (request.method === 'POST') {
		// Handle JSON-RPC requests using the original MCP handler
		console.log('Handling JSON-RPC request')
		const { handleMethod } = await import('./protocol/handlers')
		const { parseMessage, serializeResponse } = await import('./protocol/parser')
		
		try {
			const body = await request.text()
			const jsonrpcRequest = parseMessage(body)
			console.log('Processing MCP request:', jsonrpcRequest.method)
			
			if (jsonrpcRequest.method === 'tools/list') {
				console.log('Tools list requested!')
			}
			
			const response = await handleMethod(jsonrpcRequest, request, env?.JWT_SECRET, env)
			
			if (!response) {
				console.log('No response from handleMethod')
				return new Response(null, { status: 204, headers: corsHeaders() })
			}
			
			console.log('MCP Response:', JSON.stringify(response, null, 2))
			
			return new Response(serializeResponse(response), {
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		} catch (error) {
			console.error('MCP request error:', error)
			return new Response(JSON.stringify({
				error: 'internal_error',
				error_description: 'Failed to process MCP request'
			}), {
				status: 500,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}
	}
	
	return new Response('Method Not Allowed', { 
		status: 405,
		headers: corsHeaders()
	})
}

/**
 * Protected endpoint - handles both SSE connections and JSON-RPC
 */
async function handleProtectedEndpoint(request: Request, env: Env): Promise<Response> {
	console.log('handleProtectedEndpoint called, method:', request.method)
	
	if (request.method === 'GET') {
		// GET requests for SSE connections - check for Bearer token but don't require it
		const token = extractBearerToken(request)
		console.log('Bearer token present for SSE:', !!token)
		
		if (token) {
			// If Bearer token is provided, validate and use it
			const tokenData = await env.MCP_SESSIONS.get(`oauth:token:${token}`)
			if (tokenData) {
				const accessToken = JSON.parse(tokenData) as AccessToken
				console.log('Creating authenticated SSE connection for user:', accessToken.username)
				return handleSSEConnection(request, env, accessToken)
			}
		}
		
		// No valid Bearer token - create unauthenticated SSE connection
		console.log('Creating unauthenticated SSE connection')
		const { createSSEResponse } = await import('./transport/sse')
		const { response } = createSSEResponse()
		return response
	}

	if (request.method === 'POST') {
		// POST requests for JSON-RPC - try Bearer token first, then connection context
		const token = extractBearerToken(request)
		console.log('Bearer token present for JSON-RPC:', !!token)
		
		if (token) {
			// Use Bearer token authentication
			const tokenData = await env.MCP_SESSIONS.get(`oauth:token:${token}`)
			if (tokenData) {
				const accessToken = JSON.parse(tokenData) as AccessToken
				console.log('Handling MCP POST request with Bearer token for user:', accessToken.username)
				return handleMCPRequest(request, env, accessToken)
			}
		}
		
		// Fall back to existing MCP request handling (for connection-based auth)
		console.log('Falling back to connection-based authentication')
		const { handleMethod } = await import('./protocol/handlers')
		const { parseMessage } = await import('./protocol/parser')
		
		try {
			const body = await request.text()
			const jsonrpcRequest = parseMessage(body)
			const response = await handleMethod(jsonrpcRequest, request, env?.JWT_SECRET, env)
			
			if (!response) {
				return new Response(null, { status: 204, headers: corsHeaders() })
			}
			
			const { serializeResponse } = await import('./protocol/parser')
			return new Response(serializeResponse(response), {
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		} catch (error) {
			console.error('MCP request error:', error)
			return new Response(JSON.stringify({
				error: 'internal_error',
				error_description: 'Failed to process MCP request'
			}), {
				status: 500,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}
	}

	return new Response('Method Not Allowed', { 
		status: 405,
		headers: corsHeaders()
	})
}

/**
 * Handle SSE connection with OAuth authentication
 */
async function handleSSEConnection(request: Request, env: Env, tokenData: AccessToken): Promise<Response> {
	console.log('Setting up SSE connection for user:', tokenData.username)
	
	// Import the SSE transport
	const { createSSEResponse } = await import('./transport/sse')
	
	// Create SSE response
	const { response, connectionId } = createSSEResponse()
	
	// Store OAuth session for this SSE connection
	const sessionPayload = {
		userId: tokenData.user_id,
		username: tokenData.username,
		sessionKey: tokenData.lastfm_session_key,
		iat: Math.floor(tokenData.created_at / 1000),
		exp: Math.floor(tokenData.expires_at / 1000),
		expiresAt: new Date(tokenData.expires_at).toISOString(),
		source: 'oauth'
	}
	
	await env.MCP_SESSIONS.put(
		`session:${connectionId}`,
		JSON.stringify(sessionPayload),
		{ expirationTtl: 3600 }
	)
	
	console.log('SSE connection established with ID:', connectionId)
	return response
}

/**
 * Handle MCP JSON-RPC requests with OAuth context
 */
async function handleMCPRequest(request: Request, env: Env, tokenData: AccessToken): Promise<Response> {
	try {
		// Parse request body
		const body = await request.text()
		if (!body) {
			const errorResponse = createError(null, ErrorCode.InvalidRequest, 'Empty request body')
			return new Response(serializeResponse(errorResponse), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		// Parse JSON-RPC message
		let jsonrpcRequest
		try {
			jsonrpcRequest = parseMessage(body)
			console.log('MCP Request:', JSON.stringify(jsonrpcRequest, null, 2))
		} catch (error) {
			console.error('Failed to parse JSON-RPC request:', error)
			const errorResponse = createError(null, ErrorCode.ParseError, 'Invalid JSON-RPC request')
			return new Response(serializeResponse(errorResponse), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		// Create OAuth session context for MCP handlers
		const oauthConnectionId = `oauth-${tokenData.user_id}`
		const modifiedHeaders = new Headers(request.headers)
		modifiedHeaders.set('X-Connection-ID', oauthConnectionId)

		// Store OAuth session in the exact format expected by MCP handlers (SessionPayload)
		const sessionPayload = {
			userId: tokenData.user_id,
			username: tokenData.username,
			sessionKey: tokenData.lastfm_session_key,
			iat: Math.floor(tokenData.created_at / 1000),
			exp: Math.floor(tokenData.expires_at / 1000),
			// Additional fields for compatibility
			expiresAt: new Date(tokenData.expires_at).toISOString(),
			source: 'oauth'
		}
		
		await env.MCP_SESSIONS.put(
			`session:${oauthConnectionId}`,
			JSON.stringify(sessionPayload),
			{ expirationTtl: 3600 }
		)

		const modifiedRequest = new Request(request.url, {
			method: request.method,
			headers: modifiedHeaders,
			body: body
		})

		// Handle with MCP protocol
		const response = await handleMethod(jsonrpcRequest, modifiedRequest, env?.JWT_SECRET, env)
		
		console.log('MCP Response:', response ? JSON.stringify(response, null, 2) : 'null')

		// Clean up temporary session
		await env.MCP_SESSIONS.delete(`session:${oauthConnectionId}`)

		if (!response) {
			console.log('No response from handleMethod')
			return new Response(null, {
				status: 204,
				headers: corsHeaders()
			})
		}

		const serializedResponse = serializeResponse(response)
		console.log('Serialized Response:', serializedResponse)
		
		return new Response(serializedResponse, {
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})

	} catch (error) {
		console.error('MCP request error:', error)
		const errorResponse = createError(null, ErrorCode.InternalError, 'Internal server error')
		return new Response(serializeResponse(errorResponse), {
			status: 500,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}
}