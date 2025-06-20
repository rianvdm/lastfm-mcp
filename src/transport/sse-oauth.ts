/**
 * ABOUTME: SSE transport implementation with OAuth 2.0 authentication for Claude native integration
 * ABOUTME: Replaces mcp-remote connection handling with OAuth Bearer token authentication
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { validateBearerToken } from '../oauth/provider'
import type { Env } from '../types/env'

/**
 * Handle SSE connection with OAuth Bearer token authentication
 */
export async function handleOAuthSSEConnection(
	request: Request,
	env: Env,
	mcpServer: Server
): Promise<Response> {
	try {
		// Validate OAuth Bearer token
		const authHeader = request.headers.get('Authorization')
		const userContext = await validateBearerToken(authHeader, env)
		
		if (!userContext) {
			return new Response('Unauthorized: Invalid or missing Bearer token', { 
				status: 401,
				headers: {
					'WWW-Authenticate': 'Bearer realm="Last.fm MCP Server"',
					'Access-Control-Allow-Origin': '*'
				}
			})
		}
		
		console.log('OAuth SSE connection authenticated:', {
			userId: userContext.userId,
			username: userContext.username,
			scopes: userContext.scopes
		})
		
		// Create SSE transport
		const transport = new SSEServerTransport('/message', request)
		
		// Set user context on the MCP server
		mcpServer.setRequestHandler(async (request, extra) => {
			// Add user context to every MCP request
			return await handleMCPRequestWithUserContext(request, userContext, env, extra)
		})
		
		// Connect the server to the transport
		await mcpServer.connect(transport)
		
		console.log(`SSE connection established for user: ${userContext.username}`)
		
		// Add CORS headers to SSE response
		const response = transport.response
		response.headers.set('Access-Control-Allow-Origin', '*')
		response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
		response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
		
		return response
		
	} catch (error) {
		console.error('OAuth SSE connection error:', error)
		
		return new Response('Internal server error', {
			status: 500,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Content-Type': 'text/plain'
			}
		})
	}
}

/**
 * Handle MCP request with user context from OAuth token
 */
async function handleMCPRequestWithUserContext(
	request: any,
	userContext: {
		userId: string
		username: string
		scopes: string[]
		lastfmSessionKey?: string
	},
	env: Env,
	extra?: any
): Promise<any> {
	// Import the existing MCP handlers
	const { handleMethod } = await import('../protocol/handlers')
	
	// Create a mock request object with user context
	const mockRequest = {
		headers: new Headers({
			'Authorization': `Bearer ${userContext.userId}`, // For compatibility
			'X-User-ID': userContext.userId,
			'X-Username': userContext.username,
			'X-Scopes': userContext.scopes.join(','),
			...(userContext.lastfmSessionKey && { 'X-LastFM-Session': userContext.lastfmSessionKey })
		})
	}
	
	// Create a modified environment with user context
	const envWithContext = {
		...env,
		USER_CONTEXT: userContext
	}
	
	try {
		// Handle the MCP method with user context
		return await handleMethod(request, mockRequest as Request, env.JWT_SECRET, envWithContext)
	} catch (error) {
		console.error('MCP request handling error:', error)
		
		// Return MCP-compliant error
		return {
			jsonrpc: '2.0',
			id: request.id,
			error: {
				code: -32603,
				message: 'Internal error',
				data: error instanceof Error ? error.message : 'Unknown error'
			}
		}
	}
}

/**
 * Create MCP server instance configured for OAuth authentication
 */
export function createOAuthMCPServer(): Server {
	const server = new Server(
		{
			name: 'lastfm-mcp-oauth',
			version: '2.0.0',
		},
		{
			capabilities: {
				tools: {},
				resources: {},
				prompts: {},
			},
		}
	)
	
	return server
}

/**
 * Check if user has required scopes for a given operation
 */
export function hasRequiredScopes(userScopes: string[], requiredScopes: string[]): boolean {
	if (requiredScopes.length === 0) {
		return true // No scopes required
	}
	
	return requiredScopes.every(scope => userScopes.includes(scope) || userScopes.includes('*'))
}

/**
 * Get OAuth scopes required for specific MCP tools
 */
export function getToolScopes(toolName: string): string[] {
	const scopeMap: Record<string, string[]> = {
		// Public tools (no authentication required)
		'ping': [],
		'server_info': [],
		'get_track_info': [],
		'get_artist_info': [],
		'get_album_info': [],
		'get_similar_artists': [],
		'get_similar_tracks': [],
		
		// User data tools (require authentication)
		'get_recent_tracks': ['lastfm:read'],
		'get_top_artists': ['lastfm:read'],
		'get_top_albums': ['lastfm:read'],
		'get_loved_tracks': ['lastfm:read'],
		'get_user_info': ['lastfm:profile'],
		'get_listening_stats': ['lastfm:read'],
		'get_music_recommendations': ['lastfm:recommendations']
	}
	
	return scopeMap[toolName] || ['lastfm:read']
}