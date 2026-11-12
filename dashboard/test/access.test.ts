// ABOUTME: Tests the dashboard's Cloudflare Access gate and the routes the Worker serves behind it.
// ABOUTME: Signs RS256 JWTs with a generated key pair and serves its public key at the team's certs URL through a mocked fetch.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type { JWK } from 'jose'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'

import { requireAccess } from '../src/access'
import type { DashEnv } from '../src/env'
import worker from '../src/index'

const AUD = 'test-access-aud'
const KEY_ID = 'test-key'
const ISSUER = `https://${env.ACCESS_TEAM_DOMAIN}`
const CERTS_URL = `${ISSUER}/cdn-cgi/access/certs`
const API_BASE = 'https://api.cloudflare.com/client/v4/'

/** wrangler.toml's env with the AUD tag the test tokens are signed for */
const accessEnv: DashEnv = { ...env, ACCESS_AUD: AUD }
/** The same, with an HMAC key, so active users are counted */
const configuredEnv: DashEnv = { ...accessEnv, ACTIVE_USER_HMAC_KEY: 'a'.repeat(32) }

const GRANT_SUMMARY = {
	computedAt: '2026-11-12T15:17:00.000Z',
	liveGrants: 3,
	liveUsers: 2,
	noExpiryGrants: 0,
	pendingGrants: 0,
	unresolvedGrants: 0,
	registeredClients: 5,
	signInsLast7d: 1,
	signInsByDay: [],
	clients: [],
}

let signingKey: CryptoKey
let publicJwk: JWK

interface TokenOptions {
	aud?: string
	iss?: string
	/** Seconds since the epoch */
	exp?: number
	key?: CryptoKey
}

async function signToken({ aud = AUD, iss = ISSUER, exp, key = signingKey }: TokenOptions = {}): Promise<string> {
	const now = Math.floor(Date.now() / 1000)
	return new SignJWT({ email: 'owner@example.com' })
		.setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
		.setIssuer(iss)
		.setAudience(aud)
		.setIssuedAt(exp === undefined ? now : exp - 300)
		.setExpirationTime(exp ?? now + 300)
		.sign(key)
}

// A Request typed as one the Worker receives from the edge, so it fits the fetch handler's parameter
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>

function requestWith(token?: string, path = '/'): Request<unknown, IncomingRequestCfProperties> {
	const headers = new Headers()
	if (token !== undefined) headers.set('Cf-Access-Jwt-Assertion', token)
	return new IncomingRequest(`https://stats.lastfm-mcp.com${path}`, { headers })
}

beforeAll(async () => {
	const { publicKey, privateKey } = await generateKeyPair('RS256')
	signingKey = privateKey
	publicJwk = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: 'RS256', use: 'sig' }
})

beforeEach(() => {
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const url = input instanceof Request ? input.url : String(input)
		if (url === CERTS_URL) return Response.json({ keys: [publicJwk] })
		// Every Cloudflare API call is refused, so the page shows each upstream panel failing; a 403 isn't retried
		if (url.startsWith(API_BASE)) return Response.json({ success: false, errors: [{ message: 'Authentication error' }] }, { status: 403 })
		return new Response('Unexpected fetch in test', { status: 500 })
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('requireAccess', () => {
	it('should refuse a request without an Access JWT', async () => {
		const response = await requireAccess(requestWith(), accessEnv)
		expect(response?.status).toBe(403)
	})

	it('should refuse a token that is not a JWT', async () => {
		const response = await requireAccess(requestWith('not-a-jwt'), accessEnv)
		expect(response?.status).toBe(403)
	})

	it('should refuse an expired token', async () => {
		const token = await signToken({ exp: Math.floor(Date.now() / 1000) - 3600 })
		const response = await requireAccess(requestWith(token), accessEnv)
		expect(response?.status).toBe(403)
	})

	it('should refuse a token for another Access application', async () => {
		const token = await signToken({ aud: 'another-application' })
		const response = await requireAccess(requestWith(token), accessEnv)
		expect(response?.status).toBe(403)
	})

	it('should refuse a token from another issuer', async () => {
		const token = await signToken({ iss: 'https://someone-else.cloudflareaccess.com' })
		const response = await requireAccess(requestWith(token), accessEnv)
		expect(response?.status).toBe(403)
	})

	it('should refuse a token signed by a key the team does not publish', async () => {
		const { privateKey: otherKey } = await generateKeyPair('RS256')
		const token = await signToken({ key: otherKey })
		const response = await requireAccess(requestWith(token), accessEnv)
		expect(response?.status).toBe(403)
	})

	it('should refuse every request while ACCESS_AUD is unset, even a token signed for an empty audience', async () => {
		const token = await signToken({ aud: '' })
		const response = await requireAccess(requestWith(token), { ...accessEnv, ACCESS_AUD: '' })
		expect(response?.status).toBe(403)
	})

	it('should ship wrangler.toml with the Access application AUD tag and the team domain', () => {
		// A 64-hex AUD tag; an accidental empty value would lock everyone out (see the test above)
		expect(env.ACCESS_AUD).toMatch(/^[0-9a-f]{64}$/)
		expect(env.ACCESS_TEAM_DOMAIN).toBe('elezea.cloudflareaccess.com')
	})

	it('should let a valid token through', async () => {
		const response = await requireAccess(requestWith(await signToken()), accessEnv)
		expect(response).toBeNull()
	})
})

async function clearDashKv(): Promise<void> {
	const { keys } = await env.DASH_KV.list()
	await Promise.all(keys.map(({ name }) => env.DASH_KV.delete(name)))
}

/** Calls the Worker's fetch handler and waits for anything it handed to waitUntil */
async function serve(request: Request<unknown, IncomingRequestCfProperties>, workerEnv: DashEnv = accessEnv): Promise<Response> {
	const ctx = createExecutionContext()
	const response = await worker.fetch(request, workerEnv, ctx)
	await waitOnExecutionContext(ctx)
	return response
}

function kvListCalls(): number {
	return vi.mocked(fetch).mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).includes('/keys?')).length
}

describe('dashboard Worker fetch', () => {
	// Read the spy through this handle: in workerd, reading console.error again doesn't return the spy
	let errorSpy: MockInstance<typeof console.error>

	beforeEach(async () => {
		await clearDashKv()
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	it('should refuse the page without an Access JWT', async () => {
		const response = await serve(requestWith())
		expect(response.status).toBe(403)
	})

	it('should serve the page at GET / with a valid token', async () => {
		const response = await serve(requestWith(await signToken()))
		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Type')).toContain('text/html')
		expect(response.headers.get('Cache-Control')).toBe('private, no-store')
		expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
	})

	it('should render each failing upstream panel as couldn\u2019t load, by HTTP status only', async () => {
		const html = await (await serve(requestWith(await signToken()))).text()

		expect(html).toContain("couldn't load: HTTP 403")
		expect(html).not.toContain('Authentication error')
	})

	it('should say the grant summary is warming up and start one refresh while it is missing', async () => {
		const first = await (await serve(requestWith(await signToken()))).text()
		expect(first).toContain('warming up')
		// The refresh ran through waitUntil, hit the refused KV list, and logged only the status
		expect(errorSpy).toHaveBeenCalledWith('[STATS] grant summary refresh failed (status 403)')
		const listsAfterFirst = kvListCalls()
		expect(listsAfterFirst).toBeGreaterThan(0)

		// A reload while the first refresh is still within its window doesn't start another one
		await serve(requestWith(await signToken()))
		expect(kvListCalls()).toBe(listsAfterFirst)
	})

	it('should not start a refresh when the grant summary exists and active users are not configured', async () => {
		await env.DASH_KV.put('summary:grants', JSON.stringify(GRANT_SUMMARY))

		const html = await (await serve(requestWith(await signToken()))).text()

		expect(html).not.toContain('warming up')
		expect(html).toContain('not configured')
		expect(kvListCalls()).toBe(0)
	})

	it('should start a refresh when active users are configured but have no summary yet', async () => {
		await env.DASH_KV.put('summary:grants', JSON.stringify(GRANT_SUMMARY))

		const html = await (await serve(requestWith(await signToken()), configuredEnv)).text()

		expect(html).toContain('warming up: the first active-user count is being computed')
		expect(errorSpy).toHaveBeenCalledWith('[STATS] active user refresh failed (status 403)')
		expect(kvListCalls()).toBeGreaterThan(0)
	})

	it('should not start a refresh when both summaries exist', async () => {
		await env.DASH_KV.put('summary:grants', JSON.stringify(GRANT_SUMMARY))
		await env.DASH_KV.put(
			'summary:active-users',
			JSON.stringify({ computedAt: '2026-11-12T15:17:00.000Z', dau: 1, wau: 1, mau: 1, activeByDay: [], activeSince: '2026-11-12' }),
		)

		const html = await (await serve(requestWith(await signToken()), configuredEnv)).text()

		expect(html).not.toContain('warming up')
		expect(kvListCalls()).toBe(0)
	})

	it('should return 404 for any other path with a valid token', async () => {
		const response = await serve(requestWith(await signToken(), '/nope'))
		expect(response.status).toBe(404)
	})

	it('should refuse an unknown path without a token before routing it', async () => {
		const response = await serve(requestWith(undefined, '/nope'))
		expect(response.status).toBe(403)
	})
})
