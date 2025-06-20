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
				},
			})
		}

		// Route OAuth endpoints to OAuth provider
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
		
		if (authHeader && authHeader.startsWith('Bearer ')) {
			// OAuth token present - validate and bridge to session
			const accessToken = authHeader.substring(7)
			
			try {
				// Try to validate the token with the OAuth provider
				if (env.OAUTH_PROVIDER && typeof env.OAUTH_PROVIDER.getTokenClaims === 'function') {
					const tokenClaims = await env.OAUTH_PROVIDER.getTokenClaims(accessToken)
					if (tokenClaims) {
						const lastfmUsername = tokenClaims.username || tokenClaims.sub
						const lastfmSessionKey = tokenClaims.lastfm_session
						
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
				}
				
				// Fallback: try to parse token manually
				const tokenParts = accessToken.split(':')
				if (tokenParts.length >= 2) {
					const username = tokenParts[0]
					// For now, use a test session - in production this would come from token props
					const sessionKey = `oauth_session_${tokenParts[1]}`
					
					const existingCookies = request.headers.get('Cookie') || ''
					const sessionCookie = `lastfm_user=${username}; lastfm_session=${sessionKey}`
					const newCookies = existingCookies ? `${existingCookies}; ${sessionCookie}` : sessionCookie
					
					const modifiedRequest = new Request(request.url, {
						method: request.method,
						headers: new Headers(request.headers),
						body: request.body,
					})
					modifiedRequest.headers.set('Cookie', newCookies)
					
					console.log(`OAuth token parsed for user: ${username}`)
					return mcpServer.fetch(modifiedRequest, env, ctx)
				}
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
					},
				}
			)
		}
	}
	
	// No OAuth token or non-protected endpoint - pass through to MCP server
	return mcpServer.fetch(request, env, ctx)
}