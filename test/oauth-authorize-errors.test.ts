// ABOUTME: Integration tests for how /authorize answers invalid authorization requests.
// ABOUTME: Every invalid request gets a local 400 and is never redirected, whether or not the client is registered.
import { env } from 'cloudflare:test'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import worker from '../src/index-oauth'

// The source does `new LastfmAuth(...)`, so the mock implementation must be a class.
vi.mock('../src/auth/lastfm', () => ({
	LastfmAuth: class {
		getAuthUrl = vi.fn().mockImplementation((callbackUrl?: string) => {
			const params = new URLSearchParams({ api_key: 'test-key' })
			if (callbackUrl) params.set('cb', callbackUrl)
			return `https://www.last.fm/api/auth/?${params.toString()}`
		})
	},
}))

const BASE_URL = 'https://lastfm-mcp.com'
const REDIRECT_URI = 'http://localhost:3000/callback'
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

/**
 * Register a public client through dynamic client registration and return its client_id
 */
async function registerClient(): Promise<string> {
	const res = await worker.fetch(
		new Request(`${BASE_URL}/oauth/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				client_name: 'Authorize Error Test Client',
				redirect_uris: [REDIRECT_URI],
				grant_types: ['authorization_code'],
				response_types: ['code'],
				token_endpoint_auth_method: 'none',
			}),
		}),
		env,
		{} as ExecutionContext,
	)
	const { client_id } = (await res.json()) as { client_id: string }
	return client_id
}

/**
 * Send a GET /authorize with exactly the given query parameters
 */
function authorize(params: Record<string, string>): Promise<Response> {
	const url = new URL(`${BASE_URL}/authorize`)
	for (const [name, value] of Object.entries(params)) {
		url.searchParams.set(name, value)
	}
	return worker.fetch(new Request(url.toString()), env, {} as ExecutionContext)
}

describe('GET /authorize with an invalid request', () => {
	let clientId: string

	beforeEach(async () => {
		vi.clearAllMocks()
		clientId = await registerClient()
	})

	describe('when the client or its redirect_uri cannot be verified', () => {
		it('should return 400 without redirecting when client_id is missing', async () => {
			const res = await authorize({})

			expect(res.status).toBe(400)
			expect(res.headers.get('Location')).toBeNull()
			expect(await res.text()).toBe('client_id is required')
		})

		it('should return 400 without redirecting for an unknown client_id', async () => {
			const res = await authorize({
				client_id: 'not-a-registered-client',
				redirect_uri: REDIRECT_URI,
				response_type: 'code',
				code_challenge: CODE_CHALLENGE,
				code_challenge_method: 'S256',
			})

			expect(res.status).toBe(400)
			expect(res.headers.get('Location')).toBeNull()
			expect(await res.text()).toBe('Invalid client_id')
		})

		it('should return 400 without redirecting when redirect_uri is not registered for the client', async () => {
			const res = await authorize({
				client_id: clientId,
				redirect_uri: 'https://attacker.example.net/steal',
				response_type: 'code',
				code_challenge: CODE_CHALLENGE,
				code_challenge_method: 'S256',
				state: 'client-state',
			})

			expect(res.status).toBe(400)
			expect(res.headers.get('Location')).toBeNull()
			expect(await res.text()).toBe('Invalid redirect URI')
		})
	})

	describe('when the client and redirect_uri are verified', () => {
		// Registration is open to anyone, so a registered redirect_uri is not a trusted one.
		// Redirecting these errors back would turn /authorize into an open redirector.
		it('should return 400 without redirecting when response_type is missing', async () => {
			const res = await authorize({
				client_id: clientId,
				redirect_uri: REDIRECT_URI,
				code_challenge: CODE_CHALLENGE,
				code_challenge_method: 'S256',
				state: 'client-state',
			})

			expect(res.status).toBe(400)
			expect(res.headers.get('Location')).toBeNull()
			expect(await res.text()).toBe('response_type is required')
		})

		it('should return 400 without redirecting when a public client omits the PKCE challenge', async () => {
			const res = await authorize({
				client_id: clientId,
				redirect_uri: REDIRECT_URI,
				response_type: 'code',
				state: 'client-state',
			})

			expect(res.status).toBe(400)
			expect(res.headers.get('Location')).toBeNull()
			expect(await res.text()).toContain('PKCE')
		})

		it('should return 400 without redirecting when the resource is not a valid URI', async () => {
			const res = await authorize({
				client_id: clientId,
				redirect_uri: REDIRECT_URI,
				response_type: 'code',
				code_challenge: CODE_CHALLENGE,
				code_challenge_method: 'S256',
				resource: 'not a uri',
			})

			expect(res.status).toBe(400)
			expect(res.headers.get('Location')).toBeNull()
		})

		it('should answer in plain text, because the message can echo a request parameter', async () => {
			const res = await authorize({
				client_id: clientId,
				redirect_uri: REDIRECT_URI,
				response_type: '<script>alert(1)</script>',
				code_challenge: CODE_CHALLENGE,
				code_challenge_method: 'S256',
			})

			expect(res.status).toBe(400)
			expect(res.headers.get('Content-Type')).toMatch(/^text\/plain/)
		})

		it('should still redirect a valid request to Last.fm', async () => {
			const res = await authorize({
				client_id: clientId,
				redirect_uri: REDIRECT_URI,
				response_type: 'code',
				code_challenge: CODE_CHALLENGE,
				code_challenge_method: 'S256',
				state: 'client-state',
			})

			expect(res.status).toBe(302)
			expect(new URL(res.headers.get('Location') ?? '').hostname).toBe('www.last.fm')
		})
	})
})
