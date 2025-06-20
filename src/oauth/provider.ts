/**
 * ABOUTME: OAuth 2.0 provider configuration for Claude native MCP integration  
 * ABOUTME: Creates the OAuthProvider instance that wraps the MCP server with authentication
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider'
import type { Env } from '../types/env'

/**
 * Create MCP API handler for OAuth-protected endpoints
 */
export function createMCPApiHandler() {
	return {
		async fetch(request: Request, env: Env, ctx: any, props: any): Promise<Response> {
			// This handler receives authenticated requests with props containing user info
			const { user, grant } = props
			
			console.log('MCP API request authenticated for user:', user?.id || 'unknown')
			
			// Import and handle MCP requests with user context
			const { handleMCPWithOAuthContext } = await import('./mcp-handler')
			return await handleMCPWithOAuthContext(request, env, user, grant)
		}
	}
}

/**
 * Create default handler for non-API requests (OAuth endpoints, static content, etc.)
 */
export function createDefaultHandler() {
	return {
		async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
			// Handle OAuth flow, health checks, etc.
			const { handleNonAPIRequest } = await import('./default-handler')
			return await handleNonAPIRequest(request, env)
		}
	}
}

/**
 * Create the complete OAuth provider configuration
 */
export function createOAuthProvider(env: Env) {
	const apiHandler = createMCPApiHandler()
	const defaultHandler = createDefaultHandler()
	
	return new OAuthProvider({
		// Protect the SSE endpoint with OAuth
		apiRoute: '/sse',
		apiHandler,
		defaultHandler,
		
		// OAuth endpoints
		authorizeEndpoint: '/oauth/authorize',
		tokenEndpoint: '/oauth/token',
		clientRegistrationEndpoint: '/oauth/register',
		
		// Supported scopes for Last.fm access
		scopesSupported: [
			'lastfm:read',           // Read access to listening data
			'lastfm:profile',        // Access to user profile information
			'lastfm:recommendations' // Access to music recommendations
		],
		
		// Security settings
		allowImplicitFlow: false,
		disallowPublicClientRegistration: false, // Allow Claude to register as public client
		
		// Token exchange callback for dynamic user context
		tokenExchangeCallback: async (options) => {
			const { grantType, props, clientId, userId, scope } = options
			
			// For authorization_code grant, bridge Last.fm authentication
			if (grantType === 'authorization_code') {
				// Get Last.fm session data from stored props
				const lastfmSession = props?.lastfm_session_key
				
				if (lastfmSession) {
					return {
						accessTokenProps: {
							user: {
								id: userId,
								username: props.username,
								lastfm_session_key: lastfmSession
							},
							grant: {
								scope,
								client_id: clientId
							}
						}
					}
				}
			}
			
			// For refresh_token grant, maintain existing props
			if (grantType === 'refresh_token') {
				return {
					accessTokenProps: props
				}
			}
			
			return {}
		},
		
		// Error handling
		onError: ({ code, description, status, headers }) => {
			console.error('OAuth Provider Error:', {
				code, 
				description, 
				status, 
				headers
			})
			
			// Return custom error response for better user experience
			if (code === 'invalid_grant' || code === 'unauthorized_client') {
				return new Response(JSON.stringify({
					error: code,
					error_description: description,
					message: 'Authentication failed. Please try the authorization flow again.'
				}), {
					status: status,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*'
					}
				})
			}
		}
	})
}

/**
 * Helper function to extract cookie value from request
 */
function getCookie(request: Request, name: string): string | null {
	const cookieHeader = request.headers.get('Cookie')
	if (!cookieHeader) {
		return null
	}
	
	const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
		const [key, value] = cookie.trim().split('=')
		if (key && value) {
			acc[key] = value
		}
		return acc
	}, {} as Record<string, string>)
	
	return cookies[name] || null
}

/**
 * Validate OAuth bearer token and return user context
 */
export async function validateBearerToken(authHeader: string | null, env: Env): Promise<{
	userId: string
	username: string
	scopes: string[]
	lastfmSessionKey?: string
} | null> {
	if (!authHeader?.startsWith('Bearer ')) {
		return null
	}
	
	const token = authHeader.substring(7)
	const tokenKey = `oauth:token:${token}`
	const tokenData = await env.MCP_SESSIONS.get(tokenKey)
	
	if (!tokenData) {
		return null
	}
	
	const token_info = JSON.parse(tokenData)
	
	// Check if token is expired
	if (Date.now() > token_info.expires_at) {
		await env.MCP_SESSIONS.delete(tokenKey)
		return null
	}
	
	return {
		userId: token_info.user_id,
		username: token_info.username,
		scopes: token_info.scopes || [],
		lastfmSessionKey: token_info.lastfm_session_key
	}
}