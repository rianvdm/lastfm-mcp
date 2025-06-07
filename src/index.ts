/**
 * Discogs MCP Server - Cloudflare Worker
 * Implements Model Context Protocol for Discogs collection access
 */

import { parseMessage, createError, serializeResponse } from './protocol/parser'
import { handleMethod } from './protocol/handlers'
import { ErrorCode } from './types/jsonrpc'
import { createSSEResponse, getConnection } from './transport/sse'
import { DiscogsAuth } from './auth/discogs'
import type { Env } from './types/env'

// Store for temporary OAuth tokens (in production, use KV storage)
const oauthTokenStore = new Map<string, string>()

export default {
	async fetch(request, env, _ctx): Promise<Response> {
		const url = new URL(request.url)

		// Handle different endpoints
		switch (url.pathname) {
			case '/':
				// Main MCP endpoint - accepts JSON-RPC messages
				if (request.method !== 'POST') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleMCPRequest(request)

			case '/sse':
				// SSE endpoint for bidirectional communication
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleSSEConnection()

			case '/login':
				// OAuth login - redirect to Discogs
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleLogin(env)

			case '/callback':
				// OAuth callback - exchange tokens
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleCallback(request, env)

			default:
				return new Response('Not found', { status: 404 })
		}
	},
} satisfies ExportedHandler<Env>

/**
 * Handle OAuth login request
 */
async function handleLogin(env: Env): Promise<Response> {
	try {
		const auth = new DiscogsAuth(env.DISCOGS_CONSUMER_KEY, env.DISCOGS_CONSUMER_SECRET)
		
		// Get callback URL (in production, use proper domain)
		const callbackUrl = 'http://localhost:8787/callback'
		
		// Get request token
		const { oauth_token, oauth_token_secret } = await auth.getRequestToken(callbackUrl)
		
		// Store token secret temporarily (in production, use KV storage)
		oauthTokenStore.set(oauth_token, oauth_token_secret)
		
		// Redirect to Discogs authorization page
		const authorizeUrl = auth.getAuthorizeUrl(oauth_token)
		return Response.redirect(authorizeUrl, 302)
	} catch (error) {
		console.error('OAuth login error:', error)
		return new Response('OAuth login failed', { status: 500 })
	}
}

/**
 * Handle OAuth callback
 */
async function handleCallback(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url)
		const oauthToken = url.searchParams.get('oauth_token')
		const oauthVerifier = url.searchParams.get('oauth_verifier')
		
		if (!oauthToken || !oauthVerifier) {
			return new Response('Missing OAuth parameters', { status: 400 })
		}
		
		// Retrieve token secret
		const oauthTokenSecret = oauthTokenStore.get(oauthToken)
		if (!oauthTokenSecret) {
			return new Response('Invalid OAuth token', { status: 400 })
		}
		
		// Clean up temporary storage
		oauthTokenStore.delete(oauthToken)
		
		// Exchange for access token
		const auth = new DiscogsAuth(env.DISCOGS_CONSUMER_KEY, env.DISCOGS_CONSUMER_SECRET)
		const { oauth_token: accessToken, oauth_token_secret: accessTokenSecret } = 
			await auth.getAccessToken(oauthToken, oauthTokenSecret, oauthVerifier)
		
		// TODO: In C3, we'll create a JWT and set it as a cookie
		// For now, just return success with the tokens
		return new Response(
			`Authentication successful!\n\nAccess Token: ${accessToken}\nAccess Token Secret: ${accessTokenSecret}\n\nThese tokens can be used to access your Discogs collection.`,
			{ 
				status: 200,
				headers: { 'Content-Type': 'text/plain' }
			}
		)
	} catch (error) {
		console.error('OAuth callback error:', error)
		return new Response('OAuth callback failed', { status: 500 })
	}
}

/**
 * Handle SSE connection request
 */
function handleSSEConnection(): Response {
	const { response, connectionId } = createSSEResponse()
	console.log(`New SSE connection established: ${connectionId}`)
	return response
}

/**
 * Handle MCP JSON-RPC request
 */
async function handleMCPRequest(request: Request): Promise<Response> {
	try {
		// Check for connection ID header (for SSE-connected clients)
		const connectionId = request.headers.get('X-Connection-ID')
		if (connectionId) {
			const connection = getConnection(connectionId)
			if (!connection) {
				console.warn(`Invalid connection ID: ${connectionId}`)
			}
		}

		// Parse request body
		const body = await request.text()

		// Handle empty body
		if (!body) {
			const errorResponse = createError(null, ErrorCode.InvalidRequest, 'Empty request body')
			return new Response(serializeResponse(errorResponse), {
				headers: { 'Content-Type': 'application/json' },
			})
		}

		// Parse JSON-RPC message
		let jsonrpcRequest
		try {
			jsonrpcRequest = parseMessage(body)
		} catch (error) {
			// Parse error or invalid request
			const errorResponse = createError(null, (error as any).code || ErrorCode.ParseError, (error as any).message || 'Parse error')
			return new Response(serializeResponse(errorResponse), {
				headers: { 'Content-Type': 'application/json' },
			})
		}

		// Handle the method
		const response = await handleMethod(jsonrpcRequest)

		// If no response (notification), return 204 No Content
		if (!response) {
			return new Response(null, { status: 204 })
		}

		// Return JSON-RPC response
		return new Response(serializeResponse(response), {
			headers: { 'Content-Type': 'application/json' },
		})
	} catch (error) {
		// Internal server error
		console.error('Internal error:', error)
		const errorResponse = createError(null, ErrorCode.InternalError, 'Internal server error')
		return new Response(serializeResponse(errorResponse), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		})
	}
}
