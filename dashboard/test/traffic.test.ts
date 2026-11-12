// ABOUTME: Tests the dashboard's 30-day traffic summary built from the Analytics SQL API (beta) for the production MCP Worker.
// ABOUTME: Replaces the SQL client with canned rows and checks zero-filled days, status splits, the 24-hour totals and the SQL text.
import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'

import { analyticsSqlApi, CfApiError } from '../src/cfApi'
import { fetchTraffic } from '../src/traffic'

vi.mock('../src/cfApi', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/cfApi')>()),
	analyticsSqlApi: vi.fn(),
}))

const sqlMock = vi.mocked(analyticsSqlApi)

const NOW = new Date('2026-11-12T15:30:00.000Z')

/** The exact error and non-error rules from the SQL API team */
const ERRORS_EXPR = "countIf(status NOT IN ('success', 'clientDisconnected', 'responseStreamDisconnected'))"

interface DayRow {
	day: string
	status: string
	requests: number | string
}

interface TotalsRow {
	requests: number | string
	errors: number | string
}

function isDailyQuery(sql: string): boolean {
	return sql.includes('GROUP BY')
}

/** Answers the daily query with `days` and the 24-hour query with `totals`, whatever order they're sent in */
function respond(days: DayRow[], totals: TotalsRow[]): void {
	sqlMock.mockImplementation(async (_env, sql) => (isDailyQuery(sql) ? days : totals) as never)
}

function sentQueries(): { daily: string; last24h: string } {
	const queries = sqlMock.mock.calls.map(([, sql]) => sql)
	const daily = queries.find(isDailyQuery)
	const last24h = queries.find((sql) => !isDailyQuery(sql))
	if (!daily || !last24h) throw new Error('expected one daily and one 24-hour query')
	return { daily, last24h }
}

let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
	// The SQL client is mocked; a real request reaching fetch would mean the mock leaked
	fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('traffic tests must not reach the network'))
})

afterEach(() => {
	expect(fetchSpy).not.toHaveBeenCalled()
	fetchSpy.mockRestore()
	vi.resetAllMocks()
})

describe('fetchTraffic', () => {
	it('should map the SQL rows to 30 zero-filled UTC days, oldest first, split into requests, errors and disconnects', async () => {
		respond(
			[
				{ day: '2026-11-12', status: 'success', requests: '40000' },
				{ day: '2026-11-12', status: 'clientDisconnected', requests: '5000' },
				{ day: '2026-11-12', status: 'responseStreamDisconnected', requests: '300' },
				{ day: '2026-11-12', status: 'exceededMemory', requests: '2' },
				{ day: '2026-11-09', status: 'scriptThrewException', requests: 7 },
				{ day: '2026-11-09', status: 'success', requests: 100 },
				{ day: '2026-10-14', status: 'success', requests: '3' },
			],
			[{ requests: '44000', errors: '5' }],
		)

		const traffic = await fetchTraffic(env, NOW)

		expect(traffic.days).toHaveLength(30)
		expect(traffic.days[0]).toEqual({ date: '2026-10-14', requests: 3, errors: 0, disconnected: 0 })
		expect(traffic.days[29]).toEqual({ date: '2026-11-12', requests: 45302, errors: 2, disconnected: 5300 })
		expect(traffic.days.find((day) => day.date === '2026-11-09')).toEqual({ date: '2026-11-09', requests: 107, errors: 7, disconnected: 0 })
		expect(traffic.days.find((day) => day.date === '2026-11-01')).toEqual({ date: '2026-11-01', requests: 0, errors: 0, disconnected: 0 })
		// Consecutive days with no gaps or repeats
		const dates = traffic.days.map((day) => day.date)
		expect(new Set(dates).size).toBe(30)
		expect([...dates].sort()).toEqual(dates)
		expect(traffic.last24h).toEqual({ requests: 44000, errors: 5 })
	})

	it('should count a value that is not a number as zero', async () => {
		respond([{ day: '2026-11-12', status: 'success', requests: 'lots' }], [{ requests: '', errors: 'n/a' }])

		const traffic = await fetchTraffic(env, NOW)

		expect(traffic.days[29]).toEqual({ date: '2026-11-12', requests: 0, errors: 0, disconnected: 0 })
		expect(traffic.last24h).toEqual({ requests: 0, errors: 0 })
	})

	it('should query the production script by UTC day over 30 days, with literal time bounds', async () => {
		respond([], [])

		await fetchTraffic(env, NOW)

		const { daily } = sentQueries()
		expect(daily).toContain('FROM events.workersInvocations')
		expect(daily).toContain(`scriptName = '${env.SCRIPT_NAME}'`)
		expect(daily).toContain("timestamp >= '2026-10-14T00:00:00Z'")
		expect(daily).toContain("timestamp < '2026-11-13T00:00:00Z'")
		expect(daily).toContain('toDate(timestamp) AS day')
		expect(daily).toContain('count() AS requests')
		expect(daily).toContain('GROUP BY toDate(timestamp), status')
	})

	it('should count the last 24 hours with count() and the agreed countIf error rule', async () => {
		respond([], [])

		await fetchTraffic(env, NOW)

		const { last24h } = sentQueries()
		expect(last24h).toContain('FROM events.workersInvocations')
		expect(last24h).toContain(`scriptName = '${env.SCRIPT_NAME}'`)
		expect(last24h).toContain("timestamp >= '2026-11-11T15:30:00Z'")
		expect(last24h).toContain("timestamp <= '2026-11-12T15:30:00Z'")
		expect(last24h).toContain('count() AS requests')
		expect(last24h).toContain(`${ERRORS_EXPR} AS errors`)
	})

	it('should never weight by sampleInterval or use what the dataset rejects', async () => {
		respond([], [])

		await fetchTraffic(env, NOW)

		for (const sql of Object.values(sentQueries())) {
			expect(sql).not.toMatch(/sampleInterval/i)
			expect(sql).not.toMatch(/\bFORMAT\b/i)
			expect(sql).not.toMatch(/\b(MIN|MAX)\s*\(/i)
			expect(sql).not.toMatch(/toDateTime/i)
			// ORDER BY needs a LIMIT; neither query needs an order
			expect(sql).not.toMatch(/ORDER BY/i)
		}
	})

	it('should send both queries before either answers', async () => {
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		sqlMock.mockImplementation(async () => {
			await gate
			return []
		})

		const pending = fetchTraffic(env, NOW)
		await Promise.resolve()

		expect(sqlMock).toHaveBeenCalledTimes(2)
		release()
		await expect(pending).resolves.toMatchObject({ last24h: { requests: 0, errors: 0 } })
	})

	it('should ignore rows outside the window and sum every 24-hour row', async () => {
		respond(
			[
				{ day: '2026-10-13', status: 'success', requests: 999 },
				{ day: '2026-11-13', status: 'success', requests: 999 },
			],
			[
				{ requests: 10, errors: 1 },
				{ requests: '5', errors: '0' },
			],
		)

		const traffic = await fetchTraffic(env, NOW)

		expect(traffic.days.every((day) => day.requests === 0 && day.errors === 0)).toBe(true)
		expect(traffic.last24h).toEqual({ requests: 15, errors: 1 })
	})

	it('should report zero traffic when the script has no rows at all', async () => {
		respond([], [])

		const traffic = await fetchTraffic(env, NOW)

		expect(traffic.days).toHaveLength(30)
		expect(traffic.last24h).toEqual({ requests: 0, errors: 0 })
	})

	it('should refuse a SCRIPT_NAME that is not a plain identifier before sending any query', async () => {
		respond([], [])

		await expect(fetchTraffic({ ...env, SCRIPT_NAME: "lastfm-mcp-prod' OR '1'='1" }, NOW)).rejects.toThrow(/SCRIPT_NAME/)
		await expect(fetchTraffic({ ...env, SCRIPT_NAME: '' }, NOW)).rejects.toThrow(/SCRIPT_NAME/)
		expect(sqlMock).not.toHaveBeenCalled()
	})

	it('should reject when the daily query fails, even though the 24-hour query succeeds', async () => {
		sqlMock.mockImplementation(async (_env, sql) => {
			if (isDailyQuery(sql)) throw new CfApiError(422, 'Analytics SQL API failed (422): unknown column')
			return [{ requests: 1, errors: 0 }] as never
		})

		await expect(fetchTraffic(env, NOW)).rejects.toMatchObject({ status: 422 })
	})

	it('should reject when the 24-hour query fails, even though the daily query succeeds', async () => {
		sqlMock.mockImplementation(async (_env, sql) => {
			if (!isDailyQuery(sql)) throw new CfApiError(403, 'Analytics SQL API failed (403): Authentication error')
			return [] as never
		})

		await expect(fetchTraffic(env, NOW)).rejects.toMatchObject({ status: 403 })
	})
})
