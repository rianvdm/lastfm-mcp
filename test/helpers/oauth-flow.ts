// ABOUTME: Shared helpers that drive the OAuth round trip (register, authorize, consent, Last.fm callback, token, refresh, MCP call).
// ABOUTME: Cookies are carried between steps like a browser would; Last.fm is mocked by each test file.
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'

import type { Env } from '../../src/types/env'

export interface WorkerLike {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}

export interface ResourceVariant {
	label: string
	resource: (origin: string) => string | undefined
}

/** The RFC 8707 `resource` shapes real clients send: absent, the bare origin, origin with slash, and the MCP endpoint. */
export const RESOURCE_VARIANTS: ResourceVariant[] = [
	{ label: 'no resource', resource: () => undefined },
	{ label: 'the origin', resource: (origin) => origin },
	{ label: 'the origin with a trailing slash', resource: (origin) => `${origin}/` },
	{ label: 'the /mcp endpoint', resource: (origin) => `${origin}/mcp` },
]

const MCP_INIT_BODY = JSON.stringify({
	jsonrpc: '2.0',
	method: 'initialize',
	params: {
		protocolVersion: '2024-11-05',
		capabilities: {},
		clientInfo: { name: 'TestClient', version: '1.0.0' },
	},
	id: 1,
})

const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'

/** Compute the PKCE S256 code challenge for a verifier. */
async function computeS256Challenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '')
}

/**
 * workers.dev hosts are validated by the MCP handler against the Host header, so
 * the header must match the origin being tested.
 */
function hostHeader(origin: string): Record<string, string> {
	return { Host: new URL(origin).host }
}

async function send(worker: WorkerLike, env: Env, request: Request): Promise<Response> {
	const ctx = createExecutionContext()
	const response = await worker.fetch(request, env, ctx)
	await waitOnExecutionContext(ctx)
	return response
}

/** Whether a Set-Cookie header's attributes delete the cookie: `Max-Age` of zero or less, or else an `Expires` in the past. */
function deletesCookie(attributes: string[]): boolean {
	const parsed = new Map<string, string>()
	for (const attribute of attributes) {
		const [name, ...rest] = attribute.split('=')
		parsed.set(name.trim().toLowerCase(), rest.join('=').trim())
	}
	// Max-Age wins over Expires (RFC 6265 §5.3)
	const maxAge = parsed.get('max-age')
	if (maxAge !== undefined) return Number(maxAge) <= 0
	const expires = parsed.get('expires')
	return expires !== undefined && Date.parse(expires) <= Date.now()
}

/**
 * Apply a response's Set-Cookie headers to a Cookie request header value, like a browser jar: set cookies
 * are added or replaced, deleted ones are dropped. Only name=value pairs are kept.
 */
export function toCookieHeader(response: Response, existing = ''): string {
	const jar = new Map<string, string>()
	for (const pair of existing.split('; ').filter(Boolean)) {
		const [name, ...rest] = pair.split('=')
		jar.set(name, rest.join('='))
	}
	for (const setCookie of response.headers.getSetCookie()) {
		const [pair, ...attributes] = setCookie.split(';')
		const [rawName, ...rest] = pair.split('=')
		const name = rawName.trim()
		if (deletesCookie(attributes)) {
			jar.delete(name)
		} else {
			jar.set(name, rest.join('=').trim())
		}
	}
	return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

/** Register a public DCR client for one or more redirect URIs and return its client_id. */
export async function registerPublicClient(worker: WorkerLike, env: Env, origin: string, redirectUris: string | string[]): Promise<string> {
	const response = await send(
		worker,
		env,
		new Request(`${origin}/oauth/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...hostHeader(origin) },
			body: JSON.stringify({
				client_name: 'Resource Compat Test Client',
				redirect_uris: Array.isArray(redirectUris) ? redirectUris : [redirectUris],
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				token_endpoint_auth_method: 'none',
			}),
		}),
	)
	if (response.status !== 201) throw new Error(`Client registration failed with ${response.status}`)
	return ((await response.json()) as { client_id: string }).client_id
}

/** Build a PKCE authorization request URL for a client. `state` defaults to a random value. */
export async function buildAuthorizeUrl(opts: {
	origin: string
	clientId: string
	redirectUri: string
	resource?: string
	state?: string
}): Promise<URL> {
	const authorizeUrl = new URL(`${opts.origin}/authorize`)
	authorizeUrl.searchParams.set('client_id', opts.clientId)
	authorizeUrl.searchParams.set('redirect_uri', opts.redirectUri)
	authorizeUrl.searchParams.set('code_challenge', await computeS256Challenge(CODE_VERIFIER))
	authorizeUrl.searchParams.set('code_challenge_method', 'S256')
	authorizeUrl.searchParams.set('response_type', 'code')
	authorizeUrl.searchParams.set('state', opts.state ?? crypto.randomUUID())
	if (opts.resource !== undefined) authorizeUrl.searchParams.set('resource', opts.resource)
	return authorizeUrl
}

/**
 * GET /authorize as a browser would. On a consent page (200) `handle` is the form's hidden handle; otherwise it
 * is empty. `cookies` is the jar after the response. The response body is left unread.
 */
export async function openConsent(
	worker: WorkerLike,
	env: Env,
	authorizeUrl: URL,
	cookies = '',
): Promise<{ response: Response; handle: string; cookies: string }> {
	const headers: Record<string, string> = hostHeader(authorizeUrl.origin)
	if (cookies) headers.Cookie = cookies
	const response = await send(worker, env, new Request(authorizeUrl.toString(), { headers }))
	const handle = response.status === 200 ? ((await response.clone().text()).match(/name="handle" value="([^"]*)"/)?.[1] ?? '') : ''
	return { response, handle, cookies: toCookieHeader(response, cookies) }
}

/** POST the consent form back to /authorize with the user's decision. */
export async function submitConsent(
	worker: WorkerLike,
	env: Env,
	origin: string,
	handle: string,
	decision: 'approve' | 'deny',
	cookies: string,
): Promise<Response> {
	const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', ...hostHeader(origin) }
	if (cookies) headers.Cookie = cookies
	return send(
		worker,
		env,
		new Request(`${origin}/authorize`, { method: 'POST', headers, body: new URLSearchParams({ handle, decision }).toString() }),
	)
}

/** The `state` carried in the `cb` URL of a redirect to Last.fm. */
export function lastfmStateFrom(response: Response): string {
	const cb = new URL(new URL(response.headers.get('Location') ?? '').searchParams.get('cb') ?? '')
	return cb.searchParams.get('state') ?? ''
}

/** GET /lastfm-callback as Last.fm's redirect would: the `cb` URL with `token` added, or without one if the user declined. */
export async function returnFromLastfm(
	worker: WorkerLike,
	env: Env,
	opts: { origin: string; state: string; cookies: string; token?: string },
): Promise<Response> {
	const callbackUrl = new URL(`${opts.origin}/lastfm-callback`)
	callbackUrl.searchParams.set('state', opts.state)
	if (opts.token !== undefined) callbackUrl.searchParams.set('token', opts.token)
	const headers: Record<string, string> = hostHeader(opts.origin)
	if (opts.cookies) headers.Cookie = opts.cookies
	return send(worker, env, new Request(callbackUrl.toString(), { headers }))
}

/** Run /authorize, approve consent, the Last.fm callback and the redirect back to the client; returns the authorization code. */
export async function signIn(
	worker: WorkerLike,
	env: Env,
	opts: { origin: string; clientId: string; redirectUri: string; resource?: string },
): Promise<{ code: string; codeVerifier: string }> {
	const { origin } = opts

	const consent = await openConsent(worker, env, await buildAuthorizeUrl(opts))
	if (consent.response.status !== 200 || !consent.handle)
		throw new Error(`/authorize returned ${consent.response.status} without a consent page`)

	const approveRes = await submitConsent(worker, env, origin, consent.handle, 'approve', consent.cookies)
	if (approveRes.status !== 302) throw new Error(`Consent approval returned ${approveRes.status}`)
	const cookies = toCookieHeader(approveRes, consent.cookies)

	// Last.fm would redirect to the `cb` URL it was given, adding a token.
	const callbackRes = await returnFromLastfm(worker, env, {
		origin,
		state: lastfmStateFrom(approveRes),
		cookies,
		token: 'simulated-lastfm-token',
	})
	if (callbackRes.status !== 302) throw new Error(`/lastfm-callback returned ${callbackRes.status}`)

	const code = new URL(callbackRes.headers.get('Location') ?? '').searchParams.get('code')
	if (!code) throw new Error('Client redirect carried no authorization code')
	return { code, codeVerifier: CODE_VERIFIER }
}

async function postToken(worker: WorkerLike, env: Env, origin: string, params: Record<string, string>): Promise<Response> {
	return send(
		worker,
		env,
		new Request(`${origin}/oauth/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...hostHeader(origin) },
			body: new URLSearchParams(params).toString(),
		}),
	)
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(
	worker: WorkerLike,
	env: Env,
	opts: { origin: string; clientId: string; redirectUri: string; code: string; codeVerifier: string; resource?: string },
): Promise<Response> {
	const params: Record<string, string> = {
		grant_type: 'authorization_code',
		code: opts.code,
		client_id: opts.clientId,
		redirect_uri: opts.redirectUri,
		code_verifier: opts.codeVerifier,
	}
	if (opts.resource !== undefined) params.resource = opts.resource
	return postToken(worker, env, opts.origin, params)
}

/** Redeem a refresh token for a new access token. */
export async function refresh(
	worker: WorkerLike,
	env: Env,
	opts: { origin: string; clientId: string; refreshToken: string; resource?: string },
): Promise<Response> {
	const params: Record<string, string> = {
		grant_type: 'refresh_token',
		refresh_token: opts.refreshToken,
		client_id: opts.clientId,
	}
	if (opts.resource !== undefined) params.resource = opts.resource
	return postToken(worker, env, opts.origin, params)
}

/** Send an MCP `initialize` request with a bearer token. */
export async function callMcp(worker: WorkerLike, env: Env, origin: string, accessToken: string): Promise<Response> {
	return send(
		worker,
		env,
		new Request(`${origin}/mcp`, {
			method: 'POST',
			body: MCP_INIT_BODY,
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				Authorization: `Bearer ${accessToken}`,
				...hostHeader(origin),
			},
		}),
	)
}
