// ABOUTME: Tests the dashboard's Cloudflare Access gate and the routes the Worker serves behind it.
// ABOUTME: Signs RS256 JWTs with a generated key pair and serves its public key at the team's certs URL through a mocked fetch.
import { env } from 'cloudflare:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type { JWK } from 'jose'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { requireAccess } from '../src/access'
import type { DashEnv } from '../src/env'
import worker from '../src/index'

const AUD = 'test-access-aud'
const KEY_ID = 'test-key'
const ISSUER = `https://${env.ACCESS_TEAM_DOMAIN}`
const CERTS_URL = `${ISSUER}/cdn-cgi/access/certs`

/** wrangler.toml's env with the AUD tag the test tokens are signed for */
const accessEnv: DashEnv = { ...env, ACCESS_AUD: AUD }

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

	it('should ship wrangler.toml with an empty ACCESS_AUD, so an unconfigured deploy refuses everyone', async () => {
		expect(env.ACCESS_AUD).toBe('')
		const response = await requireAccess(requestWith(await signToken()), env)
		expect(response?.status).toBe(403)
	})

	it('should let a valid token through', async () => {
		const response = await requireAccess(requestWith(await signToken()), accessEnv)
		expect(response).toBeNull()
	})
})

describe('dashboard Worker fetch', () => {
	it('should refuse the page without an Access JWT', async () => {
		const response = await worker.fetch(requestWith(), accessEnv)
		expect(response.status).toBe(403)
	})

	it('should serve the page at GET / with a valid token', async () => {
		const response = await worker.fetch(requestWith(await signToken()), accessEnv)
		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Type')).toContain('text/html')
		expect(response.headers.get('Cache-Control')).toBe('private, no-store')
	})

	it('should return 404 for any other path with a valid token', async () => {
		const response = await worker.fetch(requestWith(await signToken(), '/nope'), accessEnv)
		expect(response.status).toBe(404)
	})

	it('should refuse an unknown path without a token before routing it', async () => {
		const response = await worker.fetch(requestWith(undefined, '/nope'), accessEnv)
		expect(response.status).toBe(403)
	})
})
