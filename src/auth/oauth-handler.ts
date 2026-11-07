// ABOUTME: OAuth handler integrating Last.fm authentication with the MCP OAuth 2.1 flow.
// ABOUTME: Handles /authorize (consent page and decision), /lastfm-callback, /login and /callback; discovery is served elsewhere.
import { AuthorizationError, CimdFetchError, authorizationErrorRedirect } from '@cloudflare/workers-oauth-provider'
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import type { ExecutionContext } from '@cloudflare/workers-types'

import type { Env } from '../types/env'
import { generateCSRFProtection, validateCSRFToken, buildSecurityHeaders, sanitizeText } from '../utils/security'

import { LASTFM_CONSENT_BRANDING, renderConsentErrorPage, renderConsentPage } from './consent-page'
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
 * How long an approval is remembered for a client and redirect URI: a year (the library default is 30 days).
 * No `subject` is passed with it: the Last.fm user is known only after consent, so approvals belong to the browser.
 */
const CONSENT_REMEMBER_SECONDS = 365 * 24 * 60 * 60

/** Shown when a consent form or Last.fm callback can't be matched to an approved request in this browser. */
const STALE_CONSENT_MESSAGE = 'This sign-in request expired, was already used, or was started in a different browser.'

/** Shown when a CIMD client's metadata document can't be fetched or validated. The detail stays in the logs. */
const CIMD_FAILURE_MESSAGE = 'Invalid client_id: the client metadata document could not be fetched or validated'

/**
 * OAuth handler for the Last.fm MCP server.
 *
 * Only handles auth-related routes. General routes (/, /health, /sitemap.xml,
 * /robots.txt, /.well-known/mcp.json) are handled by the main entry point
 * in index-oauth.ts to avoid duplication.
 */
export const LastfmOAuthHandler = {
	async fetch(request: Request, env: OAuthEnv, _ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		// Route requests - only auth-related paths
		switch (url.pathname) {
			case '/authorize':
				if (request.method === 'GET') {
					return handleAuthorize(request, env)
				}
				if (request.method === 'POST') {
					return handleConsentDecision(request, env)
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

			default:
				return new Response('Not found', { status: 404 })
		}
	},
}

/**
 * A short error page rendered on this origin. Used wherever redirecting back to the client would be unsafe:
 * anyone can register a client, so sending errors to its redirect URI would make this an open redirector.
 */
function consentErrorResponse(message: string): Response {
	return new Response(renderConsentErrorPage(message, LASTFM_CONSENT_BRANDING), {
		status: 400,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'Content-Security-Policy': "frame-ancestors 'none'",
			'X-Frame-Options': 'DENY',
		},
	})
}

/**
 * Start the Last.fm sign-in for an approved request. `beginUpstream` creates the `state` only now, after consent,
 * and binds it to this browser with a cookie. Last.fm sends the user back to the `cb` URL with `token` added,
 * so `state` rides in that URL's query string.
 */
async function redirectToLastfm(request: Request, env: OAuthEnv, authRequest: AuthRequest, headers?: Headers): Promise<Response> {
	const upstream = await env.OAUTH_PROVIDER.beginUpstream(authRequest, { headers })

	const callbackUrl = new URL('/lastfm-callback', request.url)
	callbackUrl.searchParams.set('state', upstream.state)
	const lastfmAuth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
	upstream.headers.set('Location', lastfmAuth.getAuthUrl(callbackUrl.toString()))

	return new Response(null, { status: 302, headers: upstream.headers })
}

/**
 * GET /authorize: validate the client's request, then show the consent page, or go straight to Last.fm when
 * this browser already approved the same client, redirect URI and resource.
 */
async function handleAuthorize(request: Request, env: OAuthEnv): Promise<Response> {
	try {
		const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request)
		// Before beginConsent, so a failed client lookup leaves nothing in KV
		const details = await env.OAUTH_PROVIDER.describeConsent(authRequest)

		if (await env.OAUTH_PROVIDER.isConsentRemembered(request, authRequest, { secret: env.CONSENT_SECRET })) {
			console.log('[OAUTH] Consent remembered, redirecting to Last.fm')
			return await redirectToLastfm(request, env, authRequest)
		}

		const consent = await env.OAUTH_PROVIDER.beginConsent(authRequest)
		// The library's headers carry the binding cookie, no-store and anti-framing. No `form-action`: Chrome applies
		// it to the redirects that follow the form POST, which would block both Last.fm and the Deny redirect.
		consent.headers.set('Content-Type', 'text/html; charset=utf-8')
		return new Response(renderConsentPage(details, consent.handle, LASTFM_CONSENT_BRANDING), { headers: consent.headers })
	} catch (error) {
		// A client_id that is a metadata document URL which couldn't be fetched or
		// validated is a client-side problem, not a server fault. The detail can
		// describe the upstream response, so log it and keep the reply generic.
		if (error instanceof CimdFetchError) {
			console.warn(`[OAUTH] Client metadata document failed for ${error.metadataUrl}: ${error.detail}`)
			return consentErrorResponse(CIMD_FAILURE_MESSAGE)
		}
		// The request itself is invalid. That is the client's mistake, not a server fault.
		// The error is shown here even when it carries a verified redirectUri: anyone can
		// register a client, so redirecting errors back would make this an open redirector.
		// Plain text, because the description can echo a request parameter.
		if (error instanceof AuthorizationError) {
			console.warn(`[OAUTH] Invalid authorization request (${error.code}): ${error.description}`)
			return new Response(error.description, { status: 400 })
		}
		console.error('[OAUTH] Error in authorize:', error)
		return new Response(`Authorization error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
			status: 500,
		})
	}
}

/**
 * POST /authorize: the consent form. The form carries only the handle and the decision; the authorization
 * request comes back from storage, and only in the browser that opened the page.
 * - deny: redirect to the client's (already validated) redirect URI with `access_denied` and its `state`
 * - approve: remember the approval for a year, then start the Last.fm sign-in
 */
async function handleConsentDecision(request: Request, env: OAuthEnv): Promise<Response> {
	let form: FormData
	try {
		form = await request.formData()
	} catch {
		return consentErrorResponse(STALE_CONSENT_MESSAGE)
	}
	const handle = String(form.get('handle') ?? '')

	try {
		if (form.get('decision') !== 'approve') {
			const denied = await env.OAUTH_PROVIDER.denyConsent(request, handle)
			console.log('[OAUTH] Consent denied, redirecting to client with access_denied')
			return new Response(null, { status: 302, headers: denied.headers })
		}

		const approved = await env.OAUTH_PROVIDER.approveConsent(request, handle, {
			remember: { secret: env.CONSENT_SECRET, maxAgeSeconds: CONSENT_REMEMBER_SECONDS },
		})
		console.log('[OAUTH] Consent approved, redirecting to Last.fm')
		// Awaited so a storage failure in beginUpstream reaches the catch below
		return await redirectToLastfm(request, env, approved.request, approved.headers)
	} catch (error) {
		// Expired, already used, or opened in another browser. Shown here, never redirected: start again.
		if (error instanceof AuthorizationError) {
			console.warn(`[OAUTH] Consent refused (${error.code}): ${error.description}`)
			return consentErrorResponse(STALE_CONSENT_MESSAGE)
		}
		console.error('[OAUTH] Error in consent decision:', error)
		return new Response(`Authorization error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
			status: 500,
		})
	}
}

/**
 * Last.fm callback handler - exchanges token and completes MCP OAuth
 *
 * After Last.fm auth, Last.fm redirects here with a token. We:
 * 1. Recover the approved OAuth request from `state` (only in the browser that approved it)
 * 2. Without a token (the user declined at Last.fm), send the client `access_denied`
 * 3. Exchange the token for a Last.fm session
 * 4. Complete the MCP OAuth flow with the user's identity
 */
async function handleLastfmCallback(request: Request, env: OAuthEnv): Promise<Response> {
	try {
		const { request: authRequest, headers } = await env.OAUTH_PROVIDER.finishUpstream(request)

		const token = new URL(request.url).searchParams.get('token')
		if (!token) {
			console.log('[OAUTH] Last.fm returned without a token, redirecting to client with access_denied')
			headers.set('Location', authorizationErrorRedirect(authRequest, 'access_denied'))
			return new Response(null, { status: 302, headers })
		}

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
			request: authRequest,
			userId: username,
			metadata: {
				label: 'Last.fm MCP Access',
				lastfmUsername: username,
				authorizedAt: new Date().toISOString(),
			},
			scope: authRequest.scope,
			props: userProps,
		})

		console.log(`[OAUTH] MCP OAuth completed, redirecting to client`)

		// Redirect back to the MCP client
		headers.set('Location', redirectTo)
		return new Response(null, { status: 302, headers })
	} catch (error) {
		// No approved request for this state in this browser: never approved, expired, already used, or another
		// browser (including sign-ins started before consent existed). Shown here, never redirected: start again.
		if (error instanceof AuthorizationError) {
			console.warn(`[OAUTH] Last.fm callback refused (${error.code}): ${error.description}`)
			return consentErrorResponse(STALE_CONSENT_MESSAGE)
		}
		// completeAuthorization re-resolves a CIMD client's metadata document. If that
		// fails here the client can't be verified, so no code is issued. Same handling
		// as /authorize: log the detail, keep the reply generic.
		if (error instanceof CimdFetchError) {
			console.warn(`[OAUTH] Client metadata document failed for ${error.metadataUrl}: ${error.detail}`)
			return consentErrorResponse(CIMD_FAILURE_MESSAGE)
		}
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
 *
 * CSRF protection: A random token is stored in a __Host- secure cookie and
 * included in the callback state. The callback validates the cookie matches.
 */
async function handleManualLogin(request: Request, env: OAuthEnv): Promise<Response> {
	try {
		const url = new URL(request.url)

		// Generate a session ID for this login attempt
		// Track whether it came from an active MCP session (provided) or was generated fresh
		const providedSessionId = url.searchParams.get('session_id')
		const sessionId = providedSessionId || crypto.randomUUID()
		const fromMcpClient = !!providedSessionId

		// Generate CSRF token and store in secure cookie
		const { token: csrfToken, setCookie } = generateCSRFProtection()

		// Store pending login with CSRF token for validation on callback
		await env.MCP_SESSIONS.put(
			`login-pending:${sessionId}`,
			JSON.stringify({
				sessionId,
				csrfToken,
				fromMcpClient,
				timestamp: Date.now(),
			}),
			{ expirationTtl: 600 }, // 10 minutes
		)

		// Build callback URL - include session_id so we can look up the pending login
		const callbackUrl = `${url.protocol}//${url.host}/callback?session_id=${sessionId}`

		// Redirect to Last.fm auth
		const lastfmAuth = new LastfmAuth(env.LASTFM_API_KEY, env.LASTFM_SHARED_SECRET)
		const lastfmAuthUrl = lastfmAuth.getAuthUrl(callbackUrl)

		console.log(`[LOGIN] Manual login started, session: ${sessionId}`)

		// Redirect with CSRF cookie set
		return new Response(null, {
			status: 302,
			headers: {
				Location: lastfmAuthUrl,
				'Set-Cookie': setCookie,
			},
		})
	} catch (error) {
		console.error('[LOGIN] Error:', error)
		return new Response(`Login error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
			status: 500,
		})
	}
}

/**
 * Manual login callback - validates CSRF, exchanges token, stores session in KV.
 */
async function handleManualCallback(request: Request, env: OAuthEnv): Promise<Response> {
	try {
		const url = new URL(request.url)
		const baseUrl = `${url.protocol}//${url.host}`
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
		const pendingDataStr = await env.MCP_SESSIONS.get(pendingKey)

		if (!pendingDataStr) {
			return new Response('Login session expired. Please try again.', { status: 400 })
		}

		const pendingData = JSON.parse(pendingDataStr)
		console.log(`[LOGIN] Pending data found for session: ${sessionId}, hasCsrfToken: ${!!pendingData.csrfToken}`)

		// Validate CSRF token from cookie matches the one stored with the pending login
		let clearCookie: string
		const cookieHeader = request.headers.get('Cookie') || ''
		console.log(`[LOGIN] Cookie header present: ${!!cookieHeader}, length: ${cookieHeader.length}`)
		try {
			const result = validateCSRFToken(pendingData.csrfToken, request)
			clearCookie = result.clearCookie
			console.log(`[LOGIN] CSRF validation passed`)
		} catch (csrfError) {
			console.error('[LOGIN] CSRF validation failed:', csrfError)
			// Clean up the pending login since it's been compromised
			await env.MCP_SESSIONS.delete(pendingKey)
			return new Response(
				`Authentication failed: ${csrfError instanceof Error ? csrfError.message : 'CSRF validation failed'}. Please try logging in again.`,
				{ status: 403 },
			)
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

		const kvKey = `session:${sessionId}`
		console.log(`[LOGIN] Writing session to KV: key=${kvKey}, username=${username}`)
		await env.MCP_SESSIONS.put(kvKey, JSON.stringify(sessionData), {
			expirationTtl: 30 * 24 * 60 * 60, // 30 days
		})
		console.log(`[LOGIN] Session written to KV successfully`)

		// Sanitize username for HTML output to prevent XSS
		const safeUsername = sanitizeText(username)
		const safeSessionId = sanitizeText(sessionId)

		// Show different messages depending on whether the user came from an active MCP session
		const fromMcpClient = !!pendingData.fromMcpClient

		const instructionsHtml = fromMcpClient
			? `<div class="instructions">
		<p>Your MCP session is now connected. You can close this window and return to your conversation.</p>
		<p style="margin-top: 12px; color: #64748b; font-size: 14px;">
			Session valid for 30 days.
		</p>
	</div>`
			: `<div class="instructions">
		<h3>Next Step: Add to Your MCP Client</h3>
		<p>Use this URL in your MCP client configuration:</p>
		<div class="code">${sanitizeText(baseUrl)}/mcp?session_id=${safeSessionId}</div>
		<p style="margin-top: 12px; color: #64748b; font-size: 14px;">
			Session valid for 30 days. You can close this window.
		</p>
	</div>`

		// Return success page with security headers
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
	<h1 class="success">Authentication Successful!</h1>
	<p>You're now authenticated as <strong>${safeUsername}</strong> on Last.fm.</p>
	${instructionsHtml}
</body>
</html>`

		return new Response(successHtml, {
			status: 200,
			headers: {
				...buildSecurityHeaders({ setCookie: clearCookie }),
			},
		})
	} catch (error) {
		console.error('[LOGIN] Callback error:', error)
		return new Response(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
			status: 500,
		})
	}
}
