/**
 * ABOUTME: Claude Desktop compatible MCP Server with OAuth 2.1 authentication
 * ABOUTME: Main entry point that serves MCP endpoints directly while supporting OAuth flows
 */

import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import type { Env } from './types/env'
import type { ExecutionContext } from '@cloudflare/workers-types'

// Import existing MCP server functionality
import mcpServer from './index'

// Import OAuth handlers
import { defaultHandler } from './handlers/defaultHandler'
import { apiHandler } from './handlers/apiHandler'

/**
 * OAuth provider instance for authentication flows
 */
const oauthProvider = new OAuthProvider({
	// API routes that require OAuth authentication  
	apiRoute: [
		'/api/', // API endpoints that need authentication
	],

	// Handler for authenticated API requests
	apiHandler,

	// Handler for all non-API requests (OAuth flows, static pages, etc.)
	defaultHandler,

	// OAuth endpoints
	authorizeEndpoint: '/oauth/authorize',
	tokenEndpoint: '/oauth/token',
	clientRegistrationEndpoint: '/oauth/register',

	// Supported OAuth scopes
	scopesSupported: [
		'mcp.read',        // Read MCP data and Last.fm information
		'mcp.write',       // Modify MCP settings  
		'lastfm.connect',  // Access Last.fm listening data
		'offline_access'   // Refresh tokens for persistent access
	],

	// Token configuration
	accessTokenTTL: 3600, // 1 hour

	// Allow dynamic client registration for Claude Desktop
	disallowPublicClientRegistration: false,

	// Custom token exchange callback to bridge OAuth tokens to Last.fm sessions
	tokenExchangeCallback: async (options) => {
		const { userId, props } = options
		
		// If we have Last.fm session info in props, add it to the token
		if (props && props.lastfmSessionKey) {
			return {
				accessTokenProps: {
					sub: userId,
					lastfm_session: props.lastfmSessionKey,
					username: props.username || userId,
				}
			}
		}

		// Return minimal token claims
		return {
			accessTokenProps: {
				sub: userId,
				username: userId,
			}
		}
	},

	// Error handling
	onError: (error) => {
		console.error('OAuth Provider Error:', {
			code: error.code,
			description: error.description,
			status: error.status,
			details: error,
		})
		
		// Add additional context for debugging
		if (error.code === 'invalid_client') {
			console.error('Client not found - this might be a KV storage consistency issue or client ID mismatch')
		}
		
		// Let the default error handling occur
		return undefined
	},
})

/**
 * Main worker handler that serves MCP endpoints directly
 * OAuth endpoints are available for authentication flows
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 200,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Connection-ID, Cookie',
					'Access-Control-Max-Age': '86400',
					// Add OAuth discovery header to help Claude Desktop detect authentication
					'WWW-Authenticate': 'Bearer realm="lastfm-mcp", auth_param="oauth_uri=/.well-known/oauth-authorization-server"',
				},
			})
		}

		// If Claude Desktop is checking for authentication capabilities, provide OAuth discovery info
		const userAgent = request.headers.get('User-Agent') || ''
		console.log('Request details:', { 
			method: request.method, 
			path: url.pathname, 
			userAgent,
			isClaudeUA: userAgent.includes('claude')
		})
		
		if ((userAgent.includes('claude') || userAgent.includes('python-httpx')) && url.pathname === '/') {
			// For GET requests from Claude Desktop, include OAuth discovery headers
			if (request.method === 'GET') {
				console.log('Claude Desktop GET detected - including OAuth discovery headers')
				return new Response(
					JSON.stringify({
						name: 'Last.fm MCP Server',
						version: '1.0.0',
						description: 'Model Context Protocol server for Last.fm listening data access',
						oauth: {
							enabled: true,
							discovery: '/.well-known/oauth-authorization-server',
							authorization: '/oauth/authorize',
							token: '/oauth/token',
							registration: '/oauth/register',
							scopes: ['mcp.read', 'mcp.write', 'lastfm.connect', 'offline_access']
						},
						authentication: {
							required: true,
							type: 'oauth2',
							oauth_discovery_url: '/.well-known/oauth-authorization-server'
						},
						endpoints: {
							'/': 'POST - MCP JSON-RPC endpoint (requires OAuth)',
							'/sse': 'GET - Server-Sent Events endpoint (requires OAuth)',
							'/oauth/*': 'OAuth 2.1 authentication endpoints',
							'/.well-known/oauth-authorization-server': 'OAuth discovery',
						},
					}),
					{
						status: 200,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
							// Add OAuth discovery headers
							'WWW-Authenticate': 'Bearer realm="lastfm-mcp", auth_param="oauth_uri=/.well-known/oauth-authorization-server"',
							'Link': '</.well-known/oauth-authorization-server>; rel="oauth2-metadata"',
							'X-OAuth-Discovery': '/.well-known/oauth-authorization-server',
						},
					}
				)
			}
		}

		// Handle custom OAuth token endpoint to bypass workers-oauth-provider bug
		if (url.pathname === '/oauth/token' && request.method === 'POST') {
			console.log('Using custom OAuth token handler to bypass library bug')
			return handleCustomTokenEndpoint(request, env)
		}

		// Route other OAuth endpoints to OAuth provider
		if (isOAuthEndpoint(url.pathname)) {
			console.log(`Routing OAuth endpoint ${url.pathname} to OAuth provider`)
			return oauthProvider.fetch(request, env, ctx)
		}

		// Route MCP endpoints to MCP server with OAuth token support
		console.log(`Routing MCP endpoint ${url.pathname} to MCP server`)
		return handleMCPWithOAuth(request, env, ctx)
	}
}

/**
 * Check if the path is an OAuth endpoint
 */
function isOAuthEndpoint(pathname: string): boolean {
	return pathname.startsWith('/oauth/') || 
		   pathname === '/.well-known/oauth-authorization-server' ||
		   pathname === '/debug/kv'
}

/**
 * Handle MCP requests with OAuth token validation
 */
async function handleMCPWithOAuth(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url)
	
	// For main MCP endpoints, check for OAuth bearer token
	if ((url.pathname === '/' && request.method === 'POST') || url.pathname === '/sse') {
		const authHeader = request.headers.get('Authorization')
		const userAgent = request.headers.get('User-Agent') || ''
		
		console.log('MCP auth check:', {
			path: url.pathname,
			method: request.method,
			hasAuth: !!authHeader,
			userAgent,
			isClaudeUA: userAgent.includes('claude')
		})
		
		if (authHeader && authHeader.startsWith('Bearer ')) {
			// OAuth token present - validate and bridge to session
			const accessToken = authHeader.substring(7)
			
			try {
				// Look up the access token in our custom storage
				const tokenData = await env.OAUTH_KV.get(`access_token:${accessToken}`)
				
				if (tokenData) {
					const token = JSON.parse(tokenData)
					
					// Check if token is expired
					if (token.expiresAt && Date.now() > token.expiresAt) {
						console.log('OAuth token expired')
						return new Response(
							JSON.stringify({
								error: 'invalid_token',
								error_description: 'Access token has expired',
							}),
							{
								status: 401,
								headers: {
									'Content-Type': 'application/json',
									'Access-Control-Allow-Origin': '*',
								},
							}
						)
					}
					
					const lastfmUsername = token.username
					const lastfmSessionKey = token.lastfmSessionKey
					
					// Bridge OAuth token to MCP session by adding cookies
					if (lastfmUsername && lastfmSessionKey) {
						const existingCookies = request.headers.get('Cookie') || ''
						const sessionCookie = `lastfm_user=${lastfmUsername}; lastfm_session=${lastfmSessionKey}`
						const newCookies = existingCookies ? `${existingCookies}; ${sessionCookie}` : sessionCookie
						
						// Create new request with session cookies for MCP compatibility
						const modifiedRequest = new Request(request.url, {
							method: request.method,
							headers: new Headers(request.headers),
							body: request.body,
						})
						modifiedRequest.headers.set('Cookie', newCookies)
						
						console.log(`OAuth token validated for user: ${lastfmUsername}`)
						return mcpServer.fetch(modifiedRequest, env, ctx)
					}
				}
				
				console.log('OAuth token not found in custom storage')
			} catch (error) {
				console.error('OAuth token validation error:', error)
			}
			
			// Invalid OAuth token
			return new Response(
				JSON.stringify({
					error: 'invalid_token',
					error_description: 'Invalid or expired access token',
				}),
				{
					status: 401,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
						'WWW-Authenticate': 'Bearer realm="lastfm-mcp", auth_param="oauth_uri=/.well-known/oauth-authorization-server"',
					},
				}
			)
		} else {
			// No OAuth token provided - check if this is Claude Desktop
			if (userAgent.includes('claude') || userAgent.includes('python-httpx')) {
				console.log('Claude Desktop request without OAuth token - returning 401 to trigger authentication')
				return new Response(
					JSON.stringify({
						error: 'authentication_required',
						error_description: 'OAuth authentication required. Please authenticate to access this MCP server.',
						oauth_discovery: '/.well-known/oauth-authorization-server'
					}),
					{
						status: 401,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
							'WWW-Authenticate': 'Bearer realm="lastfm-mcp", auth_param="oauth_uri=/.well-known/oauth-authorization-server"',
							'Link': '</.well-known/oauth-authorization-server>; rel="oauth2-metadata"',
						},
					}
				)
			}
		}
	}
	
	// No OAuth token or non-protected endpoint - pass through to MCP server
	return mcpServer.fetch(request, env, ctx)
}

/**
 * Custom OAuth token endpoint handler to bypass workers-oauth-provider client lookup bug
 */
async function handleCustomTokenEndpoint(request: Request, env: Env): Promise<Response> {
	try {
		const formData = await request.formData()
		const grantType = formData.get('grant_type')
		const code = formData.get('code')
		const clientId = formData.get('client_id')
		const codeVerifier = formData.get('code_verifier')
		const redirectUri = formData.get('redirect_uri')

		console.log('Token exchange request:', {
			grantType,
			hasCode: !!code,
			clientId,
			hasCodeVerifier: !!codeVerifier,
			redirectUri
		})

		if (grantType !== 'authorization_code') {
			return new Response(JSON.stringify({
				error: 'unsupported_grant_type',
				error_description: 'Only authorization_code grant type is supported'
			}), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			})
		}

		if (!code || !clientId) {
			return new Response(JSON.stringify({
				error: 'invalid_request',
				error_description: 'Missing required parameters'
			}), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			})
		}

		// Look up the authorization code to get the user info and session
		// The OAuth provider should have stored this during authorization
		const authCodeKey = `auth_code:${code}`
		const authCodeData = await env.OAUTH_KV.get(authCodeKey)
		
		if (!authCodeData) {
			console.error('Authorization code not found:', code)
			return new Response(JSON.stringify({
				error: 'invalid_grant',
				error_description: 'Authorization code is invalid or expired'
			}), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			})
		}

		const authData = JSON.parse(authCodeData)
		console.log('Found authorization data:', {
			userId: authData.userId,
			clientId: authData.clientId,
			hasLastfmSession: !!authData.lastfmSessionKey
		})

		// Verify the client ID matches
		if (authData.clientId !== clientId) {
			return new Response(JSON.stringify({
				error: 'invalid_client',
				error_description: 'Client ID mismatch'
			}), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			})
		}

		// Generate access token
		const accessToken = `${authData.userId}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`
		
		// Store access token with user data
		const tokenData = {
			clientId: authData.clientId,
			userId: authData.userId,
			username: authData.username || authData.userId,
			lastfmSessionKey: authData.lastfmSessionKey,
			scope: authData.scope || 'mcp.read lastfm.connect',
			issuedAt: Date.now(),
			expiresAt: Date.now() + (3600 * 1000) // 1 hour
		}

		await env.OAUTH_KV.put(`access_token:${accessToken}`, JSON.stringify(tokenData), {
			expirationTtl: 3600 // 1 hour
		})

		// Clean up the authorization code (single use)
		await env.OAUTH_KV.delete(authCodeKey)

		console.log('Successfully created access token for user:', authData.userId)

		return new Response(JSON.stringify({
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: 3600,
			scope: tokenData.scope
		}), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		})

	} catch (error) {
		console.error('Custom token endpoint error:', error)
		return new Response(JSON.stringify({
			error: 'server_error',
			error_description: 'Internal server error during token exchange'
		}), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		})
	}
}