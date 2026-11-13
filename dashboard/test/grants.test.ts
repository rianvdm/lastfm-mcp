// ABOUTME: Tests the hourly grant summary: live/pending/expired counts, retained 30-day sign-ins, client labels and the index.
// ABOUTME: Replaces cfApi with an in-memory OAUTH_KV and uses the test DASH_KV, counting every production value read.
import { createScheduledController, env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { analyticsSqlApi, CfApiError, getKvJson, listKvKeys } from '../src/cfApi'
import { MAX_FETCHES_PER_RUN, readGrantSummary, refreshGrantSummary } from '../src/grants'
import type { GrantSummary } from '../src/grants'
import worker from '../src/index'
import { readTrafficDays } from '../src/traffic'

// Keep the real CfApiError, which the scheduled handler checks for
vi.mock('../src/cfApi', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/cfApi')>()),
	listKvKeys: vi.fn(),
	getKvJson: vi.fn(),
	// The scheduled handler also refreshes traffic, which must never reach the real Analytics SQL API
	analyticsSqlApi: vi.fn(),
}))

const DAY = 86400

/** Noon UTC today, the same calendar date in Pacific time, so every fixture time lands on a predictable day and every KV expiration is in the real future */
const NOW = new Date(Math.floor(Date.now() / (DAY * 1000)) * DAY * 1000 + 12 * 3600 * 1000)
const NOW_S = NOW.getTime() / 1000
const HOUR_LATER = new Date(NOW.getTime() + 3600 * 1000)

const USERNAMES = ['alice-fixture-user', 'bob-fixture-user', 'carol-fixture-user'] as const
const [ALICE, BOB, CAROL] = USERNAMES

const DCR_CLAUDE = 'dcr0client0claude'
const DCR_UNUSED = 'dcr0client0unused'
const CIMD_CHATGPT = 'https://chatgpt.com/oauth/client.json'

/** The production OAUTH_KV the fake cfApi serves: key → JSON value */
let oauthKv: Map<string, unknown>
/** Every key the code under test read a value for, in order */
let valueReads: string[]

function grant(userId: string, grantId: string, fields: Record<string, unknown>): void {
	oauthKv.set(`grant:${userId}:${grantId}`, {
		id: grantId,
		userId,
		scope: [],
		metadata: {},
		encryptedProps: 'opaque',
		resource: 'https://lastfm-mcp.com',
		redirectUri: 'https://example.com/callback',
		...fields,
	})
}

/** Three users: Alice has two live grants from different clients, Bob a legacy no-expiry grant and a pending one, Carol an expired one */
function seedFixture(): void {
	oauthKv.set(`client:${DCR_CLAUDE}`, { clientId: DCR_CLAUDE, clientName: 'Claude', redirectUris: [] })
	oauthKv.set(`client:${DCR_UNUSED}`, { clientId: DCR_UNUSED, clientName: 'Never Used', redirectUris: [] })

	grant(ALICE, 'grantA1', { clientId: DCR_CLAUDE, createdAt: NOW_S - 2 * DAY, expiresAt: NOW_S + 28 * DAY, refreshTokenId: 'r1' })
	grant(ALICE, 'grantA2', { clientId: CIMD_CHATGPT, createdAt: NOW_S - 10 * DAY, expiresAt: NOW_S + 20 * DAY, refreshTokenId: 'r2' })
	// A 0.x grant: no expiresAt, signed in before the 30-day window
	grant(BOB, 'grantB1', { clientId: DCR_CLAUDE, createdAt: NOW_S - 45 * DAY })
	// An authorization code that was never exchanged
	grant(BOB, 'grantB2', { clientId: CIMD_CHATGPT, createdAt: NOW_S - 60, expiresAt: NOW_S + 30 * DAY, authCodeId: 'code1' })
	grant(CAROL, 'grantC1', { clientId: CIMD_CHATGPT, createdAt: NOW_S - 25 * DAY, expiresAt: NOW_S - 3600, refreshTokenId: 'r3' })
}

function grantReads(): string[] {
	return valueReads.filter((key) => key.startsWith('grant:'))
}

function clientReads(): string[] {
	return valueReads.filter((key) => key.startsWith('client:'))
}

function utcDate(seconds: number): string {
	return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** Deletes DASH_KV keys whose expiration has passed at `atSeconds`, as KV would by then */
async function expireDashKv(atSeconds: number): Promise<void> {
	const { keys } = await env.DASH_KV.list()
	await Promise.all(
		keys.filter(({ expiration }) => expiration !== undefined && expiration <= atSeconds).map(({ name }) => env.DASH_KV.delete(name)),
	)
}

async function clearDashKv(): Promise<void> {
	const { keys } = await env.DASH_KV.list()
	await Promise.all(keys.map(({ name }) => env.DASH_KV.delete(name)))
}

beforeEach(async () => {
	vi.mocked(analyticsSqlApi).mockResolvedValue([])
	oauthKv = new Map()
	valueReads = []
	vi.mocked(listKvKeys).mockImplementation(async (_env, prefix) =>
		[...oauthKv.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
	)
	vi.mocked(getKvJson).mockImplementation(async (_env, key) => {
		valueReads.push(key)
		return (oauthKv.get(key) ?? null) as never
	})
	await clearDashKv()
	seedFixture()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('refreshGrantSummary', () => {
	it('should count live users and grants, no-expiry and pending grants', async () => {
		const summary = await refreshGrantSummary(env, NOW)

		expect(summary.computedAt).toBe(NOW.toISOString())
		expect(summary.liveGrants).toBe(3)
		expect(summary.liveUsers).toBe(2)
		expect(summary.noExpiryGrants).toBe(1)
		expect(summary.pendingGrants).toBe(1)
		expect(summary.unresolvedGrants).toBe(0)
		expect(summary.registeredClients).toBe(2)
	})

	it('should chart sign-ins from live and expired grants over the last 30 Pacific days', async () => {
		const summary = await refreshGrantSummary(env, NOW)

		expect(summary.signInsByDay).toHaveLength(30)
		expect(summary.signInsByDay[0].date).toBe(utcDate(NOW_S - 29 * DAY))
		expect(summary.signInsByDay[29].date).toBe(utcDate(NOW_S))
		// Alice's two grants and Carol's expired one; Bob's legacy grant is older than 30 days and his pending one isn't a sign-in
		expect(summary.signInsByDay.reduce((sum, day) => sum + day.count, 0)).toBe(3)

		const byDate = new Map(summary.signInsByDay.map(({ date, count }) => [date, count]))
		expect(byDate.get(utcDate(NOW_S - 2 * DAY))).toBe(1)
		expect(byDate.get(utcDate(NOW_S - 10 * DAY))).toBe(1)
		expect(byDate.get(utcDate(NOW_S - 25 * DAY))).toBe(1)
		expect(byDate.get(utcDate(NOW_S))).toBe(0)

		expect(summary.signInsLast7d).toBe(1)
	})

	it('should put a sign-in on its Pacific date when UTC has already reached the next day', async () => {
		const utcMidnight = Math.floor(NOW_S / DAY) * DAY
		// 01:00 UTC is 17:00 or 18:00 Pacific on the previous date; the grant was created half an hour earlier
		const lateEvening = new Date((utcMidnight + 3600) * 1000)
		grant(ALICE, 'grantA3', {
			clientId: DCR_CLAUDE,
			createdAt: utcMidnight + 1800,
			expiresAt: utcMidnight + 30 * DAY,
			refreshTokenId: 'r4',
		})

		const summary = await refreshGrantSummary(env, lateEvening)

		expect(summary.signInsByDay[29]).toEqual({ date: utcDate(utcMidnight - DAY), count: 1 })
	})

	it('should skip a retained index entry without a usable createdAt instead of failing the refresh', async () => {
		await env.DASH_KV.put('gi:grantBroken', JSON.stringify({ label: 'unknown' }))

		const summary = await refreshGrantSummary(env, NOW)

		expect(summary.signInsByDay.reduce((sum, day) => sum + day.count, 0)).toBe(3)
	})

	it('should label clients by registered name or CIMD URL and sort them by users', async () => {
		const summary = await refreshGrantSummary(env, NOW)

		expect(summary.clients).toEqual([
			{ label: 'Claude', grants: 2, users: 2 },
			{ label: 'ChatGPT', grants: 1, users: 1 },
		])
		// Only the registered client a grant uses is read, once, after the grants; the unused one and the CIMD client aren't
		expect(clientReads()).toEqual([`client:${DCR_CLAUDE}`])
	})

	it('should store the summary for readGrantSummary', async () => {
		expect(await readGrantSummary(env)).toBeNull()

		const summary = await refreshGrantSummary(env, NOW)

		expect(await readGrantSummary(env)).toEqual(summary)
	})

	it('should not reread indexed grants or memoised client labels on the next run, but should recheck pending grants', async () => {
		const first = await refreshGrantSummary(env, NOW)
		expect(grantReads()).toHaveLength(5)

		valueReads = []
		const second = await refreshGrantSummary(env, NOW)

		expect(grantReads()).toEqual([`grant:${BOB}:grantB2`])
		expect(clientReads()).toEqual([])
		expect(second).toEqual(first)
	})

	it('should count a grant that was pending in one run and completed by the next as live', async () => {
		const first = await refreshGrantSummary(env, NOW)
		expect(first.pendingGrants).toBe(1)
		grant(BOB, 'grantB2', { clientId: CIMD_CHATGPT, createdAt: NOW_S - 60, expiresAt: NOW_S + 30 * DAY, refreshTokenId: 'r4' })

		const second = await refreshGrantSummary(env, HOUR_LATER)

		expect(second.pendingGrants).toBe(0)
		expect(second.unresolvedGrants).toBe(0)
		expect(second.liveGrants).toBe(4)
		expect(second.signInsLast7d).toBe(2)
		expect(await env.DASH_KV.get('gi:grantB2', 'json')).toEqual({
			label: 'ChatGPT',
			createdAt: NOW_S - 60,
			expiresAt: NOW_S + 30 * DAY,
		})
		expect(await env.DASH_KV.get('gp:grantB2')).toBeNull()
	})

	it('should re-read a pending grant on every run while the backlog fits the cap, recording when it was checked', async () => {
		await refreshGrantSummary(env, NOW)
		expect(grantReads()).toContain(`grant:${BOB}:grantB2`)
		expect(await env.DASH_KV.get('gp:grantB2', 'json')).toEqual({ lastCheckedAt: NOW_S })

		valueReads = []
		const second = await refreshGrantSummary(env, HOUR_LATER)

		expect(grantReads()).toEqual([`grant:${BOB}:grantB2`])
		expect(second.pendingGrants).toBe(1)
		expect(await env.DASH_KV.get('gp:grantB2', 'json')).toEqual({ lastCheckedAt: NOW_S + 3600 })
	})

	it('should count marked grants the budget does not reach as unresolved, not pending', async () => {
		await refreshGrantSummary(env, NOW)
		// Two new grants, never read, go ahead of the marked pending one and take the whole budget
		grant(CAROL, 'grantC2', { clientId: CIMD_CHATGPT, createdAt: NOW_S - 60, expiresAt: NOW_S + DAY, refreshTokenId: 'r5' })
		grant(CAROL, 'grantC3', { clientId: CIMD_CHATGPT, createdAt: NOW_S - 30, expiresAt: NOW_S + DAY, refreshTokenId: 'r6' })

		valueReads = []
		const second = await refreshGrantSummary(env, HOUR_LATER, { maxFetches: 2 })

		expect(grantReads()).toEqual([`grant:${CAROL}:grantC2`, `grant:${CAROL}:grantC3`])
		expect(second.unresolvedGrants).toBe(1)
		expect(second.pendingGrants).toBe(0)
		expect(second.liveGrants).toBe(5)
	})

	it('should not let persistent pending grants starve a completed grant listed after them', async () => {
		oauthKv.clear()
		for (let i = 0; i < 6; i++) {
			grant(ALICE, `pending${i}`, { clientId: CIMD_CHATGPT, createdAt: NOW_S - 60, expiresAt: NOW_S + 7 * DAY, authCodeId: `code${i}` })
		}
		grant(BOB, 'completed', { clientId: CIMD_CHATGPT, createdAt: NOW_S - DAY, expiresAt: NOW_S + 7 * DAY, refreshTokenId: 'r' })

		const runs: GrantSummary[] = []
		for (let run = 0; run < 3; run++) {
			const at = new Date(NOW.getTime() + run * 3601 * 1000)
			await expireDashKv(at.getTime() / 1000)
			runs.push(await refreshGrantSummary(env, at, { maxFetches: 3 }))
		}

		expect(runs.map(({ liveGrants }) => liveGrants)).toEqual([0, 0, 1])
		// Run 3 reads the completed grant, then the two pending grants checked longest ago (run 1)
		expect(grantReads().slice(-3)).toEqual([`grant:${BOB}:completed`, `grant:${ALICE}:pending0`, `grant:${ALICE}:pending1`])
		expect(runs[2]).toMatchObject({ liveUsers: 1, pendingGrants: 2, unresolvedGrants: 4 })
	})
	it('should read at most MAX_FETCHES_PER_RUN values by default', async () => {
		expect(MAX_FETCHES_PER_RUN).toBe(400)
		oauthKv.clear()
		for (let i = 0; i <= MAX_FETCHES_PER_RUN; i++) {
			grant(ALICE, `bulk${i}`, { clientId: CIMD_CHATGPT, createdAt: NOW_S - DAY, expiresAt: NOW_S + DAY, refreshTokenId: `r${i}` })
		}

		const summary = await refreshGrantSummary(env, NOW)

		expect(grantReads()).toHaveLength(MAX_FETCHES_PER_RUN)
		expect(summary.liveGrants).toBe(MAX_FETCHES_PER_RUN)
		expect(summary.unresolvedGrants).toBe(1)
	})

	it('should leave grants past the read cap unresolved and resolve them, then their labels, on later runs', async () => {
		const capped = await refreshGrantSummary(env, NOW, { maxFetches: 4 })

		// The first four grants take the whole cap, so no client is read and the Claude grants are indexed as unknown
		expect(valueReads).toEqual([`grant:${ALICE}:grantA1`, `grant:${ALICE}:grantA2`, `grant:${BOB}:grantB1`, `grant:${BOB}:grantB2`])
		expect(capped.unresolvedGrants).toBe(1)
		expect(capped.liveGrants).toBe(3)
		expect(capped.clients).toEqual([
			{ label: 'unknown', grants: 2, users: 2 },
			{ label: 'ChatGPT', grants: 1, users: 1 },
		])

		valueReads = []
		const next = await refreshGrantSummary(env, NOW, { maxFetches: 4 })

		// Carol's grant, the pending one, then the Claude client; one relabel write takes the last of the cap
		expect(valueReads).toEqual([`grant:${CAROL}:grantC1`, `grant:${BOB}:grantB2`, `client:${DCR_CLAUDE}`])
		expect(next.unresolvedGrants).toBe(0)
		expect(next.liveGrants).toBe(3)
		expect(next.liveUsers).toBe(2)
		expect(next.pendingGrants).toBe(1)
		expect(next.clients).toEqual([
			{ label: 'Claude', grants: 2, users: 2 },
			{ label: 'ChatGPT', grants: 1, users: 1 },
		])

		await refreshGrantSummary(env, NOW, { maxFetches: 4 })

		expect(await env.DASH_KV.get('gi:grantA1', 'json')).toEqual({
			label: 'Claude',
			createdAt: NOW_S - 2 * DAY,
			expiresAt: NOW_S + 28 * DAY,
		})
		expect(await env.DASH_KV.get('gi:grantB1', 'json')).toEqual({ label: 'Claude', createdAt: NOW_S - 45 * DAY })
	})

	it('should label a grant whose registered client was deleted unknown, and index it', async () => {
		grant(CAROL, 'grantOrphan', { clientId: 'dcr0client0deleted', createdAt: NOW_S - DAY, expiresAt: NOW_S + DAY, refreshTokenId: 'r9' })

		const summary = await refreshGrantSummary(env, NOW)

		expect(summary.unresolvedGrants).toBe(0)
		expect(summary.clients).toContainEqual({ label: 'unknown', grants: 1, users: 1 })
		expect(await env.DASH_KV.get('gi:grantOrphan', 'json')).toEqual({ label: 'unknown', createdAt: NOW_S - DAY, expiresAt: NOW_S + DAY })
		expect(clientReads()).not.toContain('client:dcr0client0deleted')
	})

	it('should index a grant whose client the cap leaves unread as unknown, keeping only the random client ID', async () => {
		const first = await refreshGrantSummary(env, NOW, { maxFetches: 1 })

		expect(valueReads).toEqual([`grant:${ALICE}:grantA1`])
		expect(first.unresolvedGrants).toBe(4)
		expect(first.liveGrants).toBe(1)
		expect(first.clients).toEqual([{ label: 'unknown', grants: 1, users: 1 }])
		expect(await env.DASH_KV.get('gi:grantA1', 'json')).toEqual({
			label: 'unknown',
			clientId: DCR_CLAUDE,
			createdAt: NOW_S - 2 * DAY,
			expiresAt: NOW_S + 28 * DAY,
		})
	})

	it('should drop a grant that is deleted between the list and the read', async () => {
		vi.mocked(listKvKeys).mockImplementation(async (_env, prefix) => {
			const keys = [...oauthKv.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name }))
			return prefix === 'grant:' ? [...keys, { name: `grant:${CAROL}:grantGone` }] : keys
		})

		const summary = await refreshGrantSummary(env, NOW)

		expect(summary.liveGrants).toBe(3)
		expect(summary.unresolvedGrants).toBe(0)
		expect(await env.DASH_KV.get('gi:grantGone')).toBeNull()
	})

	it('should split grant keys on the last colon', async () => {
		oauthKv.clear()
		grant('user:with:colons', 'grantX', { clientId: CIMD_CHATGPT, createdAt: NOW_S - DAY, expiresAt: NOW_S + DAY, refreshTokenId: 'r' })

		const summary = await refreshGrantSummary(env, NOW)

		expect(summary.liveUsers).toBe(1)
		expect(await env.DASH_KV.get('gi:grantX', 'json')).toEqual({ label: 'ChatGPT', createdAt: NOW_S - DAY, expiresAt: NOW_S + DAY })
	})

	it('should index grants without usernames and expire entries a day after the grant', async () => {
		await refreshGrantSummary(env, NOW)

		expect(await env.DASH_KV.get('gi:grantA1', 'json')).toEqual({
			label: 'Claude',
			createdAt: NOW_S - 2 * DAY,
			expiresAt: NOW_S + 28 * DAY,
		})
		expect(await env.DASH_KV.get('gi:grantB1', 'json')).toEqual({ label: 'Claude', createdAt: NOW_S - 45 * DAY })
		expect(await env.DASH_KV.get('gi:grantB2')).toBeNull()

		const { keys } = await env.DASH_KV.list({ prefix: 'gi:' })
		const expirations = new Map(keys.map(({ name, expiration }) => [name, expiration]))
		expect(expirations.get('gi:grantA1')).toBe(NOW_S + 29 * DAY)
		expect(expirations.get('gi:grantB1')).toBeUndefined()
	})

	it('should keep the sign-in of a grant that a later sign-in replaced', async () => {
		oauthKv.clear()
		grant(ALICE, 'yesterday', { clientId: CIMD_CHATGPT, createdAt: NOW_S - DAY, expiresAt: NOW_S + 29 * DAY, refreshTokenId: 'r1' })
		await refreshGrantSummary(env, NOW)

		// Alice signs in again: the provider replaces yesterday's grant with today's
		oauthKv.delete(`grant:${ALICE}:yesterday`)
		grant(ALICE, 'today', { clientId: CIMD_CHATGPT, createdAt: NOW_S + 60, expiresAt: NOW_S + 30 * DAY, refreshTokenId: 'r2' })
		const summary = await refreshGrantSummary(env, HOUR_LATER)

		expect(summary.liveGrants).toBe(1)
		expect(summary.liveUsers).toBe(1)
		expect(summary.signInsLast7d).toBe(2)
		const byDate = new Map(summary.signInsByDay.map(({ date, count }) => [date, count]))
		expect(byDate.get(utcDate(NOW_S - DAY))).toBe(1)
		expect(byDate.get(utcDate(NOW_S))).toBe(1)
	})

	it('should never store a client ID that is a URL, or a registered name, in DASH_KV', async () => {
		const leakyCimd = `https://dc2.example/${ALICE}/client.json`
		const leakyDcr = 'dcr0client0leaky'
		oauthKv.set(`client:${leakyDcr}`, { clientId: leakyDcr, clientName: BOB, redirectUris: [] })
		grant(ALICE, 'grantLeakyCimd', { clientId: leakyCimd, createdAt: NOW_S - DAY, expiresAt: NOW_S + DAY, refreshTokenId: 'r7' })
		grant(CAROL, 'grantLeakyDcr', { clientId: leakyDcr, createdAt: NOW_S - DAY, expiresAt: NOW_S + DAY, refreshTokenId: 'r8' })

		// The first run's cap covers the seven grants but no client, so the registered client's grant waits a run for its label
		await refreshGrantSummary(env, NOW, { maxFetches: 7 })
		expect(await env.DASH_KV.get('gi:grantLeakyDcr', 'json')).toMatchObject({ label: 'unknown', clientId: leakyDcr })
		const summary = await refreshGrantSummary(env, HOUR_LATER)

		expect(summary.clients).toContainEqual({ label: 'other', grants: 2, users: 2 })
		expect(await env.DASH_KV.get('gi:grantLeakyCimd', 'json')).toEqual({ label: 'other', createdAt: NOW_S - DAY, expiresAt: NOW_S + DAY })
		expect(await env.DASH_KV.get(`cl:${leakyDcr}`)).toBe('other')
		const { keys } = await env.DASH_KV.list()
		for (const { name, metadata } of keys) {
			const stored = `${name}\n${(await env.DASH_KV.get(name)) ?? ''}\n${JSON.stringify(metadata ?? null)}`
			expect(stored).not.toContain('https://')
			for (const username of USERNAMES) expect(stored).not.toContain(username)
		}
	})

	it('should never store a username in DASH_KV keys, values or metadata', async () => {
		await refreshGrantSummary(env, NOW)
		await refreshGrantSummary(env, NOW)

		const { keys } = await env.DASH_KV.list()
		expect(keys.length).toBeGreaterThan(0)
		expect(keys.map(({ name }) => name)).toContain('summary:grants')
		for (const { name, metadata } of keys) {
			const value = (await env.DASH_KV.get(name)) ?? ''
			const stored = `${name}\n${value}\n${JSON.stringify(metadata ?? null)}`
			for (const username of USERNAMES) expect(stored).not.toContain(username)
		}
	})
})

describe('refreshGrantSummary read budget', () => {
	/** Registers `count` clients that no grant uses, as open registration does in production */
	function seedUnusedClients(count: number): void {
		for (let i = 0; i < count; i++) {
			const clientId = `dcr0unused${String(i).padStart(4, '0')}`
			oauthKv.set(`client:${clientId}`, { clientId, clientName: 'Claude', redirectUris: [] })
		}
	}

	/** One completed grant from a CIMD client and one from a registered client, among 400+ unused registered clients */
	function seedReviewerScenario(): void {
		oauthKv.clear()
		oauthKv.set(`client:${DCR_CLAUDE}`, { clientId: DCR_CLAUDE, clientName: 'Claude', redirectUris: [] })
		seedUnusedClients(MAX_FETCHES_PER_RUN + 1)
		grant(ALICE, 'grantCimd', { clientId: CIMD_CHATGPT, createdAt: NOW_S - DAY, expiresAt: NOW_S + 29 * DAY, refreshTokenId: 'r1' })
		grant(BOB, 'grantDcr', { clientId: DCR_CLAUDE, createdAt: NOW_S - DAY, expiresAt: NOW_S + 29 * DAY, refreshTokenId: 'r2' })
	}

	it('should read grants before client labels, and read only the clients those grants use', async () => {
		seedReviewerScenario()

		const summary = await refreshGrantSummary(env, NOW)

		expect(summary).toMatchObject({ liveGrants: 2, liveUsers: 2, unresolvedGrants: 0, signInsLast7d: 2 })
		expect(summary.registeredClients).toBe(MAX_FETCHES_PER_RUN + 2)
		expect(summary.clients).toEqual([
			{ label: 'ChatGPT', grants: 1, users: 1 },
			{ label: 'Claude', grants: 1, users: 1 },
		])
		expect(valueReads).toEqual([`grant:${ALICE}:grantCimd`, `grant:${BOB}:grantDcr`, `client:${DCR_CLAUDE}`])
	})

	it('should index a grant as unknown when no budget is left for its client, and relabel it on the next run', async () => {
		seedReviewerScenario()

		const first = await refreshGrantSummary(env, NOW, { maxFetches: 2 })

		expect(clientReads()).toEqual([])
		expect(first).toMatchObject({ liveGrants: 2, liveUsers: 2, unresolvedGrants: 0, signInsLast7d: 2 })
		expect(first.clients).toEqual([
			{ label: 'ChatGPT', grants: 1, users: 1 },
			{ label: 'unknown', grants: 1, users: 1 },
		])

		valueReads = []
		const second = await refreshGrantSummary(env, HOUR_LATER, { maxFetches: 2 })

		expect(valueReads).toEqual([`client:${DCR_CLAUDE}`])
		expect(second.clients).toEqual([
			{ label: 'ChatGPT', grants: 1, users: 1 },
			{ label: 'Claude', grants: 1, users: 1 },
		])
		expect(await env.DASH_KV.get('gi:grantDcr', 'json')).toEqual({ label: 'Claude', createdAt: NOW_S - DAY, expiresAt: NOW_S + 29 * DAY })
	})

	it('should keep client reads within the budget the grant reads leave', async () => {
		oauthKv.clear()
		seedUnusedClients(10)
		const used = ['dcr0client0one', 'dcr0client0two', 'dcr0client0three']
		used.forEach((clientId, i) => {
			oauthKv.set(`client:${clientId}`, { clientId, clientName: 'Cursor', redirectUris: [] })
			grant(ALICE, `grant${i}`, { clientId, createdAt: NOW_S - DAY, expiresAt: NOW_S + DAY, refreshTokenId: `r${i}` })
		})

		const first = await refreshGrantSummary(env, NOW, { maxFetches: 4 })

		expect(valueReads.slice(0, 3)).toEqual([`grant:${ALICE}:grant0`, `grant:${ALICE}:grant1`, `grant:${ALICE}:grant2`])
		expect(clientReads()).toHaveLength(1)
		expect(first.liveGrants).toBe(3)

		valueReads = []
		const second = await refreshGrantSummary(env, HOUR_LATER, { maxFetches: 4 })

		expect(grantReads()).toEqual([])
		expect(clientReads()).toHaveLength(2)
		expect(second.clients).toEqual([{ label: 'Cursor', grants: 3, users: 1 }])
	})
})

describe('scheduled', () => {
	it('should refresh the grant summary', async () => {
		await worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: '17 * * * *' }), env)

		const summary = (await readGrantSummary(env)) as GrantSummary
		expect(summary.liveUsers).toBe(2)
	})

	it('should log a failed refresh with its status and nothing from the upstream body', async () => {
		const consoleSpies = (['error', 'warn', 'log', 'info', 'debug'] as const).map((method) =>
			vi.spyOn(console, method).mockImplementation(() => {}),
		)
		vi.mocked(getKvJson).mockRejectedValue(new CfApiError(500, `KV get failed (500): could not read grant:${ALICE}:grantA1`))

		await expect(worker.scheduled(createScheduledController({ cron: '17 * * * *' }), env)).resolves.toBeUndefined()

		const [errorSpy] = consoleSpies
		expect(errorSpy).toHaveBeenCalledExactlyOnceWith('[STATS] grant summary refresh failed (status 500)')
		const logged = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls))
		for (const username of USERNAMES) expect(logged).not.toContain(username)
		expect(await readGrantSummary(env)).toBeNull()
		// The traffic refresh still runs after the grant summary fails
		expect(await readTrafficDays(env)).not.toBeNull()
	})

	it('should log a fixed message for an error that is not a CfApiError', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.mocked(listKvKeys).mockRejectedValue(new TypeError(`fetch failed for grant:${BOB}:grantB1`))

		await expect(worker.scheduled(createScheduledController({ cron: '17 * * * *' }), env)).resolves.toBeUndefined()

		expect(errorSpy).toHaveBeenCalledExactlyOnceWith('[STATS] grant summary refresh failed')
	})
})
