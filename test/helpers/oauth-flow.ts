// ABOUTME: Shared helpers that drive the OAuth round trip (register, authorize, Last.fm callback, token, refresh, MCP call).
// ABOUTME: Cookies are carried between steps so one place can later add the consent step; Last.fm is mocked by each test file.
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

/** Turn a response's Set-Cookie headers into a Cookie request header value (name=value pairs only). */
function toCookieHeader(response: Response, existing = ''): string {
	const jar = new Map<string, string>()
	for (const pair of existing.split('; ').filter(Boolean)) {
		const [name, ...rest] = pair.split('=')
		jar.set(name, rest.join('='))
	}
	for (const setCookie of response.headers.getSetCookie()) {
		const [pair] = setCookie.split(';')
		const [name, ...rest] = pair.split('=')
		jar.set(name.trim(), rest.join('=').trim())
	}
	return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

/** Register a public DCR client and return its client_id. */
export async function registerPublicClient(worker: WorkerLike, env: Env, origin: string, redirectUri: string): Promise<string> {
	const response = await send(
		worker,
		env,
		new Request(`${origin}/oauth/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...hostHeader(origin) },
			body: JSON.stringify({
				client_name: 'Resource Compat Test Client',
				redirect_uris: [redirectUri],
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				token_endpoint_auth_method: 'none',
			}),
		}),
	)
	if (response.status !== 201) throw new Error(`Client registration failed with ${response.status}`)
	return ((await response.json()) as { client_id: string }).client_id
}

/** Run /authorize, the Last.fm callback and the redirect back to the client; returns the authorization code. */
export async function signIn(
	worker: WorkerLike,
	env: Env,
	opts: { origin: string; clientId: string; redirectUri: string; resource?: string },
): Promise<{ code: string; codeVerifier: string }> {
	const { origin, clientId, redirectUri, resource } = opts

	const authorizeUrl = new URL(`${origin}/authorize`)
	authorizeUrl.searchParams.set('client_id', clientId)
	authorizeUrl.searchParams.set('redirect_uri', redirectUri)
	authorizeUrl.searchParams.set('code_challenge', await computeS256Challenge(CODE_VERIFIER))
	authorizeUrl.searchParams.set('code_challenge_method', 'S256')
	authorizeUrl.searchParams.set('response_type', 'code')
	authorizeUrl.searchParams.set('state', crypto.randomUUID())
	if (resource !== undefined) authorizeUrl.searchParams.set('resource', resource)

	const authorizeRes = await send(worker, env, new Request(authorizeUrl.toString(), { headers: hostHeader(origin) }))
	if (authorizeRes.status !== 302) throw new Error(`/authorize returned ${authorizeRes.status}`)
	let cookie = toCookieHeader(authorizeRes)

	// Last.fm would redirect to the `cb` URL it was given, adding a token.
	const cb = new URL(new URL(authorizeRes.headers.get('Location') ?? '').searchParams.get('cb') ?? '')
	const callbackUrl = new URL(`${origin}/lastfm-callback`)
	callbackUrl.searchParams.set('token', 'simulated-lastfm-token')
	callbackUrl.searchParams.set('state', cb.searchParams.get('state') ?? '')

	const callbackRes = await send(worker, env, new Request(callbackUrl.toString(), { headers: { ...hostHeader(origin), Cookie: cookie } }))
	if (callbackRes.status !== 302) throw new Error(`/lastfm-callback returned ${callbackRes.status}`)
	cookie = toCookieHeader(callbackRes, cookie)

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
