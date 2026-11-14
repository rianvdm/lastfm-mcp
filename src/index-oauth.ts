// ABOUTME: Worker entry point: static pages, discovery, per-IP rate limits, and the OAuth 2.1 provider in front of /mcp.
// ABOUTME: Every MCP request needs an OAuth access token; the provider handles registration, authorization and tokens.
import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import type { ExecutionContext } from '@cloudflare/workers-types'
import { createMcpHandler, type CreateMcpHandlerOptions } from 'agents/mcp/server'

import { recordToolEvent } from './analytics/recordToolEvent'
import { LastfmOAuthHandler, type LastfmUserProps } from './auth/oauth-handler'
import { normalizeAuthorizeResource, normalizeTokenResource } from './auth/resource-indicator'
import { PROTOCOL_VERSION, SERVER_VERSION } from './mcp/protocol'
import { createMcpServer } from './mcp/server'
import { buildLandingPage, LANDING_PAGE_UPDATED } from './pages/landing'
import { buildLlmsTxt } from './pages/llms-txt'
import appleTouchIcon from './pages/share/apple-touch-icon.png'
import shareCard from './pages/share/og.png'
import type { Env } from './types/env'
import { httpsRedirect } from './utils/httpsRedirect'
import { buildRateLimitResponse, checkRateLimit, rateLimitKeyFromRequest } from './utils/rateLimit'
import { allowClientRegistration, buildRegistrationRateLimitResponse } from './utils/registrationRateLimit'

/**
 * Options for the MCP handler.
 *
 * Non-browser clients (Claude.ai, Claude Code, Claude Desktop) send no Origin
 * and are always accepted. Browser-based clients must come from the custom
 * domain or local dev tooling (the MCP inspector against `wrangler dev`).
 * Setting this option replaces the handler's defaults rather than extending
 * them, which is why localhost is listed explicitly. Host validation is left
 * to Cloudflare routing: the handler only checks Host on localhost and
 * workers.dev endpoints, and lastfm-mcp.com is configured in the dashboard,
 * not in wrangler.toml.
 */
const MCP_HANDLER_OPTIONS: CreateMcpHandlerOptions = {
	allowedOriginHostnames: ['lastfm-mcp.com', 'localhost', '127.0.0.1'],
}

/**
 * Serves MCP requests that carry a valid OAuth access token
 */
const mcpApiHandler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// workers-oauth-provider sets ctx.auth next to ctx.props. Only the client ID is read: it labels tool-call events,
		// which carry no user identifier. The write runs in waitUntil and recordToolEvent never rejects, so recording
		// can't fail or delay a tool call.
		const clientId = (ctx as unknown as { auth?: { clientId?: string } }).auth?.clientId
		const { server, setContext } = createMcpServer(env, {
			onToolCall: (event) => ctx.waitUntil(recordToolEvent(env, clientId, event)),
		})

		// Set session from OAuth context.
		// workers-oauth-provider injects the user props from completeAuthorization() into ctx.props.
		const props = (ctx as unknown as { props?: LastfmUserProps }).props
		if (props?.sessionKey && props?.username) {
			setContext({
				session: { username: props.username, sessionKey: props.sessionKey },
			})
		}

		// The server is built per request above, so the factory can hand back the already-configured instance.
		return createMcpHandler(() => server, MCP_HANDLER_OPTIONS)(request, env, ctx)
	},
}

/** Images served as-is, rendered from src/pages/share/*.html by scripts/render-share-images.mjs */
const SHARE_IMAGES = new Map<string, ArrayBuffer>([
	['/og.png', shareCard],
	['/apple-touch-icon.png', appleTouchIcon],
])

/** Longest client_name kept in the registration log line. The name is self-asserted, so it is capped. */
const LOGGED_CLIENT_NAME_MAX = 100

/**
 * Log an accepted dynamic client registration so abuse shows up in Workers logs. Reads the provider's 201 body
 * (RFC 7591 §3.2.1), which echoes the validated metadata. Logging never affects the response.
 */
async function logClientRegistration(response: Response): Promise<void> {
	try {
		const client = (await response.clone().json()) as { client_name?: unknown; redirect_uris?: unknown }
		const clientName = typeof client.client_name === 'string' ? client.client_name.slice(0, LOGGED_CLIENT_NAME_MAX) : null
		const redirectUris = Array.isArray(client.redirect_uris) ? client.redirect_uris : []
		const redirectHosts = [...new Set(redirectUris.flatMap((uri) => (URL.canParse(String(uri)) ? [new URL(String(uri)).host] : [])))]
		console.log('[OAUTH] client registered', { clientName, redirectHosts })
	} catch (error) {
		console.warn('[OAUTH] client registered, response not readable for logging:', error instanceof Error ? error.message : 'Unknown error')
	}
}

const oauthProviders = new Map<string, OAuthProvider>()

/**
 * The OAuth provider for one origin, built on first use and reused after that.
 *
 * The protected resource is the bare origin, and it becomes every token's audience. The provider compares
 * stored grants against it exactly (an empty path and `/` compare equal), and almost every grant issued by
 * 0.10.3 carries the origin, with or without a trailing slash, or no resource at all. It must stay the bare
 * origin: grants bound to `${origin}/mcp` would match neither way, and get `invalid_grant` on refresh so
 * the client signs in again. The Worker answers on the custom domain and on workers.dev, so each origin
 * gets its own provider.
 */
function getOAuthProvider(origin: string): OAuthProvider {
	const existing = oauthProviders.get(origin)
	if (existing) return existing

	const provider = new OAuthProvider({
		resourceMetadata: { resource: origin },
		apiRoute: '/mcp',
		apiHandler: mcpApiHandler,
		authorizeEndpoint: '/authorize',
		tokenEndpoint: '/oauth/token',
		clientRegistrationEndpoint: '/oauth/register',
		// Accept HTTPS-URL client_ids backed by a Client ID Metadata Document (CIMD), the
		// MCP 2026-07-28 preferred registration path. Requires the global_fetch_strictly_public
		// compatibility flag in wrangler.toml. Dynamic client registration stays enabled above
		// for clients that don't support CIMD.
		clientIdMetadataDocumentEnabled: true,
		defaultHandler: LastfmOAuthHandler,
		// Log the library's internal reason (e.g. grant_audience_unbound, resource_not_configured) so
		// production logs can count them. The wire response stays generic.
		onError: ({ status, code, internal }) => console.warn('[OAUTH] error', { status, code, ...internal }),
	})
	oauthProviders.set(origin, provider)
	return provider
}

/**
 * Main entry point: serves the static routes, applies rate limits, then defers to the OAuth provider
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		// The OAuth provider can't be built for a plain-http origin outside loopback, so send those to https first
		const redirect = httpsRedirect(url)
		if (redirect) {
			// Pathname only: the query can carry `state` or `code`
			console.log('[HTTP] redirect to https', { method: request.method, path: url.pathname })
			return redirect
		}

		const baseUrl = `${url.protocol}//${url.host}`

		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 200,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers':
						'Content-Type, Authorization, X-Connection-ID, Cookie, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
					'Access-Control-Max-Age': '86400',
				},
			})
		}

		// Landing page, with setup addresses pointing at the origin it was fetched from
		if (url.pathname === '/' && request.method === 'GET') {
			return new Response(buildLandingPage(url.origin), {
				status: 200,
				headers: {
					'Content-Type': 'text/html; charset=utf-8',
					'Cache-Control': 'public, max-age=3600',
					'Access-Control-Allow-Origin': '*',
				},
			})
		}

		// Share card for link previews (og:image) and the home-screen icon. HEAD is answered too, for preview checkers
		// that test an image exists before fetching it.
		const shareImage = SHARE_IMAGES.get(url.pathname)
		if (shareImage && (request.method === 'GET' || request.method === 'HEAD')) {
			return new Response(request.method === 'HEAD' ? null : shareImage, {
				status: 200,
				headers: {
					'Content-Type': 'image/png',
					'Cache-Control': 'public, max-age=86400',
				},
			})
		}

		// MCP server discovery endpoint for Claude Desktop Connectors
		if ((url.pathname === '/.well-known/mcp.json' || url.pathname === '/.well-known/mcp') && request.method === 'GET') {
			return new Response(
				JSON.stringify({
					version: '1.0',
					protocolVersion: PROTOCOL_VERSION,
					serverInfo: {
						name: 'lastfm-mcp',
						title: 'Last.fm MCP Server',
						version: SERVER_VERSION,
					},
					description:
						'Model Context Protocol server for Last.fm listening data access. Provides tools for accessing Last.fm listening history, charts, recommendations, and music data.',
					iconUrl: 'https://lastfm-mcp.com/apple-touch-icon.png',
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
						required: true,
						instructions: 'Sign in with OAuth 2.1. Your MCP client starts the Last.fm sign-in when the server answers 401.',
					},
					instructions: 'Connect this server in your MCP client and sign in with Last.fm when prompted.',
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
		}

		// Sitemap for search engines. lastmod only moves when the page does; Google ignores changefreq and priority.
		if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
			return new Response(
				`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://lastfm-mcp.com/</loc>
    <lastmod>${LANDING_PAGE_UPDATED}</lastmod>
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

		// Robots.txt: one group for every crawler. No Crawl-delay or per-bot groups: Google's parser can merge a
		// Crawl-delay-only group into the next group's Disallow lines.
		if (url.pathname === '/robots.txt' && request.method === 'GET') {
			return new Response(
				`User-agent: *
Allow: /
Allow: /health
Allow: /llms.txt
Allow: /og.png
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

		// Setup instructions for agents, pointing at the origin they were fetched from
		if (url.pathname === '/llms.txt' && request.method === 'GET') {
			return new Response(buildLlmsTxt(url.origin), {
				status: 200,
				headers: {
					'Content-Type': 'text/plain; charset=utf-8',
					'Cache-Control': 'public, max-age=86400',
				},
			})
		}

		// Check if this is an MCP request
		if (url.pathname === '/mcp') {
			// Per-IP rate limit guards the shared LASTFM_API_KEY budget against abuse.
			// 60 req/min/IP is well above any legitimate interactive client; tune from logs.
			const rlResult = await checkRateLimit(env.MCP_RL, rateLimitKeyFromRequest(request))
			if (!rlResult.allowed) {
				return buildRateLimitResponse(rlResult)
			}

			// Then the OAuth provider: a valid bearer token is served by mcpApiHandler; without one the provider
			// answers 401 + WWW-Authenticate, which starts the client's OAuth sign-in. A leftover `?session_id=`
			// from the retired /login flow is ignored, so those clients land in the same sign-in.
		}

		// Dynamic client registration is open by design (the MCP authorization spec requires it), so budget it per IP.
		// The Rate Limiting binding keeps its own counts, separate from the /mcp KV budget.
		const isClientRegistration = url.pathname === '/oauth/register' && request.method === 'POST'
		if (isClientRegistration && !(await allowClientRegistration(env.REGISTRATION_RATE_LIMITER, rateLimitKeyFromRequest(request)))) {
			console.warn('[RATE_LIMIT] client registration refused')
			return buildRegistrationRateLimitResponse()
		}

		// Map a `resource` of `${origin}/mcp` to the origin on the two routes that validate it
		if (url.pathname === '/authorize') {
			request = normalizeAuthorizeResource(request, url)
		} else if (url.pathname === '/oauth/token') {
			request = await normalizeTokenResource(request)
		}

		// Use OAuth provider for everything else
		// Pass a per-request copy of env: the provider stores its helpers on `env.OAUTH_PROVIDER` only when that
		// is unset, so on a shared env the first origin's helpers would serve every later origin's /authorize.
		const response = await getOAuthProvider(url.origin).fetch(request, { ...env }, ctx)

		if (isClientRegistration && response.status === 201) {
			// Off the response path: the client gets its registration without waiting for the log line
			ctx.waitUntil(logClientRegistration(response))
		}

		// Keep the 401 challenge on /mcp byte-identical to the one 0.10.3 clients saw. The provider's own challenge
		// points at the same root metadata document (RFC 9728) but adds realm and error parameters.
		if (response.status === 401 && url.pathname === '/mcp') {
			const newHeaders = new Headers(response.headers)
			newHeaders.set('WWW-Authenticate', `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`)
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers: newHeaders,
			})
		}

		return response
	},
}
