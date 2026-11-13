// ABOUTME: Tests the dashboard's traffic loads from the Analytics SQL API (beta): the cron's 30-day summary and the live 24-hour totals.
// ABOUTME: Replaces the SQL client with canned rows and checks zero-filled days, status splits, the stored summary and the SQL text.
import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'

import { analyticsSqlApi, CfApiError } from '../src/cfApi'
import { fetchTrafficLast24h, readTrafficDays, refreshTrafficDays } from '../src/traffic'

vi.mock('../src/cfApi', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/cfApi')>()),
	analyticsSqlApi: vi.fn(),
}))

const sqlMock = vi.mocked(analyticsSqlApi)

const NOW = new Date('2026-11-12T15:30:00.000Z')

/** The exact error and non-error rules from the SQL API team */
const ERRORS_EXPR = "countIf(status NOT IN ('success', 'clientDisconnected', 'responseStreamDisconnected'))"

interface HourRow {
	/** The hour's start in UTC, as the SQL API writes it */
	hour: string
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
function respond(days: HourRow[], totals: TotalsRow[]): void {
	sqlMock.mockImplementation(async (_env, sql) => (isDailyQuery(sql) ? days : totals) as never)
}

/** The one query sent, which must be the daily one (`daily`) or the 24-hour one */
function sentQuery(daily: boolean): string {
	const queries = sqlMock.mock.calls.map(([, sql]) => sql)
	expect(queries).toHaveLength(1)
	expect(isDailyQuery(queries[0])).toBe(daily)
	return queries[0]
}

async function clearDashKv(): Promise<void> {
	const { keys } = await env.DASH_KV.list()
	await Promise.all(keys.map(({ name }) => env.DASH_KV.delete(name)))
}

let fetchSpy: MockInstance<typeof fetch>

beforeEach(async () => {
	await clearDashKv()
	// The SQL client is mocked; a real request reaching fetch would mean the mock leaked
	fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('traffic tests must not reach the network'))
})

afterEach(() => {
	expect(fetchSpy).not.toHaveBeenCalled()
	fetchSpy.mockRestore()
	vi.resetAllMocks()
})

describe('refreshTrafficDays', () => {
	it('should add the hourly SQL rows into 30 zero-filled Pacific days, oldest first, split into requests, errors and disconnects', async () => {
		respond(
			[
				{ hour: '2026-11-12 10:00:00', status: 'success', requests: '30000' },
				{ hour: '2026-11-12 14:00:00', status: 'success', requests: '10000' },
				{ hour: '2026-11-12 10:00:00', status: 'clientDisconnected', requests: '5000' },
				{ hour: '2026-11-12 11:00:00', status: 'responseStreamDisconnected', requests: '300' },
				{ hour: '2026-11-12 12:00:00', status: 'exceededMemory', requests: '2' },
				{ hour: '2026-11-09 20:00:00', status: 'scriptThrewException', requests: 7 },
				{ hour: '2026-11-09 20:00:00', status: 'success', requests: 100 },
				{ hour: '2026-10-14 12:00:00', status: 'success', requests: '3' },
			],
			[],
		)

		const traffic = await refreshTrafficDays(env, NOW)

		expect(traffic.computedAt).toBe(NOW.toISOString())
		expect(traffic.days).toHaveLength(30)
		expect(traffic.days[0]).toEqual({ date: '2026-10-14', requests: 3, errors: 0, disconnected: 0 })
		expect(traffic.days[29]).toEqual({ date: '2026-11-12', requests: 45302, errors: 2, disconnected: 5300 })
		expect(traffic.days.find((day) => day.date === '2026-11-09')).toEqual({ date: '2026-11-09', requests: 107, errors: 7, disconnected: 0 })
		expect(traffic.days.find((day) => day.date === '2026-11-01')).toEqual({ date: '2026-11-01', requests: 0, errors: 0, disconnected: 0 })
		// Consecutive days with no gaps or repeats
		const dates = traffic.days.map((day) => day.date)
		expect(new Set(dates).size).toBe(30)
		expect([...dates].sort()).toEqual(dates)
	})

	it('should store the summary in DASH_KV for the page to read', async () => {
		respond([{ hour: '2026-11-12 10:00:00', status: 'success', requests: 5 }], [])

		const traffic = await refreshTrafficDays(env, NOW)

		expect(await readTrafficDays(env)).toEqual(traffic)
	})

	it('should keep the previous summary when the query fails', async () => {
		respond([{ hour: '2026-11-12 10:00:00', status: 'success', requests: 5 }], [])
		const first = await refreshTrafficDays(env, NOW)
		sqlMock.mockRejectedValue(new CfApiError(422, 'Analytics SQL API failed (422): unknown column'))

		await expect(refreshTrafficDays(env, new Date(NOW.getTime() + 3_600_000))).rejects.toMatchObject({ status: 422 })

		expect(await readTrafficDays(env)).toEqual(first)
	})

	it('should read null before the first refresh', async () => {
		expect(await readTrafficDays(env)).toBeNull()
	})

	it('should put an evening hour on its Pacific date when UTC has already reached the next day', async () => {
		respond([{ hour: '2026-11-13 02:00:00', status: 'success', requests: 12 }], [])

		const traffic = await refreshTrafficDays(env, new Date('2026-11-13T02:30:00.000Z'))

		expect(traffic.days[29]).toEqual({ date: '2026-11-12', requests: 12, errors: 0, disconnected: 0 })
		expect(traffic.days[0].date).toBe('2026-10-14')
		expect(sentQuery(true)).toContain("timestamp >= '2026-10-14T00:00:00Z'")
		expect(sentQuery(true)).toContain("timestamp < '2026-11-13T03:00:00Z'")
	})

	it('should put both 1am hours of the November DST change, and its late evening, on Nov 1', async () => {
		respond(
			[
				// 23:00 PDT on Oct 31
				{ hour: '2026-11-01 06:00:00', status: 'success', requests: 1 },
				// 01:00 PDT, then 01:00 PST again an hour later
				{ hour: '2026-11-01 08:00:00', status: 'success', requests: 10 },
				{ hour: '2026-11-01 09:00:00', status: 'success', requests: 20 },
				// 23:00 PST on Nov 1
				{ hour: '2026-11-02 07:00:00', status: 'success', requests: 300 },
			],
			[],
		)

		const traffic = await refreshTrafficDays(env, NOW)

		const byDate = new Map(traffic.days.map((day) => [day.date, day.requests]))
		expect(byDate.get('2026-10-31')).toBe(1)
		expect(byDate.get('2026-11-01')).toBe(330)
		expect(byDate.get('2026-11-02')).toBe(0)
	})

	it('should count a value that is not a number as zero', async () => {
		respond([{ hour: '2026-11-12 10:00:00', status: 'success', requests: 'lots' }], [])

		const traffic = await refreshTrafficDays(env, NOW)

		expect(traffic.days[29]).toEqual({ date: '2026-11-12', requests: 0, errors: 0, disconnected: 0 })
	})

	it('should query the production script by hour from the UTC midnight before the first Pacific day, with literal time bounds', async () => {
		respond([], [])

		await refreshTrafficDays(env, NOW)

		const daily = sentQuery(true)
		expect(daily).toContain('FROM events.workersInvocations')
		expect(daily).toContain(`scriptName = '${env.SCRIPT_NAME}'`)
		expect(daily).toContain("timestamp >= '2026-10-14T00:00:00Z'")
		expect(daily).toContain("timestamp < '2026-11-12T16:00:00Z'")
		expect(daily).toContain('toStartOfHour(timestamp) AS hour')
		expect(daily).toContain('count() AS requests')
		expect(daily).toContain('GROUP BY toStartOfHour(timestamp), status')
		// The API's toDate() takes no time zone, so the query must not group by date
		expect(daily).not.toContain('toDate(')
	})

	it('should ignore rows outside the window or without a usable hour', async () => {
		respond(
			[
				// 20:00 PDT on Oct 13, before the window's first Pacific day
				{ hour: '2026-10-14 03:00:00', status: 'success', requests: 999 },
				// 01:00 PST on Nov 13, after today
				{ hour: '2026-11-13 09:00:00', status: 'success', requests: 999 },
				{ hour: 'garbage', status: 'success', requests: 999 },
			],
			[],
		)

		const traffic = await refreshTrafficDays(env, NOW)

		expect(traffic.days.every((day) => day.requests === 0 && day.errors === 0)).toBe(true)
	})

	it('should report 30 zero days when the script has no rows at all', async () => {
		respond([], [])

		const traffic = await refreshTrafficDays(env, NOW)

		expect(traffic.days).toHaveLength(30)
		expect(traffic.days.every((day) => day.requests === 0)).toBe(true)
	})
})

describe('fetchTrafficLast24h', () => {
	it('should send only the 24-hour query, with count() and the agreed countIf error rule', async () => {
		respond([], [{ requests: '44000', errors: '5' }])

		expect(await fetchTrafficLast24h(env, NOW)).toEqual({ requests: 44000, errors: 5 })

		const last24h = sentQuery(false)
		expect(last24h).toContain('FROM events.workersInvocations')
		expect(last24h).toContain(`scriptName = '${env.SCRIPT_NAME}'`)
		expect(last24h).toContain("timestamp >= '2026-11-11T15:30:00Z'")
		expect(last24h).toContain("timestamp <= '2026-11-12T15:30:00Z'")
		expect(last24h).toContain('count() AS requests')
		expect(last24h).toContain(`${ERRORS_EXPR} AS errors`)
	})

	it('should sum every row and count a value that is not a number as zero', async () => {
		respond(
			[],
			[
				{ requests: 10, errors: 1 },
				{ requests: '5', errors: '0' },
				{ requests: '', errors: 'n/a' },
			],
		)

		expect(await fetchTrafficLast24h(env, NOW)).toEqual({ requests: 15, errors: 1 })
	})

	it('should reject when the query fails', async () => {
		sqlMock.mockRejectedValue(new CfApiError(403, 'Analytics SQL API failed (403): Authentication error'))

		await expect(fetchTrafficLast24h(env, NOW)).rejects.toMatchObject({ status: 403 })
	})
})

describe('both traffic loads', () => {
	it('should never weight by sampleInterval or use what the dataset rejects', async () => {
		respond([], [])

		await refreshTrafficDays(env, NOW)
		await fetchTrafficLast24h(env, NOW)

		const queries = sqlMock.mock.calls.map(([, sql]) => sql)
		expect(queries).toHaveLength(2)
		for (const sql of queries) {
			expect(sql).not.toMatch(/sampleInterval/i)
			expect(sql).not.toMatch(/\bFORMAT\b/i)
			expect(sql).not.toMatch(/\b(MIN|MAX)\s*\(/i)
			expect(sql).not.toMatch(/toDateTime/i)
			// ORDER BY needs a LIMIT; neither query needs an order
			expect(sql).not.toMatch(/ORDER BY/i)
		}
	})

	it('should refuse a SCRIPT_NAME that is not a plain identifier before sending any query', async () => {
		respond([], [])

		for (const SCRIPT_NAME of ["lastfm-mcp-prod' OR '1'='1", '']) {
			await expect(refreshTrafficDays({ ...env, SCRIPT_NAME }, NOW)).rejects.toThrow(/SCRIPT_NAME/)
			await expect(fetchTrafficLast24h({ ...env, SCRIPT_NAME }, NOW)).rejects.toThrow(/SCRIPT_NAME/)
		}
		expect(sqlMock).not.toHaveBeenCalled()
		expect(await readTrafficDays(env)).toBeNull()
	})
})
