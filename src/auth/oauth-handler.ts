// ABOUTME: OAuth handler integrating Last.fm authentication with the MCP OAuth 2.1 flow.
// ABOUTME: Handles /authorize (consent page and decision) and /lastfm-callback; discovery is served elsewhere.
import { AuthorizationError, CimdFetchError, authorizationErrorRedirect } from '@cloudflare/workers-oauth-provider'
import type { AuthRequest, OAuthHelpers, RememberConsentOptions } from '@cloudflare/workers-oauth-provider'
import type { ExecutionContext } from '@cloudflare/workers-types'

import type { Env } from '../types/env'

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

/** The library rejects a shorter `remember.secret` with a TypeError. */
const CONSENT_SECRET_MIN_LENGTH = 32

/** Set after the first warning about an unusable CONSENT_SECRET, so it's logged once per isolate, not per request. */
let consentSecretWarningLogged = false

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
 * The options for remembering approvals, or `undefined` when CONSENT_SECRET is missing or too short. Remembering
 * is a convenience, so it fails safe: without a usable secret every sign-in shows the consent page, instead of
 * every /authorize failing on the library's TypeError. Consent is enforced either way.
 */
function consentRememberOptions(env: Env): RememberConsentOptions | undefined {
	if (typeof env.CONSENT_SECRET === 'string' && env.CONSENT_SECRET.length >= CONSENT_SECRET_MIN_LENGTH) {
		return { secret: env.CONSENT_SECRET, maxAgeSeconds: CONSENT_REMEMBER_SECONDS }
	}
	if (!consentSecretWarningLogged) {
		consentSecretWarningLogged = true
		console.error(
			`[OAUTH] CONSENT_SECRET is missing or shorter than ${CONSENT_SECRET_MIN_LENGTH} characters; consent will not be remembered`,
		)
	}
	return undefined
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
 * this browser already approved the same client, redirect URI and resource (only when remembering is available).
 */
async function handleAuthorize(request: Request, env: OAuthEnv): Promise<Response> {
	try {
		const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request)
		// Before beginConsent, so a failed client lookup leaves nothing in KV
		const details = await env.OAUTH_PROVIDER.describeConsent(authRequest)

		const remember = consentRememberOptions(env)
		if (remember && (await env.OAUTH_PROVIDER.isConsentRemembered(request, authRequest, remember))) {
			console.log('[OAUTH] Consent remembered, redirecting to Last.fm')
			return await redirectToLastfm(request, env, authRequest)
		}

		const consent = await env.OAUTH_PROVIDER.beginConsent(authRequest)
		// The library's headers carry the binding cookie, no-store and anti-framing. No `form-action`: Chrome applies
		// it to the redirects that follow the form POST, which would block both Last.fm and the Deny redirect.
		consent.headers.set('Content-Type', 'text/html; charset=utf-8')
		const html = renderConsentPage(details, consent.handle, LASTFM_CONSENT_BRANDING, { remembersApproval: remember !== undefined })
		return new Response(html, { headers: consent.headers })
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
 * - approve: remember the approval for a year (when a usable CONSENT_SECRET is set), then start the Last.fm sign-in
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

		const approved = await env.OAUTH_PROVIDER.approveConsent(request, handle, { remember: consentRememberOptions(env) })
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
