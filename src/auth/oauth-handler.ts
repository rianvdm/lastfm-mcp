/**
 * OAuth Handler for Last.fm MCP Server
 *
 * This handler integrates Last.fm authentication with the MCP OAuth 2.1 flow.
 * When a client initiates OAuth:
 * 1. /authorize - Stores the OAuth request, redirects to Last.fm auth
 * 2. /lastfm-callback - Receives Last.fm token, exchanges it, completes MCP OAuth
 */
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import type { ExecutionContext } from '@cloudflare/workers-types'

import type { Env } from '../types/env'

import { LastfmAuth } from './lastfm'

// Environment with OAuth provider helpers injected
interface OAuthEnv extends Env {
	OAUTH_PROVIDER: OAuthHelpers
}

/**
 * Last.fm user profile stored in OAuth props
 */
export interface LastfmUserProps {
	userId: string
	username: string
	sessionKey: string
}

/**
 * OAuth handler for the Last.fm MCP server
 */
export const LastfmOAuthHandler = {
	async fetch(request: Request, env: OAuthEnv, _ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		// Route requests
		switch (url.pathname) {
			case '/':
				return handleHomePage(request, url)

			case '/authorize':
				if (request.method === 'GET') {
					return handleAuthorize(request, env)
				}
				return new Response('Method not allowed', { status: 405 })

			case '/login':
				// Manual login flow for clients that don't support OAuth
				if (request.method === 'GET') {
					return handleManualLogin(request, env)
				}
				return new Response('Method not allowed', { status: 405 })

			case '/callback':
				// Manual login callback
				return handleManualCallback(request, env)

			case '/lastfm-callback':
				return handleLastfmCallback(request, env)

			case '/health':
				return new Response(
					JSON.stringify({
						status: 'ok',
						timestamp: new Date().toISOString(),
						version: '1.0.0',
						service: 'lastfm-mcp',
					}),
					{
						status: 200,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					},
				)

			case '/.well-known/mcp.json':
			case '/.well-known/mcp':
				return handleMcpDiscovery(request)

			case '/.well-known/oauth-protected-resource':
				return handleProtectedResourceMetadata(request)

			case '/sitemap.xml':
				return handleSitemap()

			case '/robots.txt':
				return handleRobots()

			default:
				return new Response('Not found', { status: 404 })
		}
	},
}

/**
 * Home page - returns API info JSON with login URL
 */
function handleHomePage(request: Request, url: URL): Response {
	if (request.method === 'GET') {
		const baseUrl = `${url.protocol}//${url.host}`
		return new Response(
			JSON.stringify({
				name: 'Last.fm MCP Server',
				version: '1.0.0',
				description: 'MCP server for Last.fm listening data',
				documentation: 'https://github.com/rianvdm/lastfm-mcp',
				login_url: `${baseUrl}/login`,
				endpoints: {
					mcp: '/mcp (requires authentication)',
					login: '/login (authenticate with Last.fm)',
					oauth_discovery: '/.well-known/oauth-authorization-server',
				},
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
	return new Response('Method not allowed', { status: 405 })
}

/**
 * OAuth authorize endpoint - redirects to Last.fm auth
 *
 * The MCP client calls this to start the OAuth flow. We:
 * 1. Parse the OAuth request
 * 2. Store it in KV for later retrieval
 * 3. Redirect to Last.fm auth with our callback URL
 */
async function handleAuthorize(request: Request, env: OAuthEnv): Promise<Response> {
	try {
		// Parse the OAuth request from the MCP client
		const oauthReqInfo: AuthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request)

		// Log the resource parameter Claude is sending
		console.log(`[OAUTH] Auth request - client: ${oauthReqInfo.clientId}, resource: ${JSON.stringify((oauthReqInfo as any).resource)}`)

		// IMPORTANT: Clear the resource parameter to prevent audience mismatch
		// workers-oauth-provider validates audience against ${protocol}//${host} only (no path)
		// but Claude.ai sends the full MCP endpoint URL as resource
		// By clearing it, no audience will be set on the token, avoiding the mismatch
		;(oauthReqInfo as any).resource = undefined

		// Look up client info
		const clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId)

		if (!clientInfo) {
			return new Response('Invalid client_id', { status: 400 })
		}

		// Generate a state token to link this auth request
		const stateToken = crypto.randomUUID()

		// Store the OAuth request in KV so we can retrieve it after Last.fm callback
		await env.MCP_SESSIONS.put(
			`oauth-pending:${stateToken}`,
			JSON.stringify({
				oauthReqInfo,
				clientInfo,
				timestamp: Date.now(),
			}),
			{ expirationTtl: 600 }, // 10 minutes
		)

		// Build callback URL for Last.fm
		const url = new URL(request.url)
		const callbackUrl = `${url.protocol}//${url.host}/lastfm-callback?state=${stateToken}`

		// Create Last.fm auth instance and get auth URL
		const lastfmAuth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const lastfmAuthUrl = lastfmAuth.getAuthUrl(callbackUrl)

		console.log(`[OAUTH] Redirecting to Last.fm auth, state: ${stateToken}`)

		// Redirect to Last.fm
		return Response.redirect(lastfmAuthUrl, 302)
	} catch (error) {
		console.error('[OAUTH] Error in authorize:', error)
		return new Response(`Authorization error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
			status: 500,
		})
	}
}

/**
 * Last.fm callback handler - exchanges token and completes MCP OAuth
 *
 * After Last.fm auth, Last.fm redirects here with a token. We:
 * 1. Exchange the token for a Last.fm session
 * 2. Retrieve the original OAuth request from KV
 * 3. Complete the MCP OAuth flow with the user's identity
 */
async function handleLastfmCallback(request: Request, env: OAuthEnv): Promise<Response> {
	try {
		const url = new URL(request.url)
		const token = url.searchParams.get('token')
		const stateToken = url.searchParams.get('state')

		if (!token) {
			return new Response('Missing Last.fm token', { status: 400 })
		}

		if (!stateToken) {
			return new Response('Missing state parameter', { status: 400 })
		}

		// Retrieve the pending OAuth request
		const pendingKey = `oauth-pending:${stateToken}`
		const pendingDataStr = await env.MCP_SESSIONS.get(pendingKey)

		if (!pendingDataStr) {
			return new Response('OAuth session expired or invalid. Please try again.', { status: 400 })
		}

		const pendingData = JSON.parse(pendingDataStr)
		const oauthReqInfo: AuthRequest = pendingData.oauthReqInfo

		// Clean up the pending request
		await env.MCP_SESSIONS.delete(pendingKey)

		// Exchange Last.fm token for session
		const lastfmAuth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const { sessionKey, username } = await lastfmAuth.getSessionKey(token)

		console.log(`[OAUTH] Last.fm auth successful for user: ${username}`)

		// Create user profile props that will be available in tools via getMcpAuthContext()
		const userProps: LastfmUserProps = {
			userId: username,
			username: username,
			sessionKey: sessionKey,
		}

		// Complete the MCP OAuth flow
		const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
			request: oauthReqInfo,
			userId: username,
			metadata: {
				label: 'Last.fm MCP Access',
				lastfmUsername: username,
				authorizedAt: new Date().toISOString(),
			},
			scope: oauthReqInfo.scope,
			props: userProps,
		})

		console.log(`[OAUTH] MCP OAuth completed, redirecting to client`)

		// Redirect back to the MCP client
		return Response.redirect(redirectTo, 302)
	} catch (error) {
		console.error('[OAUTH] Error in callback:', error)
		return new Response(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
			status: 500,
		})
	}
}

/**
 * Manual login handler for clients that don't support OAuth (like Claude Desktop)
 *
 * Users visit /login directly, authenticate with Last.fm, and get a success page.
 * The session is stored in KV and associated with a session_id they can use.
 */
async function handleManualLogin(request: Request, env: OAuthEnv): Promise<Response> {
	try {
		const url = new URL(request.url)

		// Generate a session ID for this login attempt
		const sessionId = url.searchParams.get('session_id') || crypto.randomUUID()

		// Store pending login
		await env.MCP_SESSIONS.put(
			`login-pending:${sessionId}`,
			JSON.stringify({
				sessionId,
				timestamp: Date.now(),
			}),
			{ expirationTtl: 600 }, // 10 minutes
		)

		// Build callback URL
		const callbackUrl = `${url.protocol}//${url.host}/callback?session_id=${sessionId}`

		// Redirect to Last.fm auth
		const lastfmAuth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const lastfmAuthUrl = lastfmAuth.getAuthUrl(callbackUrl)

		console.log(`[LOGIN] Manual login started, session: ${sessionId}`)

		return Response.redirect(lastfmAuthUrl, 302)
	} catch (error) {
		console.error('[LOGIN] Error:', error)
		return new Response(`Login error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
			status: 500,
		})
	}
}

/**
 * Manual login callback - stores session in KV for the user
 */
async function handleManualCallback(request: Request, env: OAuthEnv): Promise<Response> {
	try {
		const url = new URL(request.url)
		const token = url.searchParams.get('token')
		const sessionId = url.searchParams.get('session_id')

		if (!token) {
			return new Response('Missing Last.fm token', { status: 400 })
		}

		if (!sessionId) {
			return new Response('Missing session_id', { status: 400 })
		}

		// Verify pending login exists
		const pendingKey = `login-pending:${sessionId}`
		const pendingData = await env.MCP_SESSIONS.get(pendingKey)

		if (!pendingData) {
			return new Response('Login session expired. Please try again.', { status: 400 })
		}

		// Clean up pending login
		await env.MCP_SESSIONS.delete(pendingKey)

		// Exchange Last.fm token for session
		const lastfmAuth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const { sessionKey, username } = await lastfmAuth.getSessionKey(token)

		console.log(`[LOGIN] Last.fm auth successful for user: ${username}, session: ${sessionId}`)

		// Store session in KV (this is what the MCP tools will look up)
		const sessionData = {
			userId: username,
			sessionKey,
			username,
			timestamp: Date.now(),
			expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
			sessionId,
		}

		await env.MCP_SESSIONS.put(`session:${sessionId}`, JSON.stringify(sessionData), {
			expirationTtl: 30 * 24 * 60 * 60, // 30 days
		})

		// Return success page with instructions
		const successHtml = `<!DOCTYPE html>
<html>
<head>
	<title>Last.fm MCP - Authentication Successful</title>
	<style>
		body { font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
		.success { color: #22c55e; }
		.code { background: #f1f5f9; padding: 12px; border-radius: 6px; font-family: monospace; word-break: break-all; }
		.instructions { margin-top: 20px; padding: 16px; background: #f8fafc; border-radius: 8px; }
	</style>
</head>
<body>
	<h1 class="success">✅ Authentication Successful!</h1>
	<p>You're now authenticated as <strong>${username}</strong> on Last.fm.</p>
	
	<div class="instructions">
		<h3>Next Step: Update Your MCP Configuration</h3>
		<p>Add this session ID to your MCP server URL:</p>
		<div class="code">https://lastfm-mcp-prod.rian-db8.workers.dev/mcp?session_id=${sessionId}</div>
		<p style="margin-top: 16px; color: #64748b; font-size: 14px;">
			This session is valid for 30 days. You can close this window.
		</p>
	</div>
</body>
</html>`

		return new Response(successHtml, {
			status: 200,
			headers: { 'Content-Type': 'text/html' },
		})
	} catch (error) {
		console.error('[LOGIN] Callback error:', error)
		return new Response(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
			status: 500,
		})
	}
}

/**
 * OAuth Protected Resource Metadata (RFC 9728)
 * Required by MCP spec for OAuth discovery
 */
function handleProtectedResourceMetadata(request: Request): Response {
	const url = new URL(request.url)
	const baseUrl = `${url.protocol}//${url.host}`

	// NOTE: The resource MUST be just the base URL (no path) because
	// workers-oauth-provider validates audience against `${protocol}//${host}` only.
	// If we include /mcp, tokens will fail with "Token audience does not match resource server"
	return new Response(
		JSON.stringify({
			resource: baseUrl,
			authorization_servers: [baseUrl],
			bearer_methods_supported: ['header'],
			scopes_supported: [],
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

/**
 * MCP server discovery endpoint
 */
function handleMcpDiscovery(request: Request): Response {
	const url = new URL(request.url)
	const baseUrl = `${url.protocol}//${url.host}`

	return new Response(
		JSON.stringify({
			$schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
			version: '1.0',
			protocolVersion: '2024-11-05',
			serverInfo: {
				name: 'lastfm-mcp',
				title: 'Last.fm MCP Server',
				version: '1.0.0',
			},
			description:
				'Model Context Protocol server for Last.fm listening data access. Provides tools for accessing Last.fm listening history, charts, recommendations, and music data.',
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
				type: 'oauth2',
				authorizationUrl: `${baseUrl}/authorize`,
				tokenUrl: `${baseUrl}/oauth/token`,
				registrationUrl: `${baseUrl}/oauth/register`,
			},
			instructions: 'This server uses OAuth 2.0 for authentication. Connect via your MCP client to authenticate with your Last.fm account.',
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

/**
 * Sitemap for search engines
 */
function handleSitemap(): Response {
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

/**
 * Robots.txt for search engines
 */
function handleRobots(): Response {
	return new Response(
		`User-agent: *
Allow: /
Disallow: /authorize
Disallow: /lastfm-callback
Disallow: /oauth/
Disallow: /mcp

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
