// ABOUTME: Tests the dashboard's per-tool and per-client usage stats built from the Analytics Engine SQL API.
// ABOUTME: Serves canned SQL rows by query shape and checks sampling weights, latency quantiles, cache hit rates and empty data.
import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { analyticsSql } from '../src/cfApi'
import type { DashEnv } from '../src/env'
import { fetchToolStats } from '../src/tools'

vi.mock('../src/cfApi', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/cfApi')>()),
	analyticsSql: vi.fn(),
}))

const sqlMock = vi.mocked(analyticsSql)

interface CannedRows {
	tools24h?: unknown[]
	tools7d?: unknown[]
	clients?: unknown[]
	first?: unknown[]
}

/** Answers each of the four queries by its shape: grouped by tool (24 h or 7 d), grouped by client, or the first event */
function serve(rows: CannedRows): void {
	sqlMock.mockImplementation(async (_env, sql) => {
		if (/min\(timestamp\)/i.test(sql)) return rows.first ?? []
		if (/blob2 AS label/.test(sql)) return rows.clients ?? []
		if (/INTERVAL '1' DAY/.test(sql)) return rows.tools24h ?? []
		if (/INTERVAL '7' DAY/.test(sql)) return rows.tools7d ?? []
		throw new Error(`Unexpected SQL in test: ${sql}`)
	})
}

function allSql(): string[] {
	return sqlMock.mock.calls.map(([, sql]) => sql)
}

beforeEach(() => {
	serve({})
})

afterEach(() => {
	vi.resetAllMocks()
})

describe('fetchToolStats', () => {
	it('should map SQL rows, which return 64-bit counts as strings, to tool rows sorted by calls', async () => {
		serve({
			tools24h: [
				{ tool: 'ping', calls: '3', errors: '0', auth_required: '0', p50: 1, p95: 2.5, hits: '0', misses: '0' },
				{ tool: 'get_recent_tracks', calls: '40', errors: '2', auth_required: '4', p50: 120.4, p95: 840, hits: '30', misses: '10' },
			],
			tools7d: [{ tool: 'get_recent_tracks', calls: 200, errors: 10, auth_required: 12, p50: 110, p95: 900, hits: 150, misses: 50 }],
			clients: [
				{ label: 'Claude', calls: '150' },
				{ label: 'ChatGPT', calls: '50' },
			],
			first: [{ first_event: '2026-11-10 08:15:00', events: '243' }],
		})

		const stats = await fetchToolStats(env)

		expect(stats.firstEventAt).toBe('2026-11-10T08:15:00.000Z')
		expect(stats.last24h).toEqual([
			{ tool: 'get_recent_tracks', calls: 40, errors: 2, authRequired: 4, p50Ms: 120.4, p95Ms: 840, cacheHitRate: 0.75 },
			{ tool: 'ping', calls: 3, errors: 0, authRequired: 0, p50Ms: 1, p95Ms: 2.5, cacheHitRate: null },
		])
		expect(stats.last7d).toEqual([
			{ tool: 'get_recent_tracks', calls: 200, errors: 10, authRequired: 12, p50Ms: 110, p95Ms: 900, cacheHitRate: 0.75 },
		])
		expect(stats.clients7d).toEqual([
			{ label: 'Claude', calls: 150 },
			{ label: 'ChatGPT', calls: 50 },
		])
	})

	it('should give null latencies when the quantile is not a finite number', async () => {
		serve({ tools24h: [{ tool: 'ping', calls: '1', errors: '0', auth_required: '0', p50: 'nan', p95: null, hits: '0', misses: '0' }] })

		const stats = await fetchToolStats(env)

		expect(stats.last24h[0]).toMatchObject({ p50Ms: null, p95Ms: null, cacheHitRate: null })
	})

	it('should return null and empty arrays when the dataset has no events', async () => {
		const stats = await fetchToolStats(env)

		expect(stats).toEqual({ firstEventAt: null, last24h: [], last7d: [], clients7d: [] })
	})

	it('should treat the empty-set min() row (epoch timestamp, zero events) as no events', async () => {
		serve({ first: [{ first_event: '1970-01-01 00:00:00', events: '0' }] })

		expect((await fetchToolStats(env)).firstEventAt).toBeNull()
	})

	it('should weight every count and quantile by _sample_interval and read the configured dataset', async () => {
		await fetchToolStats(env)

		const statements = allSql()
		expect(statements).toHaveLength(4)
		for (const sql of statements) {
			expect(sql).toContain(`FROM ${env.TOOL_EVENTS_DATASET}`)
			expect(sql).toContain('_sample_interval')
			expect(sql).not.toMatch(/count\(/i)
		}
		const toolSql = statements.find((sql) => /INTERVAL '1' DAY/.test(sql)) ?? ''
		expect(toolSql).toContain('quantileExactWeighted(0.5)(double1, _sample_interval)')
		expect(toolSql).toContain('quantileExactWeighted(0.95)(double1, _sample_interval)')
		expect(toolSql).toContain("sumIf(_sample_interval, blob3 = 'error')")
		expect(toolSql).toContain("sumIf(_sample_interval, blob3 = 'auth_required')")
		expect(toolSql).toContain("sumIf(_sample_interval, blob4 = 'hit')")
		expect(toolSql).toContain("sumIf(_sample_interval, blob4 = 'miss')")
	})

	it('should refuse a dataset name that is not a plain identifier, before running any SQL', async () => {
		const badEnv: DashEnv = { ...env, TOOL_EVENTS_DATASET: 'events; DROP TABLE x' }

		await expect(fetchToolStats(badEnv)).rejects.toThrow(/dataset name/)
		expect(sqlMock).not.toHaveBeenCalled()
	})

	it('should reject when any query fails', async () => {
		sqlMock.mockRejectedValue(new TypeError('Network connection lost'))

		await expect(fetchToolStats(env)).rejects.toBeInstanceOf(TypeError)
	})
})
