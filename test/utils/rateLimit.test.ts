// ABOUTME: Tests for the per-IP fixed-window rate limiter used to guard /mcp.

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { buildRateLimitResponse, checkRateLimit, rateLimitKeyFromRequest } from '../../src/utils/rateLimit'

const createMockKV = () => {
	const storage = new Map<string, string>()
	return {
		storage,
		get: vi.fn(async (key: string) => storage.get(key) ?? null),
		put: vi.fn(async (key: string, value: string) => {
			storage.set(key, value)
		}),
	} as unknown as KVNamespace & { storage: Map<string, string>; get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> }
}

describe('checkRateLimit', () => {
	let kv: ReturnType<typeof createMockKV>

	beforeEach(() => {
		kv = createMockKV()
	})

	it('allows requests under the limit and decrements remaining', async () => {
		const r1 = await checkRateLimit(kv, 'ip:1.2.3.4', { limit: 3, windowSeconds: 60 })
		const r2 = await checkRateLimit(kv, 'ip:1.2.3.4', { limit: 3, windowSeconds: 60 })
		const r3 = await checkRateLimit(kv, 'ip:1.2.3.4', { limit: 3, windowSeconds: 60 })

		expect(r1.allowed).toBe(true)
		expect(r1.remaining).toBe(2)
		expect(r2.remaining).toBe(1)
		expect(r3.remaining).toBe(0)
	})

	it('blocks the request that exceeds the limit', async () => {
		for (let i = 0; i < 3; i++) {
			await checkRateLimit(kv, 'ip:1.2.3.4', { limit: 3, windowSeconds: 60 })
		}
		const blocked = await checkRateLimit(kv, 'ip:1.2.3.4', { limit: 3, windowSeconds: 60 })

		expect(blocked.allowed).toBe(false)
		expect(blocked.remaining).toBe(0)
		expect(blocked.resetEpochSeconds).toBeGreaterThan(Math.floor(Date.now() / 1000))
	})

	it('isolates buckets per key', async () => {
		await checkRateLimit(kv, 'ip:1.1.1.1', { limit: 1, windowSeconds: 60 })
		const blocked = await checkRateLimit(kv, 'ip:1.1.1.1', { limit: 1, windowSeconds: 60 })
		const otherKey = await checkRateLimit(kv, 'ip:2.2.2.2', { limit: 1, windowSeconds: 60 })

		expect(blocked.allowed).toBe(false)
		expect(otherKey.allowed).toBe(true)
	})

	it('fails open when KV.get throws', async () => {
		const brokenKv = {
			get: vi.fn(async () => {
				throw new Error('KV exploded')
			}),
			put: vi.fn(),
		} as unknown as KVNamespace

		const result = await checkRateLimit(brokenKv, 'ip:1.2.3.4', { limit: 1, windowSeconds: 60 })
		expect(result.allowed).toBe(true)
	})

	it('writes with a TTL slightly larger than the window', async () => {
		await checkRateLimit(kv, 'ip:1.2.3.4', { limit: 5, windowSeconds: 60 })
		expect(kv.put).toHaveBeenCalledWith(expect.any(String), '1', { expirationTtl: 70 })
	})
})

describe('rateLimitKeyFromRequest', () => {
	it('prefers CF-Connecting-IP', () => {
		const req = new Request('https://example.com', {
			headers: { 'CF-Connecting-IP': '9.9.9.9', 'X-Forwarded-For': '1.1.1.1' },
		})
		expect(rateLimitKeyFromRequest(req)).toBe('ip:9.9.9.9')
	})

	it('falls back to X-Forwarded-For first hop', () => {
		const req = new Request('https://example.com', {
			headers: { 'X-Forwarded-For': '1.1.1.1, 2.2.2.2' },
		})
		expect(rateLimitKeyFromRequest(req)).toBe('ip:1.1.1.1')
	})

	it('falls back to "unknown" when no IP header is present', () => {
		const req = new Request('https://example.com')
		expect(rateLimitKeyFromRequest(req)).toBe('ip:unknown')
	})
})

describe('buildRateLimitResponse', () => {
	it('returns 429 with Retry-After and rate-limit headers', async () => {
		const reset = Math.floor(Date.now() / 1000) + 30
		const res = buildRateLimitResponse({ allowed: false, limit: 60, remaining: 0, resetEpochSeconds: reset })

		expect(res.status).toBe(429)
		expect(res.headers.get('Retry-After')).toBeTruthy()
		expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
		expect(res.headers.get('X-RateLimit-Limit')).toBe('60')
		expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
		expect(res.headers.get('X-RateLimit-Reset')).toBe(String(reset))

		const body = (await res.json()) as { jsonrpc: string; error: { code: number; message: string } }
		expect(body.jsonrpc).toBe('2.0')
		expect(body.error.code).toBe(-32000)
	})
})
