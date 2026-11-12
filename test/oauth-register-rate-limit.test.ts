// ABOUTME: Integration tests for the per-IP rate limit on POST /oauth/register (dynamic client registration).
// ABOUTME: Covers bursts, per-IP keys, separation from the /mcp budget, other methods, fail-open, the 429 and the log lines.
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import type { RateLimit } from '@cloudflare/workers-types'
import { afterEach, describe, it, expect, vi } from 'vitest'

import worker from '../src/index-oauth'
import { REGISTRATION_RATE_LIMIT_PERIOD_SECONDS } from '../src/utils/registrationRateLimit'
import type { Env } from '../src/types/env'

const ORIGIN = 'https://lastfm-mcp.com'
// simple.limit of REGISTRATION_RATE_LIMITER in wrangler.toml, which STRICT_REGISTRATION_RATE_LIMITER uses (vitest.config.mts)
const REGISTRATION_LIMIT = (JSON.parse(env.TEST_REGISTRATION_RATE_LIMITERS) as { staging: { simple: { limit: number } } }).staging.simple
	.limit

// The suite-wide REGISTRATION_RATE_LIMITER is generous so other OAuth tests can register freely; these tests use the strict one
const strictEnv: Env = { ...env, REGISTRATION_RATE_LIMITER: env.STRICT_REGISTRATION_RATE_LIMITER }

async function send(request: Request, testEnv: Env = strictEnv): Promise<Response> {
	const ctx = createExecutionContext()
	const response = await worker.fetch(request, testEnv, ctx)
	await waitOnExecutionContext(ctx)
	return response
}

function register(ip: string, testEnv: Env = strictEnv): Promise<Response> {
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

/** Registrations already over budget for `ip`, so the next one is refused. */
async function exhaust(ip: string): Promise<void> {
	for (let i = 0; i < REGISTRATION_LIMIT; i++) expect((await register(ip)).status).toBe(201)
}

// Each test uses its own IPs: the binding's counts last a full period and aren't reset between tests.
describe('POST /oauth/register rate limit', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('should refuse the registration over the per-IP budget with an OAuth-style 429', async () => {
		await exhaust('203.0.113.1')

		const response = await register('203.0.113.1')

		expect(response.status).toBe(429)
		expect(response.headers.get('Retry-After')).toBe(String(REGISTRATION_RATE_LIMIT_PERIOD_SECONDS))
		const body = (await response.json()) as { error: string }
		expect(body.error).toBe('too_many_requests')
	})

	// Proves the wiring: local rate limiting counts exactly. In production counts are approximate and per location, and
	// a burst gets well past the budget (59 of 100 concurrent registrations admitted on staging).
	it('should refuse the registrations over budget in a burst of simultaneous registrations (counted exactly locally)', async () => {
		const statuses = (await Promise.all(Array.from({ length: 2 * REGISTRATION_LIMIT }, () => register('203.0.113.2')))).map((r) => r.status)

		expect(statuses.filter((s) => s === 201)).toHaveLength(REGISTRATION_LIMIT)
		expect(statuses.filter((s) => s === 429)).toHaveLength(REGISTRATION_LIMIT)
	})

	it('should count each IP separately', async () => {
		await exhaust('203.0.113.3')
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

	it('should leave other methods on the registration path to the provider without using the budget', async () => {
		const get = await send(new Request(`${ORIGIN}/oauth/register`, { headers: { 'CF-Connecting-IP': '203.0.113.6' } }))
		expect(get.status).toBe(405)

		for (let i = 0; i < 2 * REGISTRATION_LIMIT; i++) {
			const preflight = await send(
				new Request(`${ORIGIN}/oauth/register`, { method: 'OPTIONS', headers: { 'CF-Connecting-IP': '203.0.113.6' } }),
			)
			expect(preflight.status).toBe(200)
		}

		await exhaust('203.0.113.6')
	})

	it('should fail open and still register when the limiter throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const brokenLimiter = { limit: vi.fn().mockRejectedValue(new Error('limiter unavailable')) } as unknown as RateLimit
		const brokenEnv = { ...strictEnv, REGISTRATION_RATE_LIMITER: brokenLimiter }

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
		await exhaust('203.0.113.9')

		await register('203.0.113.9')

		expect(warn).toHaveBeenCalledWith('[RATE_LIMIT] client registration refused')
	})
})
