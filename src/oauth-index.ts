/**
 * OAuth-enabled Last.fm MCP Server - Cloudflare Worker
 * Implements Model Context Protocol with OAuth 2.1 authentication for Claude Desktop
 */

import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import type { Env } from './types/env'
import { defaultHandler } from './handlers/defaultHandler'
import { apiHandler } from './handlers/apiHandler'

/**
 * OAuth-enabled MCP Server entrypoint
 * This wraps the existing MCP functionality with OAuth 2.1 authentication
 */
export default new OAuthProvider({
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