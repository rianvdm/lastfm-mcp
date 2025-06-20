/**
 * ABOUTME: Clean OAuth 2.0 implementation for Last.fm MCP Server - Claude Desktop native integration
 * ABOUTME: Pure OAuth flow without mcp-remote compatibility or JWT fallbacks
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
					console.log('Root endpoint called:', request.method, 'Bearer token:', !!extractBearerToken(request))
					if (request.method === 'GET') {
						return handleRoot()
					} else if (request.method === 'POST') {
						// Also handle MCP requests at root endpoint for compatibility
						return handleOAuthMCP(request, env)
					}
					break
				
				case '/oauth/register':
					return handleClientRegistration(request, env)
				
				case '/oauth/authorize':
				case '/authorize':
					return handleAuthorization(request, env)
				
				case '/oauth/token':
				case '/token':
					return handleTokenExchange(request, env)
				
				case '/.well-known/oauth-authorization-server':
					return handleWellKnownOAuth(request)
				
				case '/oauth/lastfm/callback':
					return handleLastFmCallback(request, env)
				
				case '/sse':
					// Pure OAuth-protected endpoint
					console.log('SSE endpoint called:', request.method, 'Bearer token:', !!extractBearerToken(request))
					if (request.method === 'GET') {
						return handleOAuthSSE(request, env)
					} else if (request.method === 'POST') {
						return handleOAuthMCP(request, env)
					}
					break
				
				case '/health':
					return handleHealth()
				
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
				error_description: 'Internal server error'
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
function handleRoot(): Response {
	return new Response(JSON.stringify({
		name: 'Last.fm MCP Server',
		version: '3.0.0-oauth',
		description: 'Model Context Protocol server for Last.fm listening data access with OAuth 2.0',
		endpoints: {
			'/': 'POST - MCP JSON-RPC endpoint (OAuth protected)',
			'/sse': 'GET - Server-Sent Events endpoint (OAuth protected)',
			'/oauth/authorize': 'GET - OAuth authorization',
			'/oauth/token': 'POST - OAuth token exchange',
			'/oauth/register': 'POST - OAuth client registration',
			'/health': 'GET - Health check'
		},
		oauth: {
			grant_types_supported: ['authorization_code'],
			response_types_supported: ['code'],
			scopes_supported: ['lastfm:read', 'lastfm:profile'],
			token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post']
		},
		mcp: {
			protocol_version: '2024-11-05',
			capabilities: ['tools', 'resources', 'prompts']
		}
	}), {
		headers: corsHeaders({ 'Content-Type': 'application/json' })
	})
}

/**
 * OAuth Authorization Server Metadata (RFC 8414)
 */
function handleWellKnownOAuth(request: Request): Response {
	const baseUrl = new URL(request.url).origin
	
	return new Response(JSON.stringify({
		issuer: baseUrl,
		authorization_endpoint: `${baseUrl}/oauth/authorize`,
		token_endpoint: `${baseUrl}/oauth/token`,
		registration_endpoint: `${baseUrl}/oauth/register`,
		scopes_supported: ['lastfm:read', 'lastfm:profile'],
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code'],
		token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
		code_challenge_methods_supported: ['S256', 'plain']
	}), {
		headers: corsHeaders({ 'Content-Type': 'application/json' })
	})
}

/**
 * Health endpoint
 */
function handleHealth(): Response {
	return new Response(JSON.stringify({
		status: 'healthy',
		timestamp: new Date().toISOString(),
		oauth: 'clean',
		version: '3.0.0-clean'
	}), {
		headers: corsHeaders({ 'Content-Type': 'application/json' })
	})
}

/**
 * Dynamic Client Registration (RFC 7591)
 */
async function handleClientRegistration(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response('Method Not Allowed', { 
			status: 405,
			headers: corsHeaders()
		})
	}

	try {
		const clientData = await request.json() as any
		
		if (!clientData.client_name || !clientData.redirect_uris || !Array.isArray(clientData.redirect_uris)) {
			return new Response(JSON.stringify({
				error: 'invalid_client_metadata',
				error_description: 'client_name and redirect_uris are required'
			}), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		const client: OAuthClient = {
			client_id: generateSecureId(16),
			client_secret: generateSecureId(32),
			client_name: clientData.client_name,
			redirect_uris: clientData.redirect_uris,
			grant_types: ['authorization_code'],
			response_types: ['code'],
			scope: 'lastfm:read lastfm:profile',
			created_at: Date.now()
		}

		// Store client
		await env.MCP_SESSIONS.put(
			`oauth:client:${client.client_id}`,
			JSON.stringify(client),
			{ expirationTtl: 365 * 24 * 60 * 60 } // 1 year
		)

		console.log('Client registered:', client.client_id, 'for', client.client_name)

		return new Response(JSON.stringify({
			client_id: client.client_id,
			client_secret: client.client_secret,
			client_name: client.client_name,
			redirect_uris: client.redirect_uris,
			grant_types: client.grant_types,
			response_types: client.response_types,
			token_endpoint_auth_method: 'client_secret_basic',
			client_id_issued_at: Math.floor(client.created_at / 1000)
		}), {
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})

	} catch (error) {
		console.error('Client registration error:', error)
		return new Response(JSON.stringify({
			error: 'server_error',
			error_description: 'Client registration failed'
		}), {
			status: 500,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}
}

/**
 * OAuth Authorization Endpoint
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
	const scope = url.searchParams.get('scope') || 'lastfm:read'
	const state = url.searchParams.get('state') || 'default'

	if (!clientId || !redirectUri || responseType !== 'code') {
		return new Response(JSON.stringify({
			error: 'invalid_request',
			error_description: 'Missing or invalid parameters'
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

	const client: OAuthClient = JSON.parse(clientData)
	if (!client.redirect_uris.includes(redirectUri)) {
		return new Response(JSON.stringify({
			error: 'invalid_request',
			error_description: 'Invalid redirect URI'
		}), {
			status: 400,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}

	// Store authorization request
	await env.MCP_SESSIONS.put(
		`oauth:auth:${state}`,
		JSON.stringify({
			client_id: clientId,
			redirect_uri: redirectUri,
			scope: scope,
			state: state,
			created_at: Date.now()
		}),
		{ expirationTtl: 600 } // 10 minutes
	)

	// Redirect to Last.fm authentication
	const lastfmAuth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
	const callbackUrl = `${url.origin}/oauth/lastfm/callback?state=${state}`
	const lastfmUrl = lastfmAuth.getAuthUrl(callbackUrl)

	console.log('Redirecting to Last.fm auth for client:', clientId)
	return Response.redirect(lastfmUrl, 302)
}

/**
 * Last.fm Authentication Callback
 */
async function handleLastFmCallback(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url)
	const token = url.searchParams.get('token')
	const state = url.searchParams.get('state') || 'default'

	if (!token) {
		return new Response('Missing Last.fm token', { status: 400 })
	}

	// Get authorization request
	const authData = await env.MCP_SESSIONS.get(`oauth:auth:${state}`)
	if (!authData) {
		return new Response('Invalid or expired state', { status: 400 })
	}

	const authRequest = JSON.parse(authData)

	try {
		// Exchange Last.fm token for session
		const lastfmAuth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const { sessionKey, username } = await lastfmAuth.getSessionKey(token)

		// Create authorization code
		const code = generateSecureId(32)
		const authCode: AuthorizationCode = {
			client_id: authRequest.client_id,
			user_id: username,
			username: username,
			lastfm_session_key: sessionKey,
			scope: authRequest.scope,
			redirect_uri: authRequest.redirect_uri,
			expires_at: Date.now() + 600000, // 10 minutes
			created_at: Date.now()
		}

		// Store authorization code
		await env.MCP_SESSIONS.put(
			`oauth:code:${code}`,
			JSON.stringify(authCode),
			{ expirationTtl: 600 } // 10 minutes
		)

		// Redirect back to client with authorization code
		const redirectUrl = new URL(authRequest.redirect_uri)
		redirectUrl.searchParams.set('code', code)
		redirectUrl.searchParams.set('state', state)

		console.log('Last.fm auth successful for user:', username, 'redirecting to:', redirectUrl.toString())
		return Response.redirect(redirectUrl.toString(), 302)

	} catch (error) {
		console.error('Last.fm callback error:', error)
		const redirectUrl = new URL(authRequest.redirect_uri)
		redirectUrl.searchParams.set('error', 'access_denied')
		redirectUrl.searchParams.set('state', state)
		return Response.redirect(redirectUrl.toString(), 302)
	}
}

/**
 * OAuth Token Exchange Endpoint
 */
async function handleTokenExchange(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response('Method Not Allowed', { 
			status: 405,
			headers: corsHeaders()
		})
	}

	try {
		const body = await request.formData()
		const grantType = body.get('grant_type')
		const code = body.get('code')
		const redirectUri = body.get('redirect_uri')
		const clientId = body.get('client_id')
		const clientSecret = body.get('client_secret')

		if (grantType !== 'authorization_code' || !code || !redirectUri || !clientId || !clientSecret) {
			return new Response(JSON.stringify({
				error: 'invalid_request',
				error_description: 'Missing required parameters'
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
				error_description: 'Invalid client credentials'
			}), {
				status: 401,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		const client: OAuthClient = JSON.parse(clientData)
		if (client.client_secret !== clientSecret) {
			return new Response(JSON.stringify({
				error: 'invalid_client',
				error_description: 'Invalid client credentials'
			}), {
				status: 401,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		// Get authorization code
		const authCodeData = await env.MCP_SESSIONS.get(`oauth:code:${code}`)
		if (!authCodeData) {
			return new Response(JSON.stringify({
				error: 'invalid_grant',
				error_description: 'Invalid or expired authorization code'
			}), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		const authCode: AuthorizationCode = JSON.parse(authCodeData)

		// Validate authorization code
		if (authCode.client_id !== clientId || authCode.redirect_uri !== redirectUri) {
			return new Response(JSON.stringify({
				error: 'invalid_grant',
				error_description: 'Authorization code mismatch'
			}), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		if (Date.now() > authCode.expires_at) {
			return new Response(JSON.stringify({
				error: 'invalid_grant',
				error_description: 'Authorization code expired'
			}), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		// Create access token
		const accessToken = generateSecureId(32)
		const tokenData: AccessToken = {
			token: accessToken,
			client_id: clientId,
			user_id: authCode.username,
			username: authCode.username,
			lastfm_session_key: authCode.lastfm_session_key,
			scope: authCode.scope,
			expires_at: Date.now() + 3600000, // 1 hour
			created_at: Date.now()
		}

		// Store access token
		await env.MCP_SESSIONS.put(
			`oauth:token:${accessToken}`,
			JSON.stringify(tokenData),
			{ expirationTtl: 3600 } // 1 hour
		)

		// Also store as "latest" for Claude Desktop fallback
		await env.MCP_SESSIONS.put(
			`oauth:latest:${clientId}`,
			JSON.stringify(tokenData),
			{ expirationTtl: 3600 } // 1 hour
		)

		// Delete authorization code (one-time use)
		await env.MCP_SESSIONS.delete(`oauth:code:${code}`)

		console.log('Access token issued for user:', authCode.username)

		return new Response(JSON.stringify({
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: 3600,
			scope: authCode.scope
		}), {
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
 * OAuth-protected SSE endpoint
 */
async function handleOAuthSSE(request: Request, env: Env): Promise<Response> {
	// Extract and validate Bearer token
	const token = extractBearerToken(request)
	if (!token) {
		return new Response(JSON.stringify({
			error: 'unauthorized',
			error_description: 'OAuth Bearer token required for SSE connections',
			auth_url: '/oauth/authorize'
		}), {
			status: 401,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}

	// Validate token
	const tokenData = await env.MCP_SESSIONS.get(`oauth:token:${token}`)
	if (!tokenData) {
		return new Response(JSON.stringify({
			error: 'invalid_token',
			error_description: 'Invalid bearer token'
		}), {
			status: 401,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}

	const parsedTokenData: AccessToken = JSON.parse(tokenData)
	
	// Check if token is expired
	if (Date.now() > parsedTokenData.expires_at) {
		return new Response(JSON.stringify({
			error: 'invalid_token',
			error_description: 'Bearer token expired'
		}), {
			status: 401,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}

	console.log('Creating clean OAuth SSE connection for user:', parsedTokenData.username)

	// Create clean SSE stream
	const connectionId = crypto.randomUUID()
	const encoder = new TextEncoder()
	const { readable, writable } = new TransformStream()
	const writer = writable.getWriter()

	// Store session for MCP handlers
	const sessionPayload = {
		token: token,
		userId: parsedTokenData.username,
		sessionKey: parsedTokenData.lastfm_session_key,
		username: parsedTokenData.username,
		timestamp: Date.now(),
		expiresAt: parsedTokenData.expires_at,
		connectionId: connectionId,
		source: 'oauth-clean'
	}

	await env.MCP_SESSIONS.put(
		`session:${connectionId}`,
		JSON.stringify(sessionPayload),
		{ expirationTtl: Math.floor((parsedTokenData.expires_at - Date.now()) / 1000) }
	)

	// Keepalive
	const keepalive = setInterval(() => {
		try {
			writer.write(encoder.encode(':keepalive\n\n'))
		} catch {
			clearInterval(keepalive)
		}
	}, 30000)

	writer.closed.finally(() => clearInterval(keepalive))

	console.log('Clean OAuth SSE connection established:', connectionId)

	return new Response(readable, {
		headers: corsHeaders({
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'X-Connection-ID': connectionId,
		})
	})
}

/**
 * OAuth-protected MCP JSON-RPC endpoint
 */
async function handleOAuthMCP(request: Request, env: Env): Promise<Response> {
	try {
		// Check for Bearer token first (Claude Desktop might send this in POST requests)
		const token = extractBearerToken(request)
		let sessionData: string | null = null
		let connectionId: string | null = null

		if (token) {
			// Validate OAuth token directly
			const tokenData = await env.MCP_SESSIONS.get(`oauth:token:${token}`)
			if (!tokenData) {
				return new Response(JSON.stringify({
					error: 'invalid_token',
					error_description: 'Invalid bearer token'
				}), {
					status: 401,
					headers: corsHeaders({ 'Content-Type': 'application/json' })
				})
			}

			const parsedTokenData: AccessToken = JSON.parse(tokenData)
			
			// Check if token is expired
			if (Date.now() > parsedTokenData.expires_at) {
				return new Response(JSON.stringify({
					error: 'invalid_token',
					error_description: 'Bearer token expired'
				}), {
					status: 401,
					headers: corsHeaders({ 'Content-Type': 'application/json' })
				})
			}

			// Create temporary session for this request
			connectionId = crypto.randomUUID()
			const sessionPayload = {
				token: token,
				userId: parsedTokenData.username,
				sessionKey: parsedTokenData.lastfm_session_key,
				username: parsedTokenData.username,
				timestamp: Date.now(),
				expiresAt: parsedTokenData.expires_at,
				connectionId: connectionId,
				source: 'oauth-bearer'
			}
			sessionData = JSON.stringify(sessionPayload)

			// Store temporary session
			await env.MCP_SESSIONS.put(
				`session:${connectionId}`,
				sessionData,
				{ expirationTtl: 300 } // 5 minutes
			)

		} else {
			// No Bearer token - this should require authentication
			// Claude Desktop should go through OAuth first
			return new Response(JSON.stringify({
				error: 'unauthorized',
				error_description: 'OAuth Bearer token required. Please complete authentication first.',
				auth_url: '/oauth/authorize'
			}), {
				status: 401,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		// Parse and handle MCP request
		const body = await request.text()
		console.log('OAuth MCP Request body received:', body.length > 0 ? 'has content' : 'empty', 'with token:', !!token)
		
		if (!body.trim()) {
			// Empty body - might be a connection test
			console.log('Empty MCP request body - treating as connection test')
			return new Response(JSON.stringify({
				jsonrpc: '2.0',
				id: null,
				result: {
					status: 'ready',
					capabilities: {
						tools: {},
						resources: {},
						prompts: {}
					}
				}
			}), {
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}
		
		let jsonrpcRequest
		try {
			jsonrpcRequest = parseMessage(body)
			console.log('OAuth MCP Request:', jsonrpcRequest.method, 'with token:', !!token)
		} catch (error) {
			console.error('Failed to parse JSON-RPC message:', error, 'Body:', body.substring(0, 200))
			return new Response(JSON.stringify({
				jsonrpc: '2.0',
				id: null,
				error: {
					code: -32700,
					message: 'Parse error',
					data: 'Invalid JSON-RPC message'
				}
			}), {
				status: 400,
				headers: corsHeaders({ 'Content-Type': 'application/json' })
			})
		}

		// Create a modified request with connection ID header for MCP handlers
		const modifiedHeaders = new Headers(request.headers)
		modifiedHeaders.set('X-Connection-ID', connectionId)

		const modifiedRequest = new Request(request.url, {
			method: request.method,
			headers: modifiedHeaders,
			body: body
		})

		// Use the existing MCP handler
		const response = await handleMethod(jsonrpcRequest, modifiedRequest, undefined, env)

		if (!response) {
			return new Response(null, { 
				status: 204,
				headers: corsHeaders()
			})
		}

		console.log('OAuth MCP Response for', jsonrpcRequest.method, ':', response.result ? 'has result' : 'no result')

		return new Response(serializeResponse(response), {
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})

	} catch (error) {
		console.error('OAuth MCP request error:', error)
		const errorResponse = createError(null, ErrorCode.InternalError, 'MCP request failed')
		return new Response(serializeResponse(errorResponse), {
			status: 500,
			headers: corsHeaders({ 'Content-Type': 'application/json' })
		})
	}
}