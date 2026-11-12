// ABOUTME: Tests active-user counting: user IDs from token key names, keyed hashes, daily markers in DASH_KV and the counts.
// ABOUTME: Replaces cfApi with an in-memory list of OAUTH_KV token keys and uses the test DASH_KV, counting every write.
import { createScheduledController, env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	ACTIVE_USER_TTL_SECONDS,
	hashUserId,
	importHmacKey,
	MAX_ACTIVE_USER_WRITES_PER_RUN,
	readActiveUsersSummary,
	refreshActiveUsers,
	userIdFromTokenKey,
} from '../src/activeUsers'
import type { ActiveUsersSummary } from '../src/activeUsers'
import { CfApiError, getKvJson, listKvKeys } from '../src/cfApi'
import type { KvKey } from '../src/cfApi'
import type { DashEnv } from '../src/env'
import { readGrantSummary } from '../src/grants'
import worker from '../src/index'

vi.mock('../src/cfApi', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/cfApi')>()),
	listKvKeys: vi.fn(),
	getKvJson: vi.fn(),
}))

const DAY = 86400
const DAY_MS = DAY * 1000

/** Noon UTC today, so each fixture run lands on a predictable UTC day */
const NOW = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS + 12 * 3600 * 1000)
const NOW_S = NOW.getTime() / 1000

const HMAC_KEY = 'k'.repeat(16) + '0123456789abcdef0123456789abcdef'
const OTHER_KEY = 'z'.repeat(48)

const USERNAMES = ['alice-fixture-user', 'bob-fixture-user', 'carol-fixture-user', 'dave-fixture-user', 'user:with:colons'] as const
const [ALICE, BOB, CAROL, DAVE, COLONS] = USERNAMES

/** The token keys the fake listKvKeys returns, as production OAUTH_KV names them */
let tokenKeys: KvKey[]
/** Every DASH_KV key written through the counting env, in order */
let puts: string[]

function daysAgo(days: number): Date {
	return new Date(NOW.getTime() - days * DAY_MS)
}

function utcDate(date: Date): string {
	return date.toISOString().slice(0, 10)
}

function tokenKey(userId: string, n: number): string {
	return `token:${userId}:${`grant${n}`.padEnd(16, '0')}:${`token${n}`.padEnd(64, 'f')}`
}

/** Replaces the listed tokens with one per user (Alice gets two), as if those users were active this hour */
function activeNow(...users: string[]): void {
	tokenKeys = users.flatMap((userId, i) => [{ name: tokenKey(userId, i) }, ...(userId === ALICE ? [{ name: tokenKey(userId, 99) }] : [])])
}

/** The test env with a counting DASH_KV and the given HMAC key, or none for null */
function testEnv(key: string | null = HMAC_KEY): DashEnv {
	const kv = env.DASH_KV
	const counting = new Proxy(kv, {
		get(target, prop) {
			if (prop === 'put') {
				return (name: string, ...rest: unknown[]) => {
					puts.push(name)
					return (target.put as (...args: unknown[]) => Promise<void>)(name, ...rest)
				}
			}
			const value = Reflect.get(target, prop)
			return typeof value === 'function' ? value.bind(target) : value
		},
	})
	return { ...env, DASH_KV: counting, ACTIVE_USER_HMAC_KEY: key ?? undefined }
}

async function clearDashKv(): Promise<void> {
	let cursor: string | undefined
	do {
		const page = await env.DASH_KV.list({ cursor })
		await Promise.all(page.keys.map(({ name }) => env.DASH_KV.delete(name)))
		cursor = page.list_complete ? undefined : page.cursor
	} while (cursor)
}

async function markerKeys(): Promise<string[]> {
	const { keys } = await env.DASH_KV.list({ prefix: 'au:' })
	return keys.map(({ name }) => name)
}

beforeEach(async () => {
	vi.clearAllMocks()
	tokenKeys = []
	puts = []
	vi.mocked(listKvKeys).mockImplementation(async (_env, prefix) => tokenKeys.filter(({ name }) => name.startsWith(prefix)))
	vi.mocked(getKvJson).mockRejectedValue(new Error('token values must never be read'))
	await clearDashKv()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('userIdFromTokenKey', () => {
	it('should take the user ID from a token key, splitting the grant and token IDs off the right', () => {
		expect(userIdFromTokenKey(tokenKey(ALICE, 1))).toBe(ALICE)
	})

	it('should keep colons inside the user ID', () => {
		expect(userIdFromTokenKey(tokenKey(COLONS, 1))).toBe(COLONS)
	})

	it('should reject keys without a user, grant and token ID', () => {
		expect(userIdFromTokenKey('token:grantonly:tokenonly')).toBeNull()
		expect(userIdFromTokenKey('token::grant:token')).toBeNull()
		expect(userIdFromTokenKey('token:alice:grant:')).toBeNull()
		expect(userIdFromTokenKey('token:alice::token')).toBeNull()
		expect(userIdFromTokenKey('grant:alice:grant:token')).toBeNull()
	})
})

describe('hashUserId', () => {
	it('should be deterministic for one key, and differ under another key', async () => {
		const key = await importHmacKey(HMAC_KEY)
		const first = await hashUserId(key, ALICE)

		expect(first).toMatch(/^[0-9a-f]{32}$/)
		expect(await hashUserId(key, ALICE)).toBe(first)
		expect(await hashUserId(key, BOB)).not.toBe(first)
		expect(await hashUserId(await importHmacKey(OTHER_KEY), ALICE)).not.toBe(first)
	})

	it('should match HMAC-SHA256 of the user ID, truncated to 32 hex characters', async () => {
		const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(HMAC_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
		const mac = new Uint8Array(await crypto.subtle.sign('HMAC', raw, new TextEncoder().encode(ALICE)))
		const hex = [...mac].map((byte) => byte.toString(16).padStart(2, '0')).join('')

		expect(await hashUserId(await importHmacKey(HMAC_KEY), ALICE)).toBe(hex.slice(0, 32))
	})
})

describe('refreshActiveUsers', () => {
	it("should record one empty marker per distinct user for today's UTC date, expiring after 31 days", async () => {
		activeNow(ALICE, BOB)
		const key = await importHmacKey(HMAC_KEY)
		const before = Math.floor(Date.now() / 1000)

		const summary = await refreshActiveUsers(testEnv(), NOW)

		const today = utcDate(NOW)
		expect((await markerKeys()).sort()).toEqual(
			[`au:${today}:${await hashUserId(key, ALICE)}`, `au:${today}:${await hashUserId(key, BOB)}`].sort(),
		)
		const { keys } = await env.DASH_KV.list({ prefix: 'au:' })
		for (const { name, expiration } of keys) {
			expect(await env.DASH_KV.get(name)).toBe('')
			expect(expiration).toBeGreaterThanOrEqual(before + ACTIVE_USER_TTL_SECONDS)
			expect(expiration).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + ACTIVE_USER_TTL_SECONDS)
		}
		expect(ACTIVE_USER_TTL_SECONDS).toBe(2678400)
		expect(summary).toMatchObject({ computedAt: NOW.toISOString(), dau: 2, wau: 2, mau: 2, activeSince: today })
	})

	it('should list token key names only, never reading a token value', async () => {
		activeNow(ALICE, BOB)

		await refreshActiveUsers(testEnv(), NOW)

		expect(listKvKeys).toHaveBeenCalledWith(expect.anything(), 'token:')
		expect(getKvJson).not.toHaveBeenCalled()
	})

	it('should not rewrite markers already recorded today', async () => {
		activeNow(ALICE, BOB)
		await refreshActiveUsers(testEnv(), NOW)
		puts = []

		const second = await refreshActiveUsers(testEnv(), new Date(NOW.getTime() + 3600 * 1000))

		expect(puts.filter((name) => name.startsWith('au:'))).toEqual([])
		expect(second).toMatchObject({ dau: 2, wau: 2, mau: 2 })
	})

	it('should write only the users new today', async () => {
		activeNow(ALICE)
		await refreshActiveUsers(testEnv(), NOW)
		activeNow(ALICE, CAROL)
		puts = []

		const second = await refreshActiveUsers(testEnv(), new Date(NOW.getTime() + 3600 * 1000))

		const key = await importHmacKey(HMAC_KEY)
		expect(puts.filter((name) => name.startsWith('au:'))).toEqual([`au:${utcDate(NOW)}:${await hashUserId(key, CAROL)}`])
		expect(second?.dau).toBe(2)
	})

	it('should count daily, 7-day and 30-day active users and the daily series across several days', async () => {
		const runs: Array<[number, string[]]> = [
			[30, [DAVE]], // outside the 30-day window: today is day 0, so the window is days 29..0
			[20, [DAVE]],
			[10, [ALICE]],
			[3, [ALICE, CAROL]],
			[1, [BOB]],
			[0, [ALICE, CAROL]],
		]
		let summary: ActiveUsersSummary | null = null
		for (const [days, users] of runs) {
			activeNow(...users)
			summary = await refreshActiveUsers(testEnv(), daysAgo(days))
		}

		expect(summary).not.toBeNull()
		const result = summary as ActiveUsersSummary
		expect(result.dau).toBe(2)
		// Days 6..0: Alice, Carol and Bob
		expect(result.wau).toBe(3)
		// Days 29..0 add Dave, once despite being active on day 20 and day 30
		expect(result.mau).toBe(4)
		expect(result.activeSince).toBe(utcDate(daysAgo(30)))

		expect(result.activeByDay).toHaveLength(30)
		expect(result.activeByDay[0].date).toBe(utcDate(daysAgo(29)))
		expect(result.activeByDay[29].date).toBe(utcDate(NOW))
		const byDate = new Map(result.activeByDay.map(({ date, count }) => [date, count]))
		expect(byDate.get(utcDate(daysAgo(20)))).toBe(1)
		expect(byDate.get(utcDate(daysAgo(10)))).toBe(1)
		expect(byDate.get(utcDate(daysAgo(3)))).toBe(2)
		expect(byDate.get(utcDate(daysAgo(1)))).toBe(1)
		expect(byDate.get(utcDate(NOW))).toBe(2)
		expect(byDate.get(utcDate(daysAgo(2)))).toBe(0)
		expect(result.activeByDay.reduce((sum, day) => sum + day.count, 0)).toBe(7)
	})

	it('should store the summary for readActiveUsersSummary', async () => {
		activeNow(ALICE)
		expect(await readActiveUsersSummary(testEnv())).toBeNull()

		const summary = await refreshActiveUsers(testEnv(), NOW)

		expect(await readActiveUsersSummary(testEnv())).toEqual(summary)
	})

	it('should report no active users and no start date before anyone is seen', async () => {
		const summary = await refreshActiveUsers(testEnv(), NOW)

		expect(summary).toMatchObject({ dau: 0, wau: 0, mau: 0, activeSince: null })
		expect(summary?.activeByDay.every(({ count }) => count === 0)).toBe(true)
	})

	it('should ignore listed token keys that have already expired', async () => {
		tokenKeys = [
			{ name: tokenKey(ALICE, 1), expiration: NOW_S + 1800 },
			{ name: tokenKey(BOB, 2), expiration: NOW_S - 10 },
		]

		const summary = await refreshActiveUsers(testEnv(), NOW)

		expect(summary?.dau).toBe(1)
		expect(await markerKeys()).toHaveLength(1)
	})

	it('should cap marker writes per run, count every user seen this run, and write the rest next run', async () => {
		expect(MAX_ACTIVE_USER_WRITES_PER_RUN).toBe(120)
		activeNow(ALICE, BOB, CAROL)

		const first = await refreshActiveUsers(testEnv(), NOW, { maxWrites: 2 })

		expect(await markerKeys()).toHaveLength(2)
		expect(first).toMatchObject({ dau: 3, wau: 3, mau: 3 })
		expect(first?.activeByDay[29].count).toBe(3)

		const second = await refreshActiveUsers(testEnv(), new Date(NOW.getTime() + 3600 * 1000), { maxWrites: 2 })

		expect(await markerKeys()).toHaveLength(3)
		expect(second?.dau).toBe(3)
	})

	it('should never store a username in DASH_KV keys, values or metadata', async () => {
		activeNow(ALICE, BOB, CAROL, DAVE, COLONS)
		await refreshActiveUsers(testEnv(), daysAgo(1))
		await refreshActiveUsers(testEnv(), NOW)

		const { keys } = await env.DASH_KV.list()
		expect(keys.map(({ name }) => name)).toContain('summary:active-users')
		expect(keys.filter(({ name }) => name.startsWith('au:'))).toHaveLength(10)
		for (const { name, metadata } of keys) {
			const stored = `${name}\n${(await env.DASH_KV.get(name)) ?? ''}\n${JSON.stringify(metadata ?? null)}`
			for (const username of USERNAMES) expect(stored).not.toContain(username)
			expect(stored).not.toContain('fixture-user')
		}
	})

	it.each([
		['missing', null],
		['empty', ''],
		['shorter than 32 characters', 'x'.repeat(31)],
	])('should skip recording, with a fixed warning, when the HMAC key is %s', async (_case, key) => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
		activeNow(ALICE, BOB)

		expect(await refreshActiveUsers(testEnv(key), NOW)).toBeNull()

		expect(warnSpy).toHaveBeenCalledExactlyOnceWith('[STATS] active users not recorded: ACTIVE_USER_HMAC_KEY is missing or too short')
		expect(listKvKeys).not.toHaveBeenCalled()
		expect(puts).toEqual([])
		expect(await readActiveUsersSummary(testEnv(key))).toBeNull()
	})

	it('should keep the previous summary when the token listing fails', async () => {
		activeNow(ALICE)
		const first = await refreshActiveUsers(testEnv(), NOW)
		vi.mocked(listKvKeys).mockRejectedValue(new CfApiError(500, `KV list failed (500): token:${ALICE}:x:y`))

		await expect(refreshActiveUsers(testEnv(), new Date(NOW.getTime() + 3600 * 1000))).rejects.toThrow(CfApiError)

		expect(await readActiveUsersSummary(testEnv())).toEqual(first)
	})
})

describe('scheduled', () => {
	it('should refresh active users and the grant summary in the same run', async () => {
		activeNow(ALICE, BOB)

		await worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: '17 * * * *' }), testEnv())

		expect((await readActiveUsersSummary(testEnv()))?.dau).toBe(2)
		expect(await readGrantSummary(testEnv())).not.toBeNull()
	})

	it('should log a failed active-user refresh by status only, and still refresh the grant summary', async () => {
		const consoleSpies = (['error', 'warn', 'log', 'info', 'debug'] as const).map((method) =>
			vi.spyOn(console, method).mockImplementation(() => {}),
		)
		vi.mocked(listKvKeys).mockImplementation(async (_env, prefix) => {
			if (prefix === 'token:') throw new CfApiError(503, `KV list failed (503): token:${ALICE}:x:y`)
			return []
		})

		await expect(
			worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: '17 * * * *' }), testEnv()),
		).resolves.toBeUndefined()

		const [errorSpy] = consoleSpies
		expect(errorSpy).toHaveBeenCalledExactlyOnceWith('[STATS] active user refresh failed (status 503)')
		const logged = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls))
		for (const username of USERNAMES) expect(logged).not.toContain(username)
		expect(await readActiveUsersSummary(testEnv())).toBeNull()
		expect(await readGrantSummary(testEnv())).not.toBeNull()
	})
})
