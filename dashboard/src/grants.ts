// ABOUTME: Builds the hourly OAuth grant summary from production OAUTH_KV: live users and grants, 30-day sign-ins, and clients.
// ABOUTME: Reads each grant once into an index in DASH_KV that holds no username, client URL or client name, and caps reads per run.
import { CLIENT_LABELS, isCimdClientId, labelForClient } from '../../src/analytics/clientLabel'
import { getKvJson, listKvKeys } from './cfApi'
import { listDashKeys } from './dashKv'
import type { DashEnv } from './env'
import { lastPacificDates, pacificDate } from './pacific'

export interface GrantSummary {
	computedAt: string
	liveGrants: number
	liveUsers: number
	noExpiryGrants: number
	pendingGrants: number
	unresolvedGrants: number
	registeredClients: number
	signInsLast7d: number
	/** The last 30 Pacific days, oldest first, with zero-filled days */
	signInsByDay: Array<{ date: string; count: number }>
	/** Live grants per client label, sorted by users descending */
	clients: Array<{ label: string; grants: number; users: number }>
}

export interface RefreshOptions {
	/** Most production KV value reads (grants, then clients) plus index relabels in one run. Defaults to MAX_FETCHES_PER_RUN. */
	maxFetches?: number
}

/**
 * Caps production value reads per run. Grant reads take the cap first; client reads for the registered clients those grants
 * use get what's left. A run sends at most about 406 Cloudflare REST requests (these reads plus a few key listings), and each
 * is attempted up to three times on a 429 or 5xx, so the worst case is about 1,218 fetches, inside the Workers Paid limit of
 * 10,000 subrequests.
 *
 * Rewriting an older index entry whose client label has just arrived costs no production read, but takes from the same cap,
 * so DASH_KV sees at most about 850 operations, under the 1,000 per invocation KV allows: one write per value read or
 * relabel, a delete for each pending grant that completed, and a few list and bulk get pages.
 *
 * Grants past the cap are picked up next run, so a full backfill of about 924 grants takes three runs of grant reads. Every
 * grant read is counted from the run it's read in; a registered client's label follows on the first run with reads to spare,
 * which in that backfill is the third.
 */
export const MAX_FETCHES_PER_RUN = 400

const SUMMARY_KEY = 'summary:grants'
const GRANT_PREFIX = 'grant:'
const CLIENT_PREFIX = 'client:'
const INDEX_PREFIX = 'gi:'
const PENDING_PREFIX = 'gp:'
const LABEL_PREFIX = 'cl:'

/** labelForClient's label for a client with no usable name; also used while a registered client's label is unread */
const UNKNOWN_LABEL = 'unknown'

const DAY_SECONDS = 86400
const SIGN_IN_DAYS = 30

/** Index entries outlive their grant by a day, and are never written to expire sooner than a day from now */
const INDEX_GRACE_SECONDS = DAY_SECONDS

/**
 * A `gp:<grantId>` marker records when a pending grant was last read, to order re-reads fairly. It isn't a skip window:
 * the long expiry only cleans up markers for grants that have disappeared from OAUTH_KV.
 */
const PENDING_MARKER_SECONDS = 30 * DAY_SECONDS

/** Registered client names can't change, but clients can be deleted, so labels are re-read monthly */
const LABEL_TTL_SECONDS = 30 * DAY_SECONDS

/** The KV binding's bulk get takes at most 100 keys */
const BULK_GET_LIMIT = 100

/** A Worker can hold six connections open at once; more just queue */
const FETCH_CONCURRENCY = 6

/**
 * What the summary needs from one grant, stored at `gi:<grantId>`. It holds no username (the user ID stays in memory, taken
 * from the listed key), no client URL and no client name: only the client's label from CLIENT_LABELS.
 */
interface GrantIndexEntry {
	label: string
	/**
	 * A registered client's random ID, kept only while its label is unread (the run's reads ran out before its client). The
	 * label is then `unknown`; a later run reads the client and rewrites the entry without this field. Never a URL.
	 */
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

/** The value of a `gp:<grantId>` marker */
interface PendingMarker {
	/** Seconds since the epoch */
	lastCheckedAt: number
}

interface ListedGrant {
	key: string
	userId: string
	grantId: string
}

/** A resolved grant, kept in memory for this run only */
interface ResolvedGrant {
	userId: string
	label: string
	createdAt: number
	expiresAt?: number
}

/** A listed grant and its `gi:` entry */
interface IndexedGrant {
	grant: ListedGrant
	entry: GrantIndexEntry
}

/** Counts production value reads, and index relabels, against the per-run cap */
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
 * Every run lists all grant and client keys, but reads a value only when it isn't indexed yet. Grants are read first, so
 * client registrations, which anyone can create, never take reads from them. Pending grants (an authorization code that was
 * never exchanged) are never indexed. They get a `gp:` marker with the time they were last checked instead, and are re-read
 * after every never-read grant, least recently checked first, until they complete or expire.
 *
 * Labels are then read only for the registered clients those grants use whose `cl:` label isn't memoised, with whatever reads
 * the grants left. A grant whose label is still unread is indexed anyway, as `unknown` with its client's random ID, so it
 * counts as live from the run it's read in; a later run reads the label and rewrites the entry without the ID.
 *
 * Live counts and clients come from the grants listed now. Sign-ins come from every retained index entry, so a grant that a
 * later sign-in replaced still counts on the day it was created.
 */
export async function refreshGrantSummary(env: DashEnv, now: Date = new Date(), options: RefreshOptions = {}): Promise<GrantSummary> {
	const nowSeconds = Math.floor(now.getTime() / 1000)
	const budget = new FetchBudget(options.maxFetches ?? MAX_FETCHES_PER_RUN)

	const [grantKeys, clientKeys, indexKeys] = await Promise.all([
		listKvKeys(env, GRANT_PREFIX),
		listKvKeys(env, CLIENT_PREFIX),
		listDashKeys(env.DASH_KV, INDEX_PREFIX),
	])
	const listed = grantKeys.map(({ name }) => parseGrantKey(name)).filter((grant): grant is ListedGrant => grant !== null)
	// Registered (DCR) client IDs are random. A URL client ID is labelled from the URL alone and never stored.
	const listedClients = new Set(clientKeys.map(({ name }) => name.slice(CLIENT_PREFIX.length)).filter((id) => id && !isCimdClientId(id)))

	const stored = await bulkGet(env.DASH_KV, [
		...new Set([...indexKeys, ...listed.map(({ grantId }) => `${INDEX_PREFIX}${grantId}`)]),
		...listed.map(({ grantId }) => `${PENDING_PREFIX}${grantId}`),
	])

	/** Listed grants indexed on an earlier run */
	const indexed: IndexedGrant[] = []
	const neverRead: ListedGrant[] = []
	const marked: Array<{ grant: ListedGrant; lastCheckedAt: number }> = []
	for (const grant of listed) {
		const entry = stored.get(`${INDEX_PREFIX}${grant.grantId}`)
		const marker = stored.get(`${PENDING_PREFIX}${grant.grantId}`)
		if (entry) indexed.push({ grant, entry: JSON.parse(entry) as GrantIndexEntry })
		else if (marker) marked.push({ grant, lastCheckedAt: (JSON.parse(marker) as PendingMarker).lastCheckedAt })
		else neverRead.push(grant)
	}

	// Grants never read go first, in listing order, then pending ones, least recently checked first. Every grant is
	// therefore read within a bounded number of runs, however many pending grants are listed ahead of it.
	marked.sort((a, b) => a.lastCheckedAt - b.lastCheckedAt)
	const markedGrants = new Set(marked.map(({ grant }) => grant))
	const toRead = [...neverRead, ...markedGrants]
	const reading = toRead.slice(0, budget.take(toRead.length))
	// A grant the budget didn't reach is unresolved, even if it was pending when last read: it may have completed since
	const unresolvedGrants = toRead.length - reading.length
	let pendingGrants = 0
	/** Grants indexed this run, by grant ID; the listing above may not show their entries yet */
	const indexedNow = new Map<string, IndexedGrant>()
	/** Completed grants read this run whose registered client's label isn't known yet */
	const awaitingLabel: Array<{ grant: ListedGrant; record: GrantRecord; clientId: string }> = []

	const writeIndexEntry = async (grant: ListedGrant, entry: GrantIndexEntry): Promise<void> => {
		await env.DASH_KV.put(`${INDEX_PREFIX}${grant.grantId}`, JSON.stringify(entry), indexExpiration(entry, nowSeconds))
		if (markedGrants.has(grant)) await env.DASH_KV.delete(`${PENDING_PREFIX}${grant.grantId}`)
		indexedNow.set(grant.grantId, { grant, entry })
	}

	await forEachConcurrently(reading, async (grant) => {
		const record = await getKvJson<GrantRecord>(env, grant.key)
		// Deleted between the list and the read: the grant is gone, so it isn't counted
		if (!record) return
		if (record.authCodeId && !record.refreshTokenId) {
			pendingGrants++
			const marker: PendingMarker = { lastCheckedAt: nowSeconds }
			await env.DASH_KV.put(`${PENDING_PREFIX}${grant.grantId}`, JSON.stringify(marker), {
				expiration: nowSeconds + PENDING_MARKER_SECONDS,
			})
			return
		}
		const clientId = record.clientId
		if (clientId !== undefined && listedClients.has(clientId)) awaitingLabel.push({ grant, record, clientId })
		// A URL client ID needs no read, and a registered client that is no longer listed (deleted) has no name to read
		else await writeIndexEntry(grant, toIndexEntry(record, labelForClient(clientId)))
	})

	const unlabelled = indexed.filter(({ entry }) => entry.clientId !== undefined)
	const labels = await resolveClientLabels(
		env,
		[...awaitingLabel.map(({ clientId }) => clientId), ...unlabelled.map(({ entry }) => entry.clientId as string)],
		listedClients,
		budget,
	)

	await forEachConcurrently(awaitingLabel, async ({ grant, record, clientId }) => {
		const label = labels.get(clientId)
		await writeIndexEntry(grant, label === undefined ? { ...toIndexEntry(record, UNKNOWN_LABEL), clientId } : toIndexEntry(record, label))
	})

	// Older entries whose label has now arrived drop their client ID, as far as the cap allows. Until then they are
	// labelled in memory below, so the summary is right either way.
	const relabelled = unlabelled.filter(({ entry }) => labels.has(entry.clientId as string))
	await forEachConcurrently(relabelled.slice(0, budget.take(relabelled.length)), async ({ grant, entry }) => {
		const { clientId, ...rest } = entry
		const relabelledEntry: GrantIndexEntry = { ...rest, label: labels.get(clientId as string) as string }
		await env.DASH_KV.put(`${INDEX_PREFIX}${grant.grantId}`, JSON.stringify(relabelledEntry), indexExpiration(relabelledEntry, nowSeconds))
	})

	const resolved = [...indexed, ...indexedNow.values()].map(({ grant, entry }) => toResolved(grant, entry, labels))
	const live = resolved.filter((grant) => grant.expiresAt === undefined || grant.expiresAt > nowSeconds)
	const signIns = signInTimes(stored, indexedNow)

	const summary: GrantSummary = {
		computedAt: now.toISOString(),
		liveGrants: live.length,
		liveUsers: new Set(live.map(({ userId }) => userId)).size,
		noExpiryGrants: live.filter((grant) => grant.expiresAt === undefined).length,
		pendingGrants,
		unresolvedGrants,
		registeredClients: clientKeys.length,
		signInsLast7d: signIns.filter((createdAt) => createdAt > nowSeconds - 7 * DAY_SECONDS && createdAt <= nowSeconds).length,
		signInsByDay: signInsByDay(signIns, now),
		clients: clientRows(live),
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

function toIndexEntry(record: GrantRecord, label: string): GrantIndexEntry {
	const entry: GrantIndexEntry = { label, createdAt: record.createdAt }
	if (record.expiresAt !== undefined) entry.expiresAt = record.expiresAt
	return entry
}

/** A grant for this run's counts, labelled from a label read this run when its entry still carries a client ID */
function toResolved(grant: ListedGrant, entry: GrantIndexEntry, labels: Map<string, string>): ResolvedGrant {
	const label = entry.clientId === undefined ? entry.label : (labels.get(entry.clientId) ?? entry.label)
	const resolved: ResolvedGrant = { userId: grant.userId, label, createdAt: entry.createdAt }
	if (entry.expiresAt !== undefined) resolved.expiresAt = entry.expiresAt
	return resolved
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
 * Maps registered client IDs to labels. A client that is no longer listed (deleted) is `unknown` without a read. A label
 * memoised at `cl:<id>` is used as is; the rest are read from `client:<id>`, with whatever the budget has left, and memoised.
 * Only labels from CLIENT_LABELS are stored, never the registered name. IDs the budget didn't reach are left out of the map.
 */
async function resolveClientLabels(
	env: DashEnv,
	clientIds: string[],
	listedClients: Set<string>,
	budget: FetchBudget,
): Promise<Map<string, string>> {
	const labels = new Map<string, string>()
	const listedIds: string[] = []
	for (const clientId of new Set(clientIds)) {
		if (listedClients.has(clientId)) listedIds.push(clientId)
		else labels.set(clientId, UNKNOWN_LABEL)
	}

	const memoised = await bulkGet(
		env.DASH_KV,
		listedIds.map((clientId) => `${LABEL_PREFIX}${clientId}`),
	)
	const toFetch: string[] = []
	for (const clientId of listedIds) {
		const label = memoised.get(`${LABEL_PREFIX}${clientId}`)
		if (label !== undefined && CLIENT_LABELS.has(label)) labels.set(clientId, label)
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

function clientRows(live: ResolvedGrant[]): GrantSummary['clients'] {
	const byLabel = new Map<string, { grants: number; users: Set<string> }>()
	for (const grant of live) {
		const row = byLabel.get(grant.label) ?? { grants: 0, users: new Set<string>() }
		row.grants++
		row.users.add(grant.userId)
		byLabel.set(grant.label, row)
	}

	return [...byLabel]
		.map(([label, { grants, users }]) => ({ label, grants, users: users.size }))
		.sort((a, b) => b.users - a.users || b.grants - a.grants || a.label.localeCompare(b.label))
}

/** The creation time of every retained index entry, one per grant, including grants no longer listed */
function signInTimes(stored: Map<string, string>, indexedNow: Map<string, IndexedGrant>): number[] {
	const byGrant = new Map<string, number>()
	for (const [key, value] of stored) {
		if (key.startsWith(INDEX_PREFIX)) byGrant.set(key.slice(INDEX_PREFIX.length), (JSON.parse(value) as GrantIndexEntry).createdAt)
	}
	for (const [grantId, { entry }] of indexedNow) byGrant.set(grantId, entry.createdAt)
	return [...byGrant.values()]
}

/** Sign-ins per Pacific day over the last 30 days, oldest first */
function signInsByDay(signIns: number[], now: Date): GrantSummary['signInsByDay'] {
	const counts = new Map(lastPacificDates(now, SIGN_IN_DAYS).map((date) => [date, 0]))
	for (const createdAt of signIns) {
		const date = pacificDate(createdAt * 1000)
		const count = counts.get(date)
		if (count !== undefined) counts.set(date, count + 1)
	}
	return [...counts].map(([date, count]) => ({ date, count }))
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
