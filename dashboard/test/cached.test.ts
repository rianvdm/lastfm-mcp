// ABOUTME: Tests the dashboard's DASH_KV read-through cache for computed traffic and tool summaries.
// ABOUTME: Uses a fake KV binding to check hits, misses, the expiration TTL, and that KV failures fail open.
import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cachedJson } from '../src/cached'
import type { DashEnv } from '../src/env'

const kv = { get: vi.fn(), put: vi.fn() }
const kvEnv: DashEnv = { ...env, DASH_KV: kv as unknown as KVNamespace }

beforeEach(() => {
	kv.get.mockResolvedValue(null)
	kv.put.mockResolvedValue(undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
	vi.resetAllMocks()
	vi.restoreAllMocks()
})

describe('cachedJson', () => {
	it('should return the cached value without loading', async () => {
		kv.get.mockResolvedValueOnce({ answer: 42 })
		const load = vi.fn()

		expect(await cachedJson(kvEnv, 'cache:test', 300, load)).toEqual({ answer: 42 })
		expect(kv.get).toHaveBeenCalledWith('cache:test', 'json')
		expect(load).not.toHaveBeenCalled()
		expect(kv.put).not.toHaveBeenCalled()
	})

	it('should load on a miss and store the value with the TTL', async () => {
		const load = vi.fn().mockResolvedValue({ answer: 7 })

		expect(await cachedJson(kvEnv, 'cache:test', 300, load)).toEqual({ answer: 7 })
		expect(load).toHaveBeenCalledTimes(1)
		expect(kv.put).toHaveBeenCalledWith('cache:test', JSON.stringify({ answer: 7 }), { expirationTtl: 300 })
	})

	it('should not cache a failed load', async () => {
		const load = vi.fn().mockRejectedValue(new Error('upstream down'))

		await expect(cachedJson(kvEnv, 'cache:test', 300, load)).rejects.toThrow('upstream down')
		expect(kv.put).not.toHaveBeenCalled()
	})

	it('should load when the KV read fails', async () => {
		kv.get.mockRejectedValueOnce(new Error('KV unavailable'))
		const load = vi.fn().mockResolvedValue('fresh')

		expect(await cachedJson(kvEnv, 'cache:test', 300, load)).toBe('fresh')
	})

	it('should still return the value when the KV write fails', async () => {
		kv.put.mockRejectedValueOnce(new Error('KV unavailable'))

		expect(await cachedJson(kvEnv, 'cache:test', 300, async () => 'fresh')).toBe('fresh')
	})
})
