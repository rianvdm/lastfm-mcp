// ABOUTME: Builds the hourly OAuth grant summary from production OAUTH_KV: live users and grants, 30-day sign-ins, and clients.
// ABOUTME: Reads each grant's value once into a username-free index in DASH_KV, and caps production value reads per run.
import { isCimdClientId, labelForClient } from '../../src/analytics/clientLabel'
import { getKvJson, listKvKeys } from './cfApi'
import type { DashEnv } from './env'

export interface GrantSummary {
	computedAt: string
	liveGrants: number
	liveUsers: number
	noExpiryGrants: number
	pendingGrants: number
	unresolvedGrants: number
	registeredClients: number
	signInsLast7d: number
	/** The last 30 UTC days, oldest first, with zero-filled days */
	signInsByDay: Array<{ date: string; count: number }>
	/** Live grants per client label, sorted by users descending */
	clients: Array<{ label: string; grants: number; users: number }>
}

export interface RefreshOptions {
	/** Most production KV value reads (grants plus clients) in one run. Defaults to MAX_FETCHES_PER_RUN. */
	maxFetches?: number
}

/**
 * Keeps one run inside the Workers Paid per-invocation limits with retries counted: at worst about 406 REST requests and
 * about 420 DASH_KV operations. The rest are picked up next run, so a full backfill of about 924 grants takes three runs.
 */
export const MAX_FETCHES_PER_RUN = 400

const SUMMARY_KEY = 'summary:grants'
const GRANT_PREFIX = 'grant:'
const CLIENT_PREFIX = 'client:'
const INDEX_PREFIX = 'gi:'
const PENDING_PREFIX = 'gp:'
const LABEL_PREFIX = 'cl:'

const DAY_SECONDS = 86400
const SIGN_IN_DAYS = 30

/** Index entries outlive their grant by a day, and are never written to expire sooner than a day from now */
const INDEX_GRACE_SECONDS = DAY_SECONDS

/**
 * How long a `gp:<grantId>` marker says a grant was pending when last read. The provider gives a pending grant a 600 s TTL,
 * but a marker that short would expire before the next hourly run, and pending grants that outlive it (0.x records with no
 * TTL) could again take every read. Two hours covers the next run; marked grants are re-read with any budget left over.
 */
const PENDING_MARKER_TTL_SECONDS = 2 * 3600

/** Registered client names can't change, but clients can be deleted, so labels are re-read monthly */
const LABEL_TTL_SECONDS = 30 * DAY_SECONDS

/** The KV binding's bulk get takes at most 100 keys */
const BULK_GET_LIMIT = 100

/** A Worker can hold six connections open at once; more just queue */
const FETCH_CONCURRENCY = 6

/** What the summary needs from one grant. It holds no username: the user ID stays in memory, taken from the listed key. */
interface GrantIndexEntry {
	clientId?: string
	/** Seconds since the epoch */
	createdAt: number
	/** Seconds since the epoch; absent on grants written by the 0.x provider */
	expiresAt?: number
}

/** The fields this summary reads from a workers-oauth-provider grant value */
interface GrantRecord {
	clientId?: string
	createdAt: number
	expiresAt?: number
	authCodeId?: string
	refreshTokenId?: string
}

interface ClientRecord {
	clientName?: string
}

interface ListedGrant {
	key: string
	userId: string
	grantId: string
}

/** A resolved grant, kept in memory for this run only */
interface ResolvedGrant extends GrantIndexEntry {
	userId: string
}

/** Counts production value reads against the per-run cap */
class FetchBudget {
	private remaining: number

	constructor(limit: number) {
		this.remaining = limit
	}

	/** Takes up to `count` reads from the budget and returns how many were granted */
	take(count: number): number {
		const granted = Math.max(0, Math.min(count, this.remaining))
		this.remaining -= granted
		return granted
	}
}

/**
 * Recomputes the grant summary and stores it at `summary:grants` in DASH_KV.
 *
 * Every run lists all grant and client keys, but reads a grant's value only when it isn't indexed yet. Pending grants (an
 * authorization code that was never exchanged) are never indexed: they get a short-lived `gp:` marker instead and are
 * re-read, after every unread grant, until they complete or expire.
 */
export async function refreshGrantSummary(env: DashEnv, now: Date = new Date(), options: RefreshOptions = {}): Promise<GrantSummary> {
	const nowSeconds = Math.floor(now.getTime() / 1000)
	const budget = new FetchBudget(options.maxFetches ?? MAX_FETCHES_PER_RUN)

	const [grantKeys, clientKeys] = await Promise.all([listKvKeys(env, GRANT_PREFIX), listKvKeys(env, CLIENT_PREFIX)])
	const listed = grantKeys.map(({ name }) => parseGrantKey(name)).filter((grant): grant is ListedGrant => grant !== null)

	const stored = await bulkGet(
		env.DASH_KV,
		listed.flatMap(({ grantId }) => [`${INDEX_PREFIX}${grantId}`, `${PENDING_PREFIX}${grantId}`]),
	)

	const resolved: ResolvedGrant[] = []
	const unread: ListedGrant[] = []
	const markedPending: ListedGrant[] = []
	for (const grant of listed) {
		const entry = stored.get(`${INDEX_PREFIX}${grant.grantId}`)
		if (entry) resolved.push({ ...(JSON.parse(entry) as GrantIndexEntry), userId: grant.userId })
		else if (stored.has(`${PENDING_PREFIX}${grant.grantId}`)) markedPending.push(grant)
		else unread.push(grant)
	}

	// Unread grants go first, so pending grants can't hold the backlog back. Known-pending ones are rechecked with what's left,
	// and the ones the budget doesn't reach count as pending from their marker.
	const toRead = [...unread, ...markedPending]
	const reading = toRead.slice(0, budget.take(toRead.length))
	const unresolvedGrants = Math.max(0, unread.length - reading.length)
	let pendingGrants = toRead.length - reading.length - unresolvedGrants
	const marked = new Set(markedPending)

	await forEachConcurrently(reading, async (grant) => {
		const record = await getKvJson<GrantRecord>(env, grant.key)
		// Deleted between the list and the read: the grant is gone, so it isn't counted
		if (!record) return
		if (record.authCodeId && !record.refreshTokenId) {
			pendingGrants++
			await env.DASH_KV.put(`${PENDING_PREFIX}${grant.grantId}`, '1', { expirationTtl: PENDING_MARKER_TTL_SECONDS })
			return
		}
		const entry = toIndexEntry(record)
		await env.DASH_KV.put(`${INDEX_PREFIX}${grant.grantId}`, JSON.stringify(entry), indexExpiration(entry, nowSeconds))
		if (marked.has(grant)) await env.DASH_KV.delete(`${PENDING_PREFIX}${grant.grantId}`)
		resolved.push({ ...entry, userId: grant.userId })
	})

	const live = resolved.filter((grant) => grant.expiresAt === undefined || grant.expiresAt > nowSeconds)
	const labels = await resolveClientLabels(env, live, budget)

	const summary: GrantSummary = {
		computedAt: now.toISOString(),
		liveGrants: live.length,
		liveUsers: new Set(live.map(({ userId }) => userId)).size,
		noExpiryGrants: live.filter((grant) => grant.expiresAt === undefined).length,
		pendingGrants,
		unresolvedGrants,
		registeredClients: clientKeys.length,
		signInsLast7d: resolved.filter(({ createdAt }) => createdAt > nowSeconds - 7 * DAY_SECONDS && createdAt <= nowSeconds).length,
		signInsByDay: signInsByDay(resolved, now),
		clients: clientRows(live, labels),
	}

	await env.DASH_KV.put(SUMMARY_KEY, JSON.stringify(summary))
	return summary
}

/** The summary the last cron run stored, or null before the first run */
export async function readGrantSummary(env: DashEnv): Promise<GrantSummary | null> {
	return env.DASH_KV.get<GrantSummary>(SUMMARY_KEY, 'json')
}

/** Splits `grant:<userId>:<grantId>` on the last colon, since only the grant ID is guaranteed colon-free */
function parseGrantKey(key: string): ListedGrant | null {
	const rest = key.slice(GRANT_PREFIX.length)
	const split = rest.lastIndexOf(':')
	if (split <= 0 || split === rest.length - 1) return null
	return { key, userId: rest.slice(0, split), grantId: rest.slice(split + 1) }
}

function toIndexEntry(record: GrantRecord): GrantIndexEntry {
	const entry: GrantIndexEntry = { createdAt: record.createdAt }
	if (record.clientId) entry.clientId = record.clientId
	if (record.expiresAt !== undefined) entry.expiresAt = record.expiresAt
	return entry
}

/**
 * Index entries expire a day after their grant. KV refuses an expiration in the past, so an entry for a grant that expired
 * long ago but is still listed gets a day from now instead.
 */
function indexExpiration(entry: GrantIndexEntry, nowSeconds: number): KVNamespacePutOptions {
	if (entry.expiresAt === undefined) return {}
	return { expiration: Math.max(entry.expiresAt + INDEX_GRACE_SECONDS, nowSeconds + INDEX_GRACE_SECONDS) }
}

/**
 * Maps each live grant's client ID to a label. CIMD (URL) IDs are labelled without a read. Registered IDs read `client:<id>`
 * once and memoise the label at `cl:<id>`; when the read budget is spent, they show as `unknown` until a later run.
 */
async function resolveClientLabels(env: DashEnv, live: ResolvedGrant[], budget: FetchBudget): Promise<Map<string, string>> {
	const labels = new Map<string, string>()
	const registered: string[] = []
	for (const clientId of new Set(live.map((grant) => grant.clientId))) {
		if (clientId === undefined) continue
		if (isCimdClientId(clientId)) labels.set(clientId, labelForClient(clientId))
		else registered.push(clientId)
	}

	const memoised = await bulkGet(
		env.DASH_KV,
		registered.map((clientId) => `${LABEL_PREFIX}${clientId}`),
	)
	const toFetch: string[] = []
	for (const clientId of registered) {
		const label = memoised.get(`${LABEL_PREFIX}${clientId}`)
		if (label) labels.set(clientId, label)
		else toFetch.push(clientId)
	}

	await forEachConcurrently(toFetch.slice(0, budget.take(toFetch.length)), async (clientId) => {
		const client = await getKvJson<ClientRecord>(env, `${CLIENT_PREFIX}${clientId}`)
		const label = labelForClient(clientId, client?.clientName)
		await env.DASH_KV.put(`${LABEL_PREFIX}${clientId}`, label, { expirationTtl: LABEL_TTL_SECONDS })
		labels.set(clientId, label)
	})

	return labels
}

function clientRows(live: ResolvedGrant[], labels: Map<string, string>): GrantSummary['clients'] {
	const byLabel = new Map<string, { grants: number; users: Set<string> }>()
	for (const grant of live) {
		const label = (grant.clientId && labels.get(grant.clientId)) || labelForClient(undefined)
		const row = byLabel.get(label) ?? { grants: 0, users: new Set<string>() }
		row.grants++
		row.users.add(grant.userId)
		byLabel.set(label, row)
	}

	return [...byLabel]
		.map(([label, { grants, users }]) => ({ label, grants, users: users.size }))
		.sort((a, b) => b.users - a.users || b.grants - a.grants || a.label.localeCompare(b.label))
}

/** Sign-ins (live or expired grants' createdAt) per UTC day over the last 30 days, oldest first */
function signInsByDay(grants: ResolvedGrant[], now: Date): GrantSummary['signInsByDay'] {
	const today = Math.floor(now.getTime() / 1000 / DAY_SECONDS)
	const counts = new Map<number, number>()
	for (const { createdAt } of grants) {
		const day = Math.floor(createdAt / DAY_SECONDS)
		if (day > today - SIGN_IN_DAYS && day <= today) counts.set(day, (counts.get(day) ?? 0) + 1)
	}

	return Array.from({ length: SIGN_IN_DAYS }, (_, i) => {
		const day = today - (SIGN_IN_DAYS - 1) + i
		return { date: new Date(day * DAY_SECONDS * 1000).toISOString().slice(0, 10), count: counts.get(day) ?? 0 }
	})
}

/** Reads many DASH_KV keys as text, in pages the bulk get accepts, and returns the ones that exist */
async function bulkGet(kv: KVNamespace, keys: string[]): Promise<Map<string, string>> {
	const found = new Map<string, string>()
	for (let i = 0; i < keys.length; i += BULK_GET_LIMIT) {
		const page = await kv.get(keys.slice(i, i + BULK_GET_LIMIT), 'text')
		for (const [key, value] of page) if (value !== null) found.set(key, value)
	}
	return found
}

/** Runs `task` over `items` with at most FETCH_CONCURRENCY in flight. On the first failure it starts no more, and rejects. */
async function forEachConcurrently<T>(items: T[], task: (item: T) => Promise<void>): Promise<void> {
	let next = 0
	let failed = false
	const worker = async (): Promise<void> => {
		while (!failed && next < items.length) {
			const item = items[next++]
			try {
				await task(item)
			} catch (error) {
				failed = true
				throw error
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, items.length) }, worker))
}
