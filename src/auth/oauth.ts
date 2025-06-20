// ABOUTME: Configures and manages OAuth 2.1 provider using workers-oauth-provider
// ABOUTME: Handles Dynamic Client Registration and token management for Claude Desktop integration

import type { Env } from '../types/env'
import { verifySessionToken } from './jwt'
import { LastfmAuth } from './lastfm'

/**
 * OAuth provider configuration for creating the wrapper
 */
export interface OAuthConfig {
	env: Env
	baseUrl: string
}

/**
 * Get OAuth provider configuration options
 */
export function getOAuthProviderOptions(config: OAuthConfig) {
	const { env, baseUrl } = config

	return {
		// API routes - these will require OAuth tokens
		apiRoute: [
			`${baseUrl}/`,         // Main MCP endpoint
		],

		// OAuth endpoints
		authorizeEndpoint: `${baseUrl}/oauth/authorize`,
		tokenEndpoint: `${baseUrl}/oauth/token`,
		clientRegistrationEndpoint: `${baseUrl}/oauth/register`,

		// Supported scopes
		scopesSupported: [
			'mcp.read',        // Read MCP data
			'mcp.write',       // Write MCP data  
			'lastfm.connect',  // Connect to Last.fm account
			'offline_access'   // Refresh tokens
		],

		// Token configuration
		accessTokenTTL: 3600, // 1 hour

		// Enable dynamic client registration for Claude Desktop
		disallowPublicClientRegistration: false,

		// Custom token exchange callback to bridge OAuth to Last.fm
		tokenExchangeCallback: async (options: any) => {
			// During token exchange, we can add Last.fm session info to the token
			const { userId, props } = options
			
			if (props && props.lastfmSessionKey) {
				return {
					accessTokenProps: {
						sub: userId,
						lastfm_session: props.lastfmSessionKey,
						username: props.username || userId,
					}
				}
			}

			return {}
		},

		// Error handling callback
		onError: (error: any) => {
			console.error('OAuth error:', error)
			return undefined // Let default error handling occur
		},
	}
}

/**
 * Bridge function to authenticate user during OAuth flow
 * This is called during the authorization step to validate user credentials
 */
export async function authenticateOAuthUser(
	request: Request,
	env: Env
): Promise<{ userId: string; lastfmSessionKey: string } | null> {
	try {
		// First check if user has existing JWT session
		const session = await verifySessionToken(
			request.headers.get('Cookie')?.match(/session=([^;]+)/)?.[1] || '',
			env.JWT_SECRET
		)

		if (session && session.sessionKey) {
			return {
				userId: session.username,
				lastfmSessionKey: session.sessionKey,
			}
		}

		// If no existing session, check if we have Last.fm credentials in the request
		// This would come from the OAuth authorization UI after Last.fm login
		let lastfmToken = null
		
		// Only try to parse form data if this is a POST request with form data
		if (request.method === 'POST' && request.headers.get('Content-Type')?.includes('application/x-www-form-urlencoded')) {
			try {
				const formData = await request.formData()
				lastfmToken = formData.get('lastfm_token')
			} catch (error) {
				// Not form data, continue without Last.fm token
			}
		}

		if (lastfmToken && typeof lastfmToken === 'string') {
			// Exchange Last.fm token for session key
			const auth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
			const { sessionKey, username } = await auth.getSessionKey(lastfmToken)

			return {
				userId: username,
				lastfmSessionKey: sessionKey,
			}
		}

		return null
	} catch (error) {
		console.error('OAuth user authentication error:', error)
		return null
	}
}

/**
 * Validate OAuth bearer token from Authorization header
 */
export async function validateBearerToken(
	authHeader: string | null,
	provider: OAuthProvider
): Promise<{ valid: boolean; claims?: Record<string, unknown> }> {
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return { valid: false }
	}

	const token = authHeader.substring(7) // Remove "Bearer " prefix

	try {
		// Validate token with the OAuth provider
		const tokenInfo = await provider.validateAccessToken(token)

		if (!tokenInfo || !tokenInfo.active) {
			return { valid: false }
		}

		return {
			valid: true,
			claims: tokenInfo,
		}
	} catch (error) {
		console.error('Bearer token validation error:', error)
		return { valid: false }
	}
}

/**
 * Extract Last.fm session from OAuth token claims
 */
export function extractLastfmSession(claims: Record<string, unknown>): {
	username: string
	sessionKey: string
} | null {
	const username = claims.sub || claims.username
	const sessionKey = claims.lastfm_session

	if (typeof username === 'string' && typeof sessionKey === 'string') {
		return { username, sessionKey }
	}

	return null
}