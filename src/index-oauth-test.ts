/**
 * ABOUTME: Test OAuth implementation for Last.fm MCP Server
 * ABOUTME: Simple OAuth provider setup to validate the integration works
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider'
import type { Env } from './types/env'

// Simple API handler that logs OAuth context
const apiHandler = {
	async fetch(request: Request, env: any, ctx: any): Promise<Response> {
		console.log('OAuth API Handler called')
		
		// Return simple JSON response to test authentication works
		return new Response(JSON.stringify({
			message: 'OAuth authentication successful!',
			url: request.url,
			method: request.method,
			timestamp: new Date().toISOString()
		}), {
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*'
			}
		})
	}
}

// Default handler for non-protected endpoints
const defaultHandler = {
	async fetch(request: Request, env: any, ctx: any): Promise<Response> {
		const url = new URL(request.url)
		
		// Basic CORS
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		}

		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 200, headers: corsHeaders })
		}

		// Simple routing for testing
		switch (url.pathname) {
			case '/':
				return new Response(JSON.stringify({
					name: 'Last.fm MCP OAuth Test Server',
					version: '2.0.0-test',
					oauth_endpoints: {
						authorization: `${url.origin}/oauth/authorize`,
						token: `${url.origin}/oauth/token`,
						registration: `${url.origin}/oauth/register`
					},
					protected_endpoints: {
						sse: `${url.origin}/sse`
					}
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})

			case '/health':
				return new Response(JSON.stringify({
					status: 'ok',
					oauth: 'enabled'
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})

			case '/test-auth':
				// Test endpoint to check authentication manually
				return new Response(JSON.stringify({
					message: 'This endpoint tests OAuth authentication',
					instructions: 'Use /oauth/register to register a client, then /oauth/authorize to get a token',
					cookie: request.headers.get('Cookie'),
					authorization: request.headers.get('Authorization')
				}), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})

			default:
				return new Response(JSON.stringify({
					error: 'Not found',
					available_endpoints: ['/', '/health', '/test-auth', '/sse', '/oauth/*']
				}), {
					status: 404,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				})
		}
	}
}

// Create OAuth provider with minimal configuration for testing
export default new OAuthProvider({
	// Protect the /sse endpoint
	apiRoute: '/sse',
	apiHandler,
	defaultHandler,
	
	// OAuth endpoints
	authorizeEndpoint: '/oauth/authorize',
	tokenEndpoint: '/oauth/token',
	clientRegistrationEndpoint: '/oauth/register',
	
	// Basic scopes for testing
	scopesSupported: ['test:read', 'test:write'],
	
	// Allow public clients for easier testing
	disallowPublicClientRegistration: false,
	allowImplicitFlow: false,
	
	// Simple token exchange callback
	tokenExchangeCallback: async (options) => {
		console.log('Token exchange callback called:', options)
		
		return {
			accessTokenProps: {
				user: {
					id: options.userId,
					name: `User ${options.userId}`
				},
				grant: {
					client_id: options.clientId,
					scope: options.scope
				}
			}
		}
	},
	
	// Error logging
	onError: (error) => {
		console.error('OAuth Provider Error:', error)
	}
})