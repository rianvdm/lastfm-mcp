/**
 * ABOUTME: Minimal OAuth implementation to test the OAuth provider flow
 * ABOUTME: Focuses on getting the OAuth provider to handle authorization correctly
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider'
import type { Env } from './types/env'

// Simple API handler for testing
const apiHandler = {
	async fetch(request: Request, env: any, ctx: any): Promise<Response> {
		return new Response(JSON.stringify({
			message: 'Protected endpoint accessed',
			hasOAuth: !!ctx.oauth,
			user: ctx.oauth?.user || null
		}), {
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*'
			}
		})
	}
}

// Default handler for non-OAuth endpoints
const defaultHandler = {
	async fetch(request: Request, env: any, ctx: any): Promise<Response> {
		const url = new URL(request.url)
		
		// Handle root endpoint
		if (url.pathname === '/') {
			return new Response(JSON.stringify({
				name: 'OAuth Provider Test',
				version: '1.0.0',
				endpoints: {
					register: '/oauth/register',
					authorize: '/oauth/authorize',
					token: '/oauth/token',
					protected: '/sse'
				}
			}), {
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*'
				}
			})
		}
		
		return new Response('Not Found', { status: 404 })
	}
}

// Create OAuth provider with minimal configuration
export default new OAuthProvider({
	apiRoute: '/sse',
	apiHandler,
	defaultHandler,
	
	authorizeEndpoint: '/oauth/authorize',
	tokenEndpoint: '/oauth/token',
	clientRegistrationEndpoint: '/oauth/register',
	
	scopesSupported: ['read', 'write'],
	
	// Simple user authentication - always approve for testing
	authorizationApprovalCallback: async (options) => {
		console.log('Authorization approval callback called:', {
			client_id: options.client_id,
			scope: options.scope,
			redirect_uri: options.redirect_uri
		})
		
		// For testing, always approve with a test user
		return {
			approved: true,
			user_id: 'test-user-123',
			metadata: {
				username: 'testuser',
				email: 'test@example.com'
			}
		}
	},
	
	// Handle token generation
	tokenExchangeCallback: async (options) => {
		console.log('Token exchange callback called:', {
			grantType: options.grantType,
			clientId: options.clientId,
			userId: options.userId
		})
		
		if (options.grantType === 'authorization_code') {
			return {
				accessTokenProps: {
					user: {
						id: options.userId || 'test-user-123',
						username: 'testuser'
					}
				}
			}
		}
		
		return {}
	},
	
	onError: (error) => {
		console.error('OAuth Provider Error:', error)
	},
	
	// Add these for better compatibility
	disallowPublicClientRegistration: false,
	allowImplicitFlow: false
})