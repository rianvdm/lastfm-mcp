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
					return handleAuthorization(request, env)
				
				case '/oauth/token':
					return handleTokenExchange(request, env)
				
				case '/oauth/lastfm/callback':
					return handleLastFmCallback(request, env)
				
				case '/sse':
					return handleProtectedEndpoint(request, env)
				
				case '/health':
					return handleHealth(request, env)
				
				case '/test-complete-flow':
					return handleTestCompleteFlow(request, env)
				
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
async function handleRoot(request: Request): Promise<Response> {
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

	// Validate client
	const clientData = await env.MCP_SESSIONS.get(`oauth:client:${clientId}`)
	if (!clientData) {
		return new Response(JSON.stringify({
			error: 'invalid_client',
			error_description: 'Client not found'
		}), {
			status: 400,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}

	const client = JSON.parse(clientData) as OAuthClient
	
	// Validate redirect URI
	if (!client.redirect_uris.includes(redirectUri)) {
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
		scope: scope
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
		const authorizeUrl = new URL(`${url.protocol}//${url.host}/oauth/authorize`)
		authorizeUrl.searchParams.set('response_type', 'code')
		authorizeUrl.searchParams.set('client_id', authRequest.client_id)
		authorizeUrl.searchParams.set('redirect_uri', authRequest.redirect_uri)
		if (authRequest.state) authorizeUrl.searchParams.set('state', authRequest.state)
		authorizeUrl.searchParams.set('scope', authRequest.scope)

		const response = Response.redirect(authorizeUrl.toString(), 302)
		response.headers.set('Set-Cookie', 
			`lastfm_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`
		)

		return response

	} catch (error) {
		console.error('Last.fm callback error:', error)
		return new Response(`Authentication failed: ${error.message}`, { status: 500 })
	}
}

/**
 * Token exchange endpoint
 */
async function handleTokenExchange(request: Request, env: Env): Promise<Response> {
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
 * Protected endpoint - requires Bearer token
 */
async function handleProtectedEndpoint(request: Request, env: Env): Promise<Response> {
	// Extract Bearer token
	const token = extractBearerToken(request)
	if (!token) {
		return new Response(JSON.stringify({
			error: 'unauthorized',
			error_description: 'Bearer token required'
		}), {
			status: 401,
			headers: corsHeaders({ 
				'Content-Type': 'application/json',
				'WWW-Authenticate': 'Bearer'
			})
		})
	}

	// Validate token
	const tokenData = await env.MCP_SESSIONS.get(`oauth:token:${token}`)
	if (!tokenData) {
		return new Response(JSON.stringify({
			error: 'invalid_token',
			error_description: 'Invalid or expired token'
		}), {
			status: 401,
			headers: corsHeaders({ 
				'Content-Type': 'application/json',
				'WWW-Authenticate': 'Bearer error="invalid_token"'
			})
		})
	}

	const accessToken = JSON.parse(tokenData) as AccessToken

	// Check token expiration
	if (Date.now() > accessToken.expires_at) {
		await env.MCP_SESSIONS.delete(`oauth:token:${token}`)
		return new Response(JSON.stringify({
			error: 'invalid_token',
			error_description: 'Token expired'
		}), {
			status: 401,
			headers: corsHeaders({ 
				'Content-Type': 'application/json',
				'WWW-Authenticate': 'Bearer error="invalid_token"'
			})
		})
	}

	// Handle different methods
	if (request.method === 'GET') {
		// Return endpoint information
		return new Response(JSON.stringify({
			message: 'Last.fm MCP Server - OAuth Protected',
			user: {
				id: accessToken.user_id,
				username: accessToken.username
			},
			scope: accessToken.scope,
			client_id: accessToken.client_id
		}), {
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}

	if (request.method === 'POST') {
		// Handle MCP JSON-RPC requests
		return handleMCPRequest(request, env, accessToken)
	}

	return new Response('Method Not Allowed', { 
		status: 405,
		headers: corsHeaders()
	})
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
		} catch (error) {
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
			body: JSON.stringify(jsonrpcRequest)
		})

		// Handle with MCP protocol
		const response = await handleMethod(jsonrpcRequest, modifiedRequest, env?.JWT_SECRET, env)

		// Clean up temporary session
		await env.MCP_SESSIONS.delete(`session:${oauthConnectionId}`)

		if (!response) {
			return new Response(null, {
				status: 204,
				headers: corsHeaders()
			})
		}

		return new Response(serializeResponse(response), {
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