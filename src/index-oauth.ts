/**
 * Last.fm MCP Server - Hybrid Auth Entry Point
 *
 * Supports two authentication methods:
 * 1. OAuth 2.0 for proper MCP clients (token in Authorization header)
 * 2. Session-based auth for Claude Desktop (session_id in URL query param)
 */
import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import type { ExecutionContext } from '@cloudflare/workers-types'
import { createMcpHandler } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { LastfmOAuthHandler } from './auth/oauth-handler'
import { CachedLastfmClient } from './clients/cachedLastfm'
import { LastfmClient } from './clients/lastfm'
import { createMcpServer } from './mcp/server'
import type { Env } from './types/env'

// Server metadata
const SERVER_NAME = 'lastfm-mcp'
const SERVER_VERSION = '1.0.0'

/**
 * Session data stored in KV from manual login
 */
interface SessionData {
	userId: string
	sessionKey: string
	username: string
	timestamp: number
	expiresAt: number
	sessionId: string
}

/**
 * Handle MCP request with session-based auth (for Claude Desktop)
 */
async function handleSessionBasedMcp(request: Request, env: Env, ctx: ExecutionContext, sessionId: string): Promise<Response> {
	// Look up session from KV
	const sessionDataStr = await env.MCP_SESSIONS.get(`session:${sessionId}`)

	if (!sessionDataStr) {
		return new Response(
			JSON.stringify({
				error: 'invalid_session',
				error_description: 'Session not found or expired. Please visit /login to authenticate.',
			}),
			{
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			},
		)
	}

	const sessionData: SessionData = JSON.parse(sessionDataStr)

	// Check if session is expired
	if (sessionData.expiresAt && Date.now() > sessionData.expiresAt) {
		return new Response(
			JSON.stringify({
				error: 'session_expired',
				error_description: 'Session has expired. Please visit /login to re-authenticate.',
			}),
			{
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			},
		)
	}

	const url = new URL(request.url)
	const baseUrl = `${url.protocol}//${url.host}`

	// Create MCP server with session context
	const { server, setContext } = createMcpServer(env, baseUrl)

	// Set the session context from KV data
	setContext({
		sessionId,
		session: {
			username: sessionData.username,
			sessionKey: sessionData.sessionKey,
		},
	})

	// Handle the MCP request
	const handler = createMcpHandler(server)
	const response = await handler(request, env, ctx)

	// Add session ID to response headers
	const newHeaders = new Headers(response.headers)
	newHeaders.set('Mcp-Session-Id', sessionId)

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	})
}

/**
 * Create the OAuth provider instance
 */
const oauthProvider = new OAuthProvider({
	apiRoute: '/mcp',
	apiHandler: {
		async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
			// This only gets called for OAuth-authenticated requests
			const url = new URL(request.url)
			const baseUrl = `${url.protocol}//${url.host}`

			const server = new McpServer({
				name: SERVER_NAME,
				version: SERVER_VERSION,
			})

			const lastfmClient = new LastfmClient(env.LASTFM_API_KEY)
			const cachedClient = new CachedLastfmClient(lastfmClient, env.MCP_SESSIONS)

			const { registerPublicTools, registerAuthenticatedToolsWithOAuth } = await import('./mcp/tools')
			const { registerResources } = await import('./mcp/resources/lastfm')
			const { registerPrompts } = await import('./mcp/prompts/analysis')
			const { getMcpAuthContext } = await import('agents/mcp')

			const getBaseUrl = () => baseUrl

			registerPublicTools(server, cachedClient, getBaseUrl)
			registerAuthenticatedToolsWithOAuth(server, cachedClient, getBaseUrl)

			const getOAuthSession = () => {
				const auth = getMcpAuthContext()
				if (!auth?.props) return null
				const props = auth.props as unknown as { username: string; sessionKey: string }
				if (!props.sessionKey || !props.username) return null
				return { username: props.username, sessionKey: props.sessionKey }
			}
			registerResources(server, cachedClient, getOAuthSession)
			registerPrompts(server)

			return createMcpHandler(server)(request, env, ctx)
		},
	},
	authorizeEndpoint: '/authorize',
	tokenEndpoint: '/oauth/token',
	clientRegistrationEndpoint: '/oauth/register',
	defaultHandler: LastfmOAuthHandler,
})

/**
 * Main entry point - checks for session_id before deferring to OAuth
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)
		const baseUrl = `${url.protocol}//${url.host}`

		// Check if this is an MCP request with session_id (manual login flow)
		if (url.pathname === '/mcp') {
			const sessionId = url.searchParams.get('session_id')

			if (sessionId) {
				// Use session-based auth for Claude Desktop
				return handleSessionBasedMcp(request, env, ctx, sessionId)
			}
		}

		// Use OAuth provider for everything else
		const response = await oauthProvider.fetch(request, env, ctx)

		// If it's a 401 from /mcp, add the resource_metadata to WWW-Authenticate header
		// This is required by RFC 9728 for OAuth discovery
		if (response.status === 401 && url.pathname === '/mcp') {
			const newHeaders = new Headers(response.headers)
			newHeaders.set(
				'WWW-Authenticate',
				`Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
			)
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers: newHeaders,
			})
		}

		return response
	},
}
