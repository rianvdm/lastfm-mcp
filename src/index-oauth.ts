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
import { MARKETING_PAGE_HTML } from './marketing-page'
import { createMcpServer } from './mcp/server'
import { PROTOCOL_VERSION } from './types/mcp'
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
 * Strip the 'resource' parameter from a request body to prevent audience mismatch.
 * workers-oauth-provider validates audience against ${protocol}//${host} (no path),
 * but Claude.ai sends the full MCP endpoint URL as resource (with /mcp path).
 */
async function stripResourceFromRequest(request: Request): Promise<Request> {
	if (request.method !== 'POST') return request

	const contentType = request.headers.get('content-type') || ''
	if (!contentType.includes('application/x-www-form-urlencoded')) return request

	const body = await request.text()
	const params = new URLSearchParams(body)

	if (params.has('resource')) {
		console.log(`[OAUTH] Stripping resource param from token request: ${params.get('resource')}`)
		params.delete('resource')

		return new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: params.toString(),
		})
	}

	// Re-create request with same body (since we consumed it)
	return new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body: body,
	})
}

/**
 * Main entry point - checks for session_id before deferring to OAuth
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)
		const baseUrl = `${url.protocol}//${url.host}`

		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 200,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Connection-ID, Mcp-Session-Id, Cookie',
					'Access-Control-Expose-Headers': 'Mcp-Session-Id',
					'Access-Control-Max-Age': '86400',
				},
			})
		}

		// Serve marketing page at root
		if (url.pathname === '/' && request.method === 'GET') {
			return new Response(MARKETING_PAGE_HTML, {
				status: 200,
				headers: {
					'Content-Type': 'text/html',
					'Cache-Control': 'public, max-age=3600',
					'Access-Control-Allow-Origin': '*',
				},
			})
		}

		// MCP server discovery endpoint for Claude Desktop Connectors
		if ((url.pathname === '/.well-known/mcp.json' || url.pathname === '/.well-known/mcp') && request.method === 'GET') {
			return new Response(
				JSON.stringify({
					$schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
					version: '1.0',
					protocolVersion: PROTOCOL_VERSION,
					serverInfo: {
						name: 'lastfm-mcp',
						title: 'Last.fm MCP Server',
						version: SERVER_VERSION,
					},
					description: 'Model Context Protocol server for Last.fm listening data access. Provides tools for accessing Last.fm listening history, charts, recommendations, and music data.',
					iconUrl: 'https://www.last.fm/static/images/lastfm_avatar_twitter.52a5d69a85ac.png',
					documentationUrl: 'https://github.com/rianvdm/lastfm-mcp#readme',
					transport: {
						type: 'streamable-http',
						endpoint: '/mcp',
					},
					capabilities: {
						tools: { listChanged: true },
						prompts: { listChanged: true },
						resources: { subscribe: false, listChanged: true },
					},
					authentication: {
						required: false,
						instructions: 'Some tools work without authentication. For personalized data, authenticate via OAuth or visit the login URL.',
					},
					instructions: `To use authenticated tools, authenticate via OAuth or visit: ${baseUrl}/login?session_id=YOUR_SESSION_ID`,
					tools: ['dynamic'],
					prompts: ['dynamic'],
					resources: ['dynamic'],
				}),
				{
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
						'Cache-Control': 'public, max-age=3600',
					},
				},
			)
		}

		// Health check endpoint
		if (url.pathname === '/health' && request.method === 'GET') {
			return new Response(
				JSON.stringify({
					status: 'ok',
					timestamp: new Date().toISOString(),
					version: SERVER_VERSION,
					service: SERVER_NAME,
				}),
				{
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					},
				},
			)
		}

		// Sitemap for search engines
		if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
			return new Response(
				`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://lastfm-mcp.com/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`,
				{
					status: 200,
					headers: {
						'Content-Type': 'application/xml',
						'Cache-Control': 'public, max-age=86400',
					},
				},
			)
		}

		// Robots.txt for search engines
		if (url.pathname === '/robots.txt' && request.method === 'GET') {
			return new Response(
				`User-agent: *
Allow: /
Allow: /health
Disallow: /login
Disallow: /callback
Disallow: /mcp
Disallow: /authorize
Disallow: /oauth

Sitemap: https://lastfm-mcp.com/sitemap.xml`,
				{
					status: 200,
					headers: {
						'Content-Type': 'text/plain',
						'Cache-Control': 'public, max-age=86400',
					},
				},
			)
		}

		// Check if this is an MCP request with session_id (manual login flow)
		if (url.pathname === '/mcp') {
			const sessionId = url.searchParams.get('session_id')

			if (sessionId) {
				// Use session-based auth for Claude Desktop
				return handleSessionBasedMcp(request, env, ctx, sessionId)
			}
		}

		// Strip resource parameter from token requests to prevent audience mismatch
		if (url.pathname === '/oauth/token') {
			request = await stripResourceFromRequest(request)
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
