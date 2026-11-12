// ABOUTME: Tests for recordToolEvent, which labels a tool call's OAuth client and writes the event to Analytics Engine.
// ABOUTME: Covers the client-name lookup and its memo, and that a missing binding, a failing write or a failing KV read never rejects.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'

import type { ToolCallEvent } from '../../src/analytics/toolEvents'
import { recordToolEvent } from '../../src/analytics/recordToolEvent'
import { SERVER_VERSION } from '../../src/mcp/protocol'
import type { Env } from '../../src/types/env'

const EVENT: ToolCallEvent = { tool: 'get_top_artists', outcome: 'ok', cache: 'miss', durationMs: 42 }

/** An env whose OAUTH_KV.get answers with `get` and whose TOOL_EVENTS records writes, unless `toolEvents` overrides it. */
function fakeEnv(get: (key: string, type: string) => Promise<unknown>, toolEvents: unknown = { writeDataPoint: vi.fn() }) {
	const kvGet = vi.fn(get)
	const env = { OAUTH_KV: { get: kvGet }, TOOL_EVENTS: toolEvents } as unknown as Env
	return { env, kvGet, writeDataPoint: (toolEvents as { writeDataPoint?: ReturnType<typeof vi.fn> } | undefined)?.writeDataPoint }
}

/** A registered (DCR) client ID nobody else uses, so the module-level memo can't carry state between tests. */
function freshClientId(): string {
	return `dcr-${crypto.randomUUID()}`
}

describe('recordToolEvent', () => {
	// The failure paths log on purpose; capture those warnings so they can be asserted and stay out of the test output
	let warn: MockInstance<typeof console.warn>

	beforeEach(() => {
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	})

	afterEach(() => {
		warn.mockRestore()
	})

	it('should label a registered client by its stored clientName and write one data point', async () => {
		const clientId = freshClientId()
		const { env, kvGet, writeDataPoint } = fakeEnv(async () => ({ clientId, clientName: 'Claude' }))

		await recordToolEvent(env, clientId, EVENT)

		expect(kvGet).toHaveBeenCalledWith(`client:${clientId}`, 'json')
		expect(writeDataPoint).toHaveBeenCalledTimes(1)
		expect(writeDataPoint).toHaveBeenCalledWith({
			indexes: ['get_top_artists'],
			blobs: ['get_top_artists', 'Claude', 'ok', 'miss', SERVER_VERSION],
			doubles: [42],
		})
	})

	it('should not read KV again for a client it has already labelled', async () => {
		const clientId = freshClientId()
		const { env, kvGet, writeDataPoint } = fakeEnv(async () => ({ clientId, clientName: 'Claude' }))

		await recordToolEvent(env, clientId, EVENT)
		await recordToolEvent(env, clientId, EVENT)

		expect(kvGet).toHaveBeenCalledTimes(1)
		expect(writeDataPoint).toHaveBeenCalledTimes(2)
		expect(writeDataPoint?.mock.calls[1][0].blobs[1]).toBe('Claude')
	})

	it('should label a CIMD client from its URL without reading KV', async () => {
		const { env, kvGet, writeDataPoint } = fakeEnv(async () => null)

		await recordToolEvent(env, 'https://claude.ai/oauth/claude-code-client-metadata', EVENT)

		expect(kvGet).not.toHaveBeenCalled()
		expect(writeDataPoint?.mock.calls[0][0].blobs[1]).toBe('Claude Code')
	})

	it('should never write a username carried by a client name or a CIMD URL', async () => {
		const { env, writeDataPoint } = fakeEnv(async () => ({ clientName: 'rianvdm' }))

		await recordToolEvent(env, freshClientId(), EVENT)
		await recordToolEvent(env, 'https://dc2.example/rianvdm/client.json', EVENT)

		const labels = writeDataPoint?.mock.calls.map((call) => call[0].blobs[1])
		expect(labels).toEqual(['other', 'other'])
		expect(JSON.stringify(writeDataPoint?.mock.calls)).not.toContain('rianvdm')
	})

	it('should label the event unknown when there is no client ID, without reading KV', async () => {
		const { env, kvGet, writeDataPoint } = fakeEnv(async () => null)

		await recordToolEvent(env, undefined, EVENT)

		expect(kvGet).not.toHaveBeenCalled()
		expect(writeDataPoint?.mock.calls[0][0].blobs[1]).toBe('unknown')
	})

	it('should resolve without throwing when TOOL_EVENTS is not bound', async () => {
		const { env } = fakeEnv(async () => ({ clientName: 'Claude' }))
		delete env.TOOL_EVENTS
		expect('TOOL_EVENTS' in env).toBe(false)

		await expect(recordToolEvent(env, freshClientId(), EVENT)).resolves.toBeUndefined()
		expect(warn).not.toHaveBeenCalled()
	})

	it('should resolve without throwing when writeDataPoint throws', async () => {
		const writeDataPoint = vi.fn(() => {
			throw new Error('dataset unavailable')
		})
		const { env } = fakeEnv(async () => ({ clientName: 'Claude' }), { writeDataPoint })

		await expect(recordToolEvent(env, freshClientId(), EVENT)).resolves.toBeUndefined()
		expect(writeDataPoint).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledOnce()
		expect(warn).toHaveBeenCalledWith('[ANALYTICS] tool event not recorded:', 'dataset unavailable')
	})

	it('should still write the point, labelled unknown, when the KV read rejects', async () => {
		const { env, writeDataPoint } = fakeEnv(async () => {
			throw new Error('KV down')
		})

		await expect(recordToolEvent(env, freshClientId(), EVENT)).resolves.toBeUndefined()
		expect(writeDataPoint).toHaveBeenCalledTimes(1)
		expect(writeDataPoint?.mock.calls[0][0].blobs[1]).toBe('unknown')
		expect(warn).toHaveBeenCalledOnce()
		expect(warn).toHaveBeenCalledWith('[ANALYTICS] client lookup failed:', 'KV down')
	})

	it('should read KV again after a failed read instead of remembering unknown', async () => {
		const clientId = freshClientId()
		const { env, kvGet, writeDataPoint } = fakeEnv(async () => ({ clientName: 'Claude' }))
		kvGet.mockRejectedValueOnce(new Error('KV blip'))

		await recordToolEvent(env, clientId, EVENT)
		await recordToolEvent(env, clientId, EVENT)

		expect(kvGet).toHaveBeenCalledTimes(2)
		expect(writeDataPoint?.mock.calls.map((call) => call[0].blobs[1])).toEqual(['unknown', 'Claude'])
		expect(warn).toHaveBeenCalledOnce()
		expect(warn).toHaveBeenCalledWith('[ANALYTICS] client lookup failed:', 'KV blip')
	})

	it('should keep at most 500 labels, forgetting the oldest first', async () => {
		const { env, kvGet } = fakeEnv(async () => ({ clientName: 'Some Client' }))
		const clientIds = Array.from({ length: 501 }, freshClientId)

		for (const clientId of clientIds) await recordToolEvent(env, clientId, EVENT)
		expect(kvGet).toHaveBeenCalledTimes(501)

		// The newest 500 are still memoised; the first one was evicted to make room for the 501st
		await recordToolEvent(env, clientIds[500], EVENT)
		expect(kvGet).toHaveBeenCalledTimes(501)
		await recordToolEvent(env, clientIds[0], EVENT)
		expect(kvGet).toHaveBeenCalledTimes(502)
	})
})
