// ABOUTME: Counts daily, 7-day and 30-day active users from the access-token key names in production OAUTH_KV.
// ABOUTME: Stores only a keyed hash of each active user ID per UTC day in DASH_KV, for 31 days; never a username or a token value.
import { listKvKeys } from './cfApi'
import { listDashKeys } from './dashKv'
import type { DashEnv } from './env'

export interface ActiveUsersSummary {
	computedAt: string
	/** Distinct users active on the UTC day of computedAt */
	dau: number
	/** Distinct users active over the last 7 UTC days, including today */
	wau: number
	/** Distinct users active over the last 30 UTC days, including today */
	mau: number
	/** The last 30 UTC days, oldest first, with zero-filled days */
	activeByDay: Array<{ date: string; count: number }>
	/** The earliest UTC date with a marker (`YYYY-MM-DD`), or null before anyone has been seen */
	activeSince: string | null
}

/** Markers are kept 31 days, so the 30-day window is always covered and nothing older lingers */
export const ACTIVE_USER_TTL_SECONDS = 31 * 86400

/** The HMAC key must be at least this long; a shorter one is treated as missing, never used */
export const MIN_HMAC_KEY_LENGTH = 32

/*
 * Budget for one cron invocation, which runs this refresh and then the grant summary. Workers Paid allows 10,000 subrequests
 * per invocation, and that limit counts requests to Cloudflare services such as KV as well as fetch() calls
 * (https://developers.cloudflare.com/workers/platform/limits/#subrequests). The KV limits page still lists 1,000 operations
 * per invocation (https://developers.cloudflare.com/kv/platform/limits/), so both figures are counted below.
 *
 * - Grant summary, worst run (a backfill): about 406 REST requests, up to about 400 of them value reads plus a few key
 *   listings, each tried up to three times on a 429 or 5xx (about 1,218 fetches), and about 850 DASH_KV operations.
 *   Steady-state runs read a handful of new grants.
 * - Active users: one `token:` REST list page per 1,000 tokens (tried up to three times), one `au:` list page per 1,000
 *   markers (about 31 x DAU markers: four pages at 100 a day), one marker write per user first seen today (at most the
 *   distinct users holding a token, about 100 an hour today) and one summary write.
 *
 * That's about 2,200 subrequests in the worst case, well inside 10,000. Counting DASH_KV operations alone against the 1,000
 * figure, a worst-case grant run leaves room for about 140 new active users in the same hour; outside a backfill the grant
 * summary uses only a few, and active users have the rest. Every observed user is written: a marker skipped for budget is
 * lost once that user's token is gone.
 */

const SUMMARY_KEY = 'summary:active-users'
const TOKEN_PREFIX = 'token:'
const MARKER_PREFIX = 'au:'
const SKIPPED_WARNING = '[STATS] active users not recorded: ACTIVE_USER_HMAC_KEY is missing or too short'

const DAY_SECONDS = 86400
const WEEK_DAYS = 7
const MONTH_DAYS = 30
/** Hex characters kept from each HMAC: 128 bits */
const HASH_HEX_LENGTH = 32
/** A Worker can hold six connections open at once; more just queue */
const WRITE_CONCURRENCY = 6

/** The configured HMAC key, or null when it's missing or too short to use */
export function activeUserKey(env: DashEnv): string | null {
	const key = env.ACTIVE_USER_HMAC_KEY
	return typeof key === 'string' && key.length >= MIN_HMAC_KEY_LENGTH ? key : null
}

/**
 * The user ID in a `token:<userId>:<grantId>:<tokenId>` key. The grant and token IDs are colon-free, so they're split off
 * the right and everything between is the user ID, colons included.
 */
export function userIdFromTokenKey(key: string): string | null {
	if (!key.startsWith(TOKEN_PREFIX)) return null
	const rest = key.slice(TOKEN_PREFIX.length)
	const tokenSplit = rest.lastIndexOf(':')
	if (tokenSplit <= 0 || tokenSplit === rest.length - 1) return null
	const grantSplit = rest.lastIndexOf(':', tokenSplit - 1)
	if (grantSplit <= 0 || grantSplit === tokenSplit - 1) return null
	return rest.slice(0, grantSplit)
}

export async function importHmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

/** HMAC-SHA256 of the user ID as hex, truncated to 32 characters */
export async function hashUserId(key: CryptoKey, userId: string): Promise<string> {
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId)))
	return [...mac]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, HASH_HEX_LENGTH)
}

/**
 * Records who is active now and recomputes the active-user summary at `summary:active-users`.
 *
 * Lists the access-token keys in production OAUTH_KV (names only), takes the distinct user IDs in memory and writes an
 * empty `au:<UTC date>:<hash>` marker for each user not yet marked today. Access tokens last an hour and are renewed while a
 * client is in use, so the hourly run sees nearly everyone active in that hour. The counts come from every listed marker
 * plus this run's hashes.
 *
 * Returns null, and records nothing, while the HMAC key is missing or too short: an unkeyed hash of a username could be
 * reversed by hashing candidate names.
 */
export async function refreshActiveUsers(env: DashEnv, now: Date = new Date()): Promise<ActiveUsersSummary | null> {
	const secret = activeUserKey(env)
	if (secret === null) {
		console.warn(SKIPPED_WARNING)
		return null
	}

	const nowSeconds = Math.floor(now.getTime() / 1000)
	const today = utcDate(dayNumber(nowSeconds))

	const [tokenKeys, markerKeys] = await Promise.all([listKvKeys(env, TOKEN_PREFIX), listDashKeys(env.DASH_KV, MARKER_PREFIX)])
	const userIds = new Set<string>()
	for (const { name, expiration } of tokenKeys) {
		if (expiration !== undefined && expiration <= nowSeconds) continue
		const userId = userIdFromTokenKey(name)
		if (userId !== null) userIds.add(userId)
	}

	const key = await importHmacKey(secret)
	const hashesNow = await Promise.all([...userIds].map((userId) => hashUserId(key, userId)))

	/** Hashes by UTC date, from the stored markers and this run */
	const byDate = new Map<string, Set<string>>()
	const add = (date: string, hash: string): void => {
		const hashes = byDate.get(date) ?? new Set<string>()
		hashes.add(hash)
		byDate.set(date, hashes)
	}
	for (const name of markerKeys) {
		const marker = parseMarkerKey(name)
		if (marker) add(marker.date, marker.hash)
	}

	const markedToday = byDate.get(today) ?? new Set<string>()
	const toWrite = hashesNow.filter((hash) => !markedToday.has(hash))
	for (let i = 0; i < toWrite.length; i += WRITE_CONCURRENCY) {
		await Promise.all(
			toWrite
				.slice(i, i + WRITE_CONCURRENCY)
				.map((hash) => env.DASH_KV.put(`${MARKER_PREFIX}${today}:${hash}`, '', { expirationTtl: ACTIVE_USER_TTL_SECONDS })),
		)
	}
	for (const hash of hashesNow) add(today, hash)

	const summary = summarise(byDate, now)
	await env.DASH_KV.put(SUMMARY_KEY, JSON.stringify(summary))
	return summary
}

/** The summary the last run stored, or null before the first run */
export async function readActiveUsersSummary(env: DashEnv): Promise<ActiveUsersSummary | null> {
	return env.DASH_KV.get<ActiveUsersSummary>(SUMMARY_KEY, 'json')
}

function parseMarkerKey(name: string): { date: string; hash: string } | null {
	const match = /^au:(\d{4}-\d{2}-\d{2}):([0-9a-f]+)$/.exec(name)
	return match ? { date: match[1], hash: match[2] } : null
}

function dayNumber(seconds: number): number {
	return Math.floor(seconds / DAY_SECONDS)
}

function utcDate(day: number): string {
	return new Date(day * DAY_SECONDS * 1000).toISOString().slice(0, 10)
}

/** Distinct hashes over the `days` UTC days ending today */
function distinctOver(byDate: Map<string, Set<string>>, today: number, days: number): number {
	const hashes = new Set<string>()
	for (let day = today - days + 1; day <= today; day++) for (const hash of byDate.get(utcDate(day)) ?? []) hashes.add(hash)
	return hashes.size
}

function summarise(byDate: Map<string, Set<string>>, now: Date): ActiveUsersSummary {
	const today = dayNumber(Math.floor(now.getTime() / 1000))
	const dates = [...byDate].filter(([, hashes]) => hashes.size > 0).map(([date]) => date)
	return {
		computedAt: now.toISOString(),
		dau: distinctOver(byDate, today, 1),
		wau: distinctOver(byDate, today, WEEK_DAYS),
		mau: distinctOver(byDate, today, MONTH_DAYS),
		activeByDay: Array.from({ length: MONTH_DAYS }, (_, i) => {
			const date = utcDate(today - (MONTH_DAYS - 1) + i)
			return { date, count: byDate.get(date)?.size ?? 0 }
		}),
		// ISO dates sort as text
		activeSince: dates.length > 0 ? dates.sort()[0] : null,
	}
}
