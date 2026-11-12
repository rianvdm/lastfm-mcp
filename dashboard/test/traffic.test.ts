// ABOUTME: Tests the dashboard's 30-day traffic summary built from Workers GraphQL Analytics for the production MCP Worker.
// ABOUTME: Replaces the GraphQL client with canned responses and checks zero-filled days, status splits and the 24-hour totals.
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CfApiError, graphql } from '../src/cfApi'
import { fetchTraffic } from '../src/traffic'

vi.mock('../src/cfApi', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/cfApi')>()),
	graphql: vi.fn(),
}))

const graphqlMock = vi.mocked(graphql)

const NOW = new Date('2026-11-12T15:30:00.000Z')

interface Row {
	date: string
	status: string
	requests: number
	errors: number
}

function response(rows: Row[], last24h: Array<{ requests: number; errors: number }>): unknown {
	return {
		viewer: {
			accounts: [
				{
					days: rows.map(({ date, status, requests, errors }) => ({ dimensions: { date, status }, sum: { requests, errors } })),
					last24h: last24h.map((sum) => ({ sum })),
				},
			],
		},
	}
}

afterEach(() => {
	vi.resetAllMocks()
})

describe('fetchTraffic', () => {
	it('should map the GraphQL rows to 30 zero-filled UTC days, oldest first, with the 24-hour totals', async () => {
		graphqlMock.mockResolvedValueOnce(
			response(
				[
					{ date: '2026-11-12', status: 'success', requests: 40000, errors: 0 },
					{ date: '2026-11-12', status: 'clientDisconnected', requests: 5000, errors: 0 },
					{ date: '2026-11-09', status: 'scriptThrewException', requests: 7, errors: 7 },
					{ date: '2026-11-09', status: 'success', requests: 100, errors: 0 },
					{ date: '2026-10-14', status: 'success', requests: 3, errors: 0 },
				],
				[{ requests: 44000, errors: 5 }],
			),
		)

		const traffic = await fetchTraffic(env, NOW)

		expect(traffic.days).toHaveLength(30)
		expect(traffic.days[0]).toEqual({ date: '2026-10-14', requests: 3, errors: 0, disconnected: 0 })
		expect(traffic.days[29]).toEqual({ date: '2026-11-12', requests: 45000, errors: 0, disconnected: 5000 })
		expect(traffic.days.find((day) => day.date === '2026-11-09')).toEqual({ date: '2026-11-09', requests: 107, errors: 7, disconnected: 0 })
		expect(traffic.days.find((day) => day.date === '2026-11-01')).toEqual({ date: '2026-11-01', requests: 0, errors: 0, disconnected: 0 })
		// Consecutive days with no gaps or repeats
		const dates = traffic.days.map((day) => day.date)
		expect(new Set(dates).size).toBe(30)
		expect([...dates].sort()).toEqual(dates)
		expect(traffic.last24h).toEqual({ requests: 44000, errors: 5 })
	})

	it('should ask for the production script over the 30-day window and the last 24 hours in one request', async () => {
		graphqlMock.mockResolvedValueOnce(response([], []))

		await fetchTraffic(env, NOW)

		expect(graphqlMock).toHaveBeenCalledTimes(1)
		const [, query, variables] = graphqlMock.mock.calls[0]
		expect(query).toContain('workersInvocationsAdaptive')
		expect(query).toContain('datetime_geq')
		expect(variables).toEqual({
			accountTag: env.ACCOUNT_ID,
			scriptName: env.SCRIPT_NAME,
			since: '2026-10-14',
			until: '2026-11-12',
			since24h: '2026-11-11T15:30:00.000Z',
			now: '2026-11-12T15:30:00.000Z',
		})
	})

	it('should ignore rows outside the window and sum every 24-hour row', async () => {
		graphqlMock.mockResolvedValueOnce(
			response(
				[{ date: '2026-10-13', status: 'success', requests: 999, errors: 9 }],
				[
					{ requests: 10, errors: 1 },
					{ requests: 5, errors: 0 },
				],
			),
		)

		const traffic = await fetchTraffic(env, NOW)

		expect(traffic.days.every((day) => day.requests === 0 && day.errors === 0)).toBe(true)
		expect(traffic.last24h).toEqual({ requests: 15, errors: 1 })
	})

	it('should report zero traffic when the account has no rows at all', async () => {
		graphqlMock.mockResolvedValueOnce(response([], []))

		const traffic = await fetchTraffic(env, NOW)

		expect(traffic.days).toHaveLength(30)
		expect(traffic.last24h).toEqual({ requests: 0, errors: 0 })
	})

	it('should throw a GraphQL CfApiError when the account is missing from the response', async () => {
		graphqlMock.mockResolvedValueOnce({ viewer: { accounts: [] } })

		const failure = fetchTraffic(env, NOW)

		await expect(failure).rejects.toBeInstanceOf(CfApiError)
		await expect(failure).rejects.toThrow(/^GraphQL/)
	})

	it('should let a GraphQL failure reject', async () => {
		graphqlMock.mockRejectedValueOnce(new CfApiError(403, 'GraphQL failed (403): Authentication error'))

		await expect(fetchTraffic(env, NOW)).rejects.toMatchObject({ status: 403 })
	})
})
