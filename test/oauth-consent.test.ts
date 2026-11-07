// ABOUTME: Integration tests for the consent step between /authorize and the redirect to Last.fm.
// ABOUTME: Covers approve, deny, replayed/unbound/expired consent, remembered approvals, CIMD clients and the Last.fm callback.
import { env } from 'cloudflare:test'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import worker from '../src/index-oauth'
import { clientMetadataDocument, mockMetadataFetch } from './helpers/cimd-fetch'
import {
	buildAuthorizeUrl,
	callMcp,
	exchangeCode,
	lastfmStateFrom,
	openConsent,
	registerPublicClient,
	returnFromLastfm,
	signIn,
	submitConsent,
	toCookieHeader,
} from './helpers/oauth-flow'

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

const ORIGIN = 'https://lastfm-mcp.com'
const HEADLINE = 'An app wants to read your Last.fm listening data'
const WEB_REDIRECT_URI = 'https://client.example.com/oauth/callback'
const OTHER_WEB_REDIRECT_URI = 'https://client.example.com/oauth/other-callback'
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60

/** The KV key the library stores a consent or upstream transaction under: the SHA-256 of its handle. */
async function transactionKey(handle: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(handle))
	const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
	return `transaction:${hex}`
}

/** Register a DCR client and open the consent page for one of its redirect URIs. */
async function startConsent(redirectUri: string, state = 'client-state') {
	const clientId = await registerPublicClient(worker, env, ORIGIN, redirectUri)
	const consent = await openConsent(worker, env, await buildAuthorizeUrl({ origin: ORIGIN, clientId, redirectUri, state }))
	expect(consent.response.status).toBe(200)
	expect(consent.handle).toBeTruthy()
	return { clientId, ...consent }
}

/** Expect a response rendered locally as an error: 400, HTML, and no redirect anywhere. */
function expectLocalError(res: Response) {
	expect(res.status).toBe(400)
	expect(res.headers.get('Content-Type')).toMatch(/^text\/html/)
	expect(res.headers.get('Location')).toBeNull()
}

describe('Consent before the Last.fm redirect', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('GET /authorize', () => {
		it('should show the consent page instead of redirecting to Last.fm', async () => {
			const { response } = await startConsent(WEB_REDIRECT_URI)

			expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
			expect(response.headers.get('Location')).toBeNull()
			expect(response.headers.get('X-Frame-Options')).toBe('DENY')
			expect(response.headers.get('Cache-Control')).toBe('no-store')
			expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
			expect(response.headers.get('Content-Security-Policy')).not.toContain('form-action')
			expect(response.headers.get('Set-Cookie')).toMatch(/^__Host-oauth-consent-/)
			const body = await response.text()
			expect(body).toContain(HEADLINE)
			// The renderer escapes the apostrophe
			expect(body).toContain('The app chose this name itself. It hasn&#039;t been checked.')
			expect(body).toContain('client.example.com')
		})

		it('should show a CIMD client its verified domain', async () => {
			const metadataUrl = `https://client.example.com/oauth/${crypto.randomUUID()}/client.json`
			mockMetadataFetch(metadataUrl, () => clientMetadataDocument(metadataUrl, { redirect_uris: [WEB_REDIRECT_URI] }))

			const { response } = await openConsent(
				worker,
				env,
				await buildAuthorizeUrl({ origin: ORIGIN, clientId: metadataUrl, redirectUri: WEB_REDIRECT_URI }),
			)

			expect(response.status).toBe(200)
			expect(await response.text()).toContain('Published by client.example.com (verified)')
		})
	})

	describe('POST /authorize', () => {
		it('should redirect to Last.fm with state only after approval', async () => {
			const { clientId, handle, cookies } = await startConsent(WEB_REDIRECT_URI)

			const approveRes = await submitConsent(worker, env, ORIGIN, handle, 'approve', cookies)

			expect(approveRes.status).toBe(302)
			const lastfm = new URL(approveRes.headers.get('Location') ?? '')
			expect(lastfm.hostname).toBe('www.last.fm')
			const cb = new URL(lastfm.searchParams.get('cb') ?? '')
			expect(`${cb.origin}${cb.pathname}`).toBe(`${ORIGIN}/lastfm-callback`)
			expect(cb.searchParams.get('state')).toBeTruthy()
			expect(approveRes.headers.getSetCookie().some((cookie) => cookie.startsWith('__Host-oauth-upstream-'))).toBe(true)

			const { code, codeVerifier } = await signIn(worker, env, { origin: ORIGIN, clientId, redirectUri: WEB_REDIRECT_URI })
			const tokenRes = await exchangeCode(worker, env, { origin: ORIGIN, clientId, redirectUri: WEB_REDIRECT_URI, code, codeVerifier })
			expect(tokenRes.status).toBe(200)
			const { access_token } = (await tokenRes.json()) as { access_token: string }
			expect((await callMcp(worker, env, ORIGIN, access_token)).status).toBe(200)
		})

		it('should send access_denied with the original state when the user declines', async () => {
			const { handle, cookies } = await startConsent(WEB_REDIRECT_URI, 'original-client-state')

			const denyRes = await submitConsent(worker, env, ORIGIN, handle, 'deny', cookies)

			expect(denyRes.status).toBe(302)
			const location = new URL(denyRes.headers.get('Location') ?? '')
			expect(`${location.origin}${location.pathname}`).toBe(WEB_REDIRECT_URI)
			expect(location.searchParams.get('error')).toBe('access_denied')
			expect(location.searchParams.get('state')).toBe('original-client-state')
			expect(location.searchParams.get('iss')).toBe(ORIGIN)
			expect(location.searchParams.get('code')).toBeNull()
		})

		it('should refuse a replayed handle without redirecting', async () => {
			const { handle, cookies } = await startConsent(WEB_REDIRECT_URI)

			const first = await submitConsent(worker, env, ORIGIN, handle, 'approve', cookies)
			expect(first.status).toBe(302)
			const second = await submitConsent(worker, env, ORIGIN, handle, 'approve', cookies)

			expectLocalError(second)
		})

		it('should refuse an approval without the binding cookie without redirecting', async () => {
			const { handle } = await startConsent(WEB_REDIRECT_URI)

			const res = await submitConsent(worker, env, ORIGIN, handle, 'approve', '')

			expectLocalError(res)
		})

		it('should refuse an expired consent without redirecting', async () => {
			const { handle, cookies } = await startConsent(WEB_REDIRECT_URI)
			// KV drops the record after ten minutes; deleting it is what the expiry looks like to the Worker.
			await env.OAUTH_KV.delete(await transactionKey(handle))

			const res = await submitConsent(worker, env, ORIGIN, handle, 'approve', cookies)

			expectLocalError(res)
		})

		it('should refuse a form without a handle without redirecting', async () => {
			const { cookies } = await startConsent(WEB_REDIRECT_URI)

			const res = await submitConsent(worker, env, ORIGIN, '', 'deny', cookies)

			expectLocalError(res)
		})
	})

	describe('remembered approvals', () => {
		it('should skip the page for a remembered client and redirect URI', async () => {
			const { clientId, handle, cookies } = await startConsent(WEB_REDIRECT_URI)
			const approveRes = await submitConsent(worker, env, ORIGIN, handle, 'approve', cookies)
			const approvals = approveRes.headers.getSetCookie().find((cookie) => cookie.startsWith('__Host-oauth-approvals='))
			expect(approvals).toContain(`Max-Age=${ONE_YEAR_SECONDS}`)

			const again = await openConsent(
				worker,
				env,
				await buildAuthorizeUrl({ origin: ORIGIN, clientId, redirectUri: WEB_REDIRECT_URI }),
				toCookieHeader(approveRes, cookies),
			)

			expect(again.response.status).toBe(302)
			expect(new URL(again.response.headers.get('Location') ?? '').hostname).toBe('www.last.fm')
			expect(lastfmStateFrom(again.response)).toBeTruthy()
		})

		it('should ask again for a different redirect URI', async () => {
			const clientId = await registerPublicClient(worker, env, ORIGIN, [WEB_REDIRECT_URI, OTHER_WEB_REDIRECT_URI])
			const first = await openConsent(worker, env, await buildAuthorizeUrl({ origin: ORIGIN, clientId, redirectUri: WEB_REDIRECT_URI }))
			const approveRes = await submitConsent(worker, env, ORIGIN, first.handle, 'approve', first.cookies)
			expect(approveRes.status).toBe(302)

			const other = await openConsent(
				worker,
				env,
				await buildAuthorizeUrl({ origin: ORIGIN, clientId, redirectUri: OTHER_WEB_REDIRECT_URI }),
				toCookieHeader(approveRes, first.cookies),
			)

			expect(other.response.status).toBe(200)
			expect(await other.response.text()).toContain(HEADLINE)
		})

		it('should ask again for a loopback client on a new port', async () => {
			const clientId = await registerPublicClient(worker, env, ORIGIN, 'http://localhost/callback')
			const first = await openConsent(
				worker,
				env,
				await buildAuthorizeUrl({ origin: ORIGIN, clientId, redirectUri: 'http://localhost:51000/callback' }),
			)
			expect(first.response.status).toBe(200)
			const approveRes = await submitConsent(worker, env, ORIGIN, first.handle, 'approve', first.cookies)
			expect(approveRes.status).toBe(302)

			const newPort = await openConsent(
				worker,
				env,
				await buildAuthorizeUrl({ origin: ORIGIN, clientId, redirectUri: 'http://localhost:51001/callback' }),
				toCookieHeader(approveRes, first.cookies),
			)

			expect(newPort.response.status).toBe(200)
			expect(await newPort.response.text()).toContain('This sends access to an app on your computer.')
		})
	})

	describe('GET /lastfm-callback', () => {
		it('should send access_denied when Last.fm returns without a token', async () => {
			const { handle, cookies } = await startConsent(WEB_REDIRECT_URI, 'original-client-state')
			const approveRes = await submitConsent(worker, env, ORIGIN, handle, 'approve', cookies)

			const res = await returnFromLastfm(worker, env, {
				origin: ORIGIN,
				state: lastfmStateFrom(approveRes),
				cookies: toCookieHeader(approveRes, cookies),
			})

			expect(res.status).toBe(302)
			const location = new URL(res.headers.get('Location') ?? '')
			expect(`${location.origin}${location.pathname}`).toBe(WEB_REDIRECT_URI)
			expect(location.searchParams.get('error')).toBe('access_denied')
			expect(location.searchParams.get('state')).toBe('original-client-state')
			expect(location.searchParams.get('code')).toBeNull()
		})

		it('should refuse a callback whose state was never approved', async () => {
			const res = await returnFromLastfm(worker, env, { origin: ORIGIN, state: 'made-up', cookies: '', token: 't' })

			expectLocalError(res)
		})

		it('should refuse a callback from another browser without redirecting', async () => {
			const { handle, cookies } = await startConsent(WEB_REDIRECT_URI)
			const approveRes = await submitConsent(worker, env, ORIGIN, handle, 'approve', cookies)

			// A stolen callback URL replayed in a browser that never approved: the state is real, the cookie is missing.
			const res = await returnFromLastfm(worker, env, { origin: ORIGIN, state: lastfmStateFrom(approveRes), cookies: '', token: 't' })

			expectLocalError(res)
		})
	})
})
