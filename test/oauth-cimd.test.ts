// ABOUTME: Integration tests for OAuth Client ID Metadata Document (CIMD) support on /authorize and /lastfm-callback.
// ABOUTME: Mocks the outbound metadata fetch to cover valid, failing, and redirect-mismatched HTTPS-URL client_ids.
import { env } from 'cloudflare:test'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import worker from '../src/index-oauth'

// The source does `new LastfmAuth(...)`, so the mock implementation must be a class.
vi.mock('../src/auth/lastfm', () => ({
	LastfmAuth: class {
		getAuthUrl = vi.fn().mockImplementation((callbackUrl?: string) => {
			const params = new URLSearchParams({ api_key: 'test-key' })
			if (callbackUrl) params.set('cb', callbackUrl)
			return `https://www.last.fm/api/auth/?${params.toString()}`
		})
		getSessionKey = vi.fn().mockResolvedValue({
			sessionKey: 'mock-session-key',
			username: 'testuser',
		})
	},
}))

const BASE_URL = 'https://lastfm-mcp.com'
const REDIRECT_URI = 'https://client.example.com/oauth/callback'

/**
 * Compute PKCE S256 code challenge from a code verifier
 */
async function computeS256Challenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '')
}

/**
 * Build an /authorize request for the given client_id with PKCE
 */
async function buildAuthorizeRequest(clientId: string, redirectUri: string = REDIRECT_URI): Promise<Request> {
	const url = new URL(`${BASE_URL}/authorize`)
	url.searchParams.set('client_id', clientId)
	url.searchParams.set('redirect_uri', redirectUri)
	url.searchParams.set('code_challenge', await computeS256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
	url.searchParams.set('code_challenge_method', 'S256')
	url.searchParams.set('response_type', 'code')
	url.searchParams.set('state', crypto.randomUUID())
	return new Request(url.toString())
}

/**
 * Build a valid metadata document response for the given client_id URL
 */
function validDocument(metadataUrl: string): Response {
	return new Response(
		JSON.stringify({
			client_id: metadataUrl,
			client_name: 'Example CIMD Client',
			redirect_uris: [REDIRECT_URI],
			grant_types: ['authorization_code'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
	)
}

/**
 * Extract the URL string from a fetch input
 */
function fetchTarget(input: RequestInfo | URL): string {
	return input instanceof Request ? input.url : input.toString()
}

/**
 * Route outbound fetches for a single metadata URL to a canned response; everything else
 * goes to the real fetch. Each test uses a unique metadata URL so the provider's CIMD
 * cache can't carry a document over between tests.
 */
function mockMetadataFetch(metadataUrl: string, response: () => Response) {
	const realFetch = globalThis.fetch
	return vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
		if (fetchTarget(input) === metadataUrl) {
			return Promise.resolve(response())
		}
		return realFetch(input, init)
	})
}

describe('OAuth Client ID Metadata Documents', () => {
	let metadataUrl: string

	beforeEach(() => {
		vi.clearAllMocks()
		metadataUrl = `https://client.example.com/oauth/${crypto.randomUUID()}/client.json`
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('GET /authorize with an HTTPS-URL client_id', () => {
		it('should fetch the metadata document and redirect to Last.fm', async () => {
			const fetchSpy = mockMetadataFetch(metadataUrl, () => validDocument(metadataUrl))

			const res = await worker.fetch(await buildAuthorizeRequest(metadataUrl), env, {} as ExecutionContext)

			expect(fetchSpy.mock.calls.some(([input]) => fetchTarget(input) === metadataUrl)).toBe(true)
			expect(res.status).toBe(302)
			expect(res.headers.get('Location') ?? '').toContain('last.fm')
		})

		it('should return 400 without internals when the metadata document cannot be fetched', async () => {
			mockMetadataFetch(metadataUrl, () => new Response('upstream secret detail', { status: 503 }))

			const res = await worker.fetch(await buildAuthorizeRequest(metadataUrl), env, {} as ExecutionContext)

			expect(res.status).toBe(400)
			const body = await res.text()
			expect(body).toContain('Invalid client_id')
			expect(body).not.toContain('503')
			expect(body).not.toContain('upstream secret detail')
		})

		it('should return 400 when the metadata document does not validate', async () => {
			// The document's client_id must exactly match the URL it was fetched from
			mockMetadataFetch(
				metadataUrl,
				() =>
					new Response(
						JSON.stringify({
							client_id: 'https://someone-else.example.com/client.json',
							client_name: 'Mismatched Client',
							redirect_uris: [REDIRECT_URI],
							token_endpoint_auth_method: 'none',
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } },
					),
			)

			const res = await worker.fetch(await buildAuthorizeRequest(metadataUrl), env, {} as ExecutionContext)

			expect(res.status).toBe(400)
			expect(await res.text()).toContain('Invalid client_id')
		})

		it('should not redirect when the document does not list the requested redirect_uri', async () => {
			mockMetadataFetch(metadataUrl, () => validDocument(metadataUrl))

			const res = await worker.fetch(
				await buildAuthorizeRequest(metadataUrl, 'https://attacker.example.net/steal'),
				env,
				{} as ExecutionContext,
			)

			// The exact status for this AuthorizationError is not pinned here; what matters is
			// that the user is never sent to Last.fm (or anywhere else) for an unlisted redirect_uri.
			expect(res.status).not.toBe(302)
			expect(res.headers.get('Location') ?? '').not.toContain('last.fm')
		})
	})

	describe('GET /lastfm-callback for a CIMD client', () => {
		it('should return 400 without internals when the document cannot be re-fetched at completion', async () => {
			// Fetches during /authorize succeed; fetches during the callback (completeAuthorization) fail.
			// /authorize resolves the document more than once, so switch on phase rather than call count.
			let failFetches = false
			let failedFetches = 0
			mockMetadataFetch(metadataUrl, () => {
				if (!failFetches) return validDocument(metadataUrl)
				failedFetches++
				return new Response('bad gateway detail', { status: 502 })
			})

			const authorizeRes = await worker.fetch(await buildAuthorizeRequest(metadataUrl), env, {} as ExecutionContext)
			expect(authorizeRes.status).toBe(302)

			// Recover the state token from the Last.fm callback URL embedded in the redirect
			const cbParam = new URL(authorizeRes.headers.get('Location') ?? '').searchParams.get('cb') ?? ''
			const stateToken = new URL(cbParam).searchParams.get('state') ?? ''
			expect(stateToken).toBeTruthy()

			const callbackUrl = new URL(`${BASE_URL}/lastfm-callback`)
			callbackUrl.searchParams.set('token', 'simulated-lastfm-token')
			callbackUrl.searchParams.set('state', stateToken)

			failFetches = true
			const res = await worker.fetch(new Request(callbackUrl.toString()), env, {} as ExecutionContext)

			expect(failedFetches).toBeGreaterThanOrEqual(1)
			expect(res.status).toBe(400)
			expect(res.headers.get('Location')).toBeNull()
			const body = await res.text()
			expect(body).toContain('Invalid client_id')
			expect(body).not.toContain(metadataUrl)
			expect(body).not.toContain('client.example.com')
			expect(body).not.toContain('502')
			expect(body).not.toContain('bad gateway detail')
		})
	})
})
