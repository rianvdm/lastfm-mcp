// ABOUTME: Tests how the dashboard assembles its page model from the cron's summaries and the live 24-hour traffic and tool loads.
// ABOUTME: Mocks each load to check that one failure becomes a short reason for its panel, and that loads are cached in DASH_KV.
import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'

import { readActiveUsersSummary } from '../src/activeUsers'
import type { ActiveUsersSummary } from '../src/activeUsers'
import { CfApiError } from '../src/cfApi'
import { readGrantSummary } from '../src/grants'
import type { GrantSummary } from '../src/grants'
import { buildDashboardModel, loadFailureReason } from '../src/model'
import { fetchToolStats } from '../src/tools'
import type { ToolStats } from '../src/tools'
import { fetchTrafficLast24h, readTrafficDays } from '../src/traffic'
import type { TrafficDays, TrafficLast24h } from '../src/traffic'

vi.mock('../src/grants', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/grants')>()),
	readGrantSummary: vi.fn(),
}))
vi.mock('../src/activeUsers', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/activeUsers')>()),
	readActiveUsersSummary: vi.fn(),
}))
vi.mock('../src/traffic', () => ({ fetchTrafficLast24h: vi.fn(), readTrafficDays: vi.fn() }))
vi.mock('../src/tools', () => ({ fetchToolStats: vi.fn() }))

const NOW = new Date('2026-11-12T15:30:00.000Z')

const SUMMARY: GrantSummary = {
	computedAt: '2026-11-12T15:17:00.000Z',
	liveGrants: 2,
	liveUsers: 1,
	noExpiryGrants: 0,
	pendingGrants: 0,
	unresolvedGrants: 0,
	registeredClients: 9,
	signInsLast7d: 1,
	signInsByDay: [],
	clients: [],
}
const ACTIVE: ActiveUsersSummary = {
	computedAt: '2026-11-12T15:17:00.000Z',
	dau: 3,
	wau: 5,
	mau: 8,
	activeByDay: [],
	activeSince: '2026-11-01',
}
const HMAC_KEY = 'h'.repeat(32)
const TRAFFIC_DAYS: TrafficDays = { computedAt: '2026-11-12T15:17:00.000Z', days: [] }
const LAST_24H: TrafficLast24h = { requests: 10, errors: 1 }
const TOOLS: ToolStats = { firstEventAt: null, last24h: [], last7d: [], clients7d: [] }

// Read the spy through this handle: in workerd, reading console.error again doesn't return the spy
let errorSpy: MockInstance<typeof console.error>

async function clearDashKv(): Promise<void> {
	const { keys } = await env.DASH_KV.list()
	await Promise.all(keys.map(({ name }) => env.DASH_KV.delete(name)))
}

beforeEach(async () => {
	await clearDashKv()
	vi.mocked(readGrantSummary).mockResolvedValue(SUMMARY)
	vi.mocked(readActiveUsersSummary).mockResolvedValue(ACTIVE)
	vi.mocked(readTrafficDays).mockResolvedValue(TRAFFIC_DAYS)
	vi.mocked(fetchTrafficLast24h).mockResolvedValue(LAST_24H)
	vi.mocked(fetchToolStats).mockResolvedValue(TOOLS)
	errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
	vi.resetAllMocks()
	vi.restoreAllMocks()
})

describe('buildDashboardModel', () => {
	it('should combine the five loads', async () => {
		expect(await buildDashboardModel({ ...env, ACTIVE_USER_HMAC_KEY: HMAC_KEY }, NOW)).toEqual({
			generatedAt: NOW.toISOString(),
			activeUsers: ACTIVE,
			grants: SUMMARY,
			trafficDays: TRAFFIC_DAYS,
			traffic24h: LAST_24H,
			tools: TOOLS,
		})
	})

	it.each([
		['missing', undefined],
		['shorter than 32 characters', 'h'.repeat(31)],
	])('should mark active users not configured, without reading them, when the HMAC key is %s', async (_case, key) => {
		const model = await buildDashboardModel({ ...env, ACTIVE_USER_HMAC_KEY: key }, NOW)

		expect(model.activeUsers).toEqual({ notConfigured: true })
		expect(readActiveUsersSummary).not.toHaveBeenCalled()
		expect(model.grants).toEqual(SUMMARY)
	})

	it('should keep a missing active-user summary as null', async () => {
		vi.mocked(readActiveUsersSummary).mockResolvedValue(null)

		expect((await buildDashboardModel({ ...env, ACTIVE_USER_HMAC_KEY: HMAC_KEY }, NOW)).activeUsers).toBeNull()
	})

	it('should turn a failed active-user read into an error for its panel', async () => {
		vi.mocked(readActiveUsersSummary).mockRejectedValue(new Error('KV down'))

		const model = await buildDashboardModel({ ...env, ACTIVE_USER_HMAC_KEY: HMAC_KEY }, NOW)

		expect(model.activeUsers).toEqual({ error: 'unexpected error' })
		expect(errorSpy).toHaveBeenCalledWith('[STATS] active users load failed: unexpected error')
	})

	it('should keep a missing daily traffic summary as null', async () => {
		vi.mocked(readTrafficDays).mockResolvedValue(null)

		expect((await buildDashboardModel(env, NOW)).trafficDays).toBeNull()
	})

	it('should turn a failed daily traffic read into an error for its panel and keep the 24-hour numbers', async () => {
		vi.mocked(readTrafficDays).mockRejectedValue(new Error('KV down'))

		const model = await buildDashboardModel(env, NOW)

		expect(model.trafficDays).toEqual({ error: 'unexpected error' })
		expect(model.traffic24h).toEqual(LAST_24H)
		expect(errorSpy).toHaveBeenCalledWith('[STATS] daily traffic load failed: unexpected error')
	})

	it('should keep a missing grant summary as null', async () => {
		vi.mocked(readGrantSummary).mockResolvedValue(null)

		expect((await buildDashboardModel(env, NOW)).grants).toBeNull()
	})

	it('should turn one failed load into an error for its panel and keep the others', async () => {
		vi.mocked(fetchToolStats).mockRejectedValue(new CfApiError(403, 'Analytics Engine SQL failed (403): grant:alice-user:abc'))

		const model = await buildDashboardModel(env, NOW)

		expect(model.tools).toEqual({ error: 'HTTP 403' })
		expect(model.grants).toEqual(SUMMARY)
		expect(model.traffic24h).toEqual(LAST_24H)
		expect(model.trafficDays).toEqual(TRAFFIC_DAYS)
		expect(JSON.stringify(model)).not.toContain('alice-user')
	})

	it('should log a failed load by its short reason only', async () => {
		vi.mocked(fetchTrafficLast24h).mockRejectedValue(new CfApiError(429, 'Analytics SQL API failed (429): grant:alice-user:abc'))

		await buildDashboardModel(env, NOW)

		expect(errorSpy).toHaveBeenCalledWith('[STATS] 24-hour traffic load failed: HTTP 429')
		expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('alice-user')
	})

	it('should serve the 24-hour traffic and tools from DASH_KV within the cache window', async () => {
		await buildDashboardModel(env, NOW)
		await buildDashboardModel(env, NOW)

		expect(fetchTrafficLast24h).toHaveBeenCalledTimes(1)
		expect(fetchToolStats).toHaveBeenCalledTimes(1)
		// The grant and daily traffic summaries are already values the cron writes, so they're read every time
		expect(readGrantSummary).toHaveBeenCalledTimes(2)
		expect(readTrafficDays).toHaveBeenCalledTimes(2)
	})

	it('should retry a failed load on the next build instead of caching the failure', async () => {
		vi.mocked(fetchTrafficLast24h).mockRejectedValueOnce(new CfApiError(500, 'Analytics SQL API failed (500)'))

		expect((await buildDashboardModel(env, NOW)).traffic24h).toEqual({ error: 'HTTP 500' })
		expect((await buildDashboardModel(env, NOW)).traffic24h).toEqual(LAST_24H)
	})
})

describe('loadFailureReason', () => {
	it('should give the HTTP status for a CfApiError', () => {
		expect(loadFailureReason(new CfApiError(403, 'KV list failed (403): Authentication error'))).toBe('HTTP 403')
	})

	it('should not echo a failure envelope that arrives with HTTP 200', () => {
		expect(loadFailureReason(new CfApiError(200, 'Analytics SQL API failed: unknown column grant:bob:1'))).toBe('unexpected response')
	})

	it('should name any other CfApiError on a 200 as an unexpected response', () => {
		expect(loadFailureReason(new CfApiError(200, 'Analytics Engine SQL returned a body that is not JSON'))).toBe('unexpected response')
	})

	it('should name a fetch TypeError as a network error', () => {
		expect(loadFailureReason(new TypeError('Network connection lost'))).toBe('network error')
	})

	it('should not echo the message of any other error', () => {
		expect(loadFailureReason(new Error('grant:alice-user:abc is broken'))).toBe('unexpected error')
		expect(loadFailureReason('a string')).toBe('unexpected error')
	})
})
