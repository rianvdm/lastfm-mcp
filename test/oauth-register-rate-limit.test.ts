// ABOUTME: Integration tests for the per-IP rate limit on POST /oauth/register (dynamic client registration).
// ABOUTME: Covers the registration budget, its separation from the /mcp budget, the 429 shape, fail-open and the registration log line.
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, describe, it, expect, vi } from 'vitest'

import worker from '../src/index-oauth'
import type { Env } from '../src/types/env'

const ORIGIN = 'https://lastfm-mcp.com'
const REGISTRATION_LIMIT = 5

async function send(request: Request, testEnv: Env = env): Promise<Response> {
	const ctx = createExecutionContext()
	const response = await worker.fetch(request, testEnv, ctx)
	await waitOnExecutionContext(ctx)
	return response
}

function register(ip: string, testEnv: Env = env): Promise<Response> {
	return send(
		new Request(`${ORIGIN}/oauth/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
			body: JSON.stringify({
				client_name: 'Rate Limit Test Client',
				redirect_uris: ['https://client.example.com/oauth/callback'],
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				token_endpoint_auth_method: 'none',
			}),
		}),
		testEnv,
	)
}

describe('POST /oauth/register rate limit', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('should accept registrations up to the per-IP budget', async () => {
		for (let i = 0; i < REGISTRATION_LIMIT; i++) {
			expect((await register('203.0.113.1')).status).toBe(201)
		}
	})

	it('should answer the registration over the budget with a 429, Retry-After and an OAuth error body', async () => {
		for (let i = 0; i < REGISTRATION_LIMIT; i++) await register('203.0.113.2')

		const response = await register('203.0.113.2')

		expect(response.status).toBe(429)
		const retryAfter = Number(response.headers.get('Retry-After'))
		expect(retryAfter).toBeGreaterThan(0)
		expect(retryAfter).toBeLessThanOrEqual(600)
		expect(response.headers.get('X-RateLimit-Limit')).toBe(String(REGISTRATION_LIMIT))
		expect(response.headers.get('Content-Type')).toBe('application/json')
		const body = (await response.json()) as { error: string; error_description: string }
		expect(body.error).toBe('too_many_requests')
		expect(body.error_description).toContain(`Retry after ${retryAfter}s`)
	})

	it('should count each IP separately', async () => {
		for (let i = 0; i < REGISTRATION_LIMIT; i++) await register('203.0.113.3')
		expect((await register('203.0.113.3')).status).toBe(429)

		expect((await register('203.0.113.4')).status).toBe(201)
	})

	it('should keep the registration budget separate from the /mcp budget', async () => {
		for (let i = 0; i < 10; i++) {
			await send(
				new Request(`${ORIGIN}/mcp`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'CF-Connecting-IP': '203.0.113.5' },
					body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
				}),
			)
		}

		expect((await register('203.0.113.5')).status).toBe(201)
	})

	it('should not limit other methods on the registration path', async () => {
		for (let i = 0; i < REGISTRATION_LIMIT; i++) await register('203.0.113.6')

		const response = await send(new Request(`${ORIGIN}/oauth/register`, { headers: { 'CF-Connecting-IP': '203.0.113.6' } }))

		expect(response.status).not.toBe(429)
	})

	it('should fail open and still register when the rate-limit KV is down', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const brokenKv = {
			get: vi.fn().mockRejectedValue(new Error('KV unavailable')),
			put: vi.fn().mockRejectedValue(new Error('KV unavailable')),
		} as unknown as KVNamespace
		const brokenEnv = { ...env, MCP_RL: brokenKv }

		for (let i = 0; i <= REGISTRATION_LIMIT; i++) {
			expect((await register('203.0.113.7', brokenEnv)).status).toBe(201)
		}
	})

	it('should log each accepted registration with the client name and redirect hosts', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})

		await register('203.0.113.8')

		expect(log).toHaveBeenCalledWith('[OAUTH] client registered', {
			clientName: 'Rate Limit Test Client',
			redirectHosts: ['client.example.com'],
		})
	})

	it('should log a refused registration without its body', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		for (let i = 0; i < REGISTRATION_LIMIT; i++) await register('203.0.113.9')

		await register('203.0.113.9')

		expect(warn).toHaveBeenCalledWith('[RATE_LIMIT] client registration refused', { limit: REGISTRATION_LIMIT, windowSeconds: 600 })
	})
})
