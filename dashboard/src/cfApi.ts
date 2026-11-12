// ABOUTME: Read-only Cloudflare API client for the dashboard: KV REST list and get, GraphQL Analytics, and Analytics Engine SQL.
// ABOUTME: Sends the API token as a bearer token, retries 429/5xx twice (1 s, then 3 s), and throws CfApiError with a short message.
import type { DashEnv } from './env'

const API_BASE = 'https://api.cloudflare.com/client/v4'

/** Waits before the second and third attempts at a request that got a 429 or 5xx */
const RETRY_DELAYS_MS = [1000, 3000]

/** The KV REST API's largest page size */
const KV_LIST_LIMIT = 1000

/** Keeps API error detail short enough for a dashboard tile */
const MAX_DETAIL_LENGTH = 160

/** A Cloudflare API call that failed, after retries where they apply. `status` is the HTTP status (200 for GraphQL errors). */
export class CfApiError extends Error {
	readonly status: number

	constructor(status: number, message: string) {
		super(message)
		this.name = 'CfApiError'
		this.status = status
	}
}

export interface KvKey {
	name: string
	/** Seconds since the epoch */
	expiration?: number
}

interface KvListResponse {
	success?: boolean
	errors?: Array<{ message?: string }>
	result?: Array<{ name: string; expiration?: number }>
	result_info?: { cursor?: string }
}

interface GraphqlResponse<T> {
	data?: T | null
	errors?: Array<{ message?: string }> | null
}

interface AnalyticsSqlResponse<T> {
	data?: T[]
}

/**
 * The Analytics SQL API's default JSON output has `data`, `rows` and `statistics` at the top level. A v4 envelope with the
 * rows under `result` is read too, in case the beta API changes shape, along with its `success` and `errors` fields.
 */
interface AnalyticsSqlApiResponse<T> {
	data?: T[]
	result?: { data?: T[] } | null
	success?: boolean
	errors?: Array<{ message?: string }> | null
}

/**
 * A count from either SQL API's JSON output as a number. Both can quote 64-bit integers, so a count may arrive as a string;
 * anything that isn't a finite number counts as 0.
 */
export function toCount(value: unknown): number {
	const n = typeof value === 'string' ? Number(value) : value
	return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

function isRetryable(status: number): boolean {
	return status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Sends one authenticated request, retrying a 429 or 5xx up to twice. Returns the last response, whatever its status,
 * so callers decide which statuses are errors (a KV 404 is a missing key, not a failure).
 */
async function send(env: DashEnv, url: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers)
	headers.set('Authorization', `Bearer ${env.CF_API_TOKEN}`)

	for (let attempt = 0; ; attempt++) {
		const response = await fetch(url, { ...init, headers })
		if (!isRetryable(response.status) || attempt >= RETRY_DELAYS_MS.length) return response
		// Release the connection before waiting; the body of a response we retry is never read
		await response.body?.cancel()
		await sleep(RETRY_DELAYS_MS[attempt])
	}
}

function truncate(text: string): string {
	const oneLine = text.replace(/\s+/g, ' ').trim()
	return oneLine.length > MAX_DETAIL_LENGTH ? `${oneLine.slice(0, MAX_DETAIL_LENGTH)}…` : oneLine
}

/** Pulls the first error message from a v4 JSON envelope, or the start of a plain-text body (the SQL API answers in text) */
function errorDetail(body: string): string {
	try {
		const parsed = JSON.parse(body) as { errors?: Array<{ message?: string }> }
		const message = parsed.errors?.find((error) => error.message)?.message
		if (message) return truncate(message)
	} catch {
		// Not JSON: fall through to the raw text
	}
	return truncate(body)
}

async function failure(response: Response, operation: string): Promise<CfApiError> {
	const detail = errorDetail(await response.text().catch(() => ''))
	return new CfApiError(response.status, `${operation} failed (${response.status})${detail ? `: ${detail}` : ''}`)
}

async function readJson<T>(response: Response, operation: string): Promise<T> {
	try {
		return (await response.json()) as T
	} catch {
		throw new CfApiError(response.status, `${operation} returned a body that is not JSON`)
	}
}

function kvNamespaceUrl(env: DashEnv): string {
	return `${API_BASE}/accounts/${env.ACCOUNT_ID}/storage/kv/namespaces/${env.OAUTH_KV_NAMESPACE_ID}`
}

/** Lists every key under `prefix` in the production OAUTH_KV namespace, following the cursor page by page */
export async function listKvKeys(env: DashEnv, prefix: string): Promise<KvKey[]> {
	const keys: KvKey[] = []
	let cursor: string | undefined

	do {
		const params = new URLSearchParams({ prefix, limit: String(KV_LIST_LIMIT) })
		if (cursor) params.set('cursor', cursor)

		const response = await send(env, `${kvNamespaceUrl(env)}/keys?${params}`)
		if (!response.ok) throw await failure(response, 'KV list')
		const body = await readJson<KvListResponse>(response, 'KV list')
		if (body.success === false) throw new CfApiError(response.status, `KV list failed: ${errorDetail(JSON.stringify(body))}`)

		for (const { name, expiration } of body.result ?? []) {
			keys.push(expiration === undefined ? { name } : { name, expiration })
		}
		cursor = body.result_info?.cursor || undefined
	} while (cursor)

	return keys
}

/** Reads one OAUTH_KV value as JSON, or null when the key doesn't exist. The key is URL-encoded: client IDs can be URLs. */
export async function getKvJson<T>(env: DashEnv, key: string): Promise<T | null> {
	const response = await send(env, `${kvNamespaceUrl(env)}/values/${encodeURIComponent(key)}`)
	if (response.status === 404) {
		await response.body?.cancel()
		return null
	}
	if (!response.ok) throw await failure(response, 'KV get')
	return readJson<T>(response, 'KV get')
}

/** Runs a GraphQL Analytics query. The API reports query errors in `errors` with an HTTP 200, so those throw too. */
export async function graphql<T>(env: DashEnv, query: string, variables: Record<string, unknown>): Promise<T> {
	const response = await send(env, `${API_BASE}/graphql`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	})
	if (!response.ok) throw await failure(response, 'GraphQL')

	const body = await readJson<GraphqlResponse<T>>(response, 'GraphQL')
	if (body.errors && body.errors.length > 0) {
		throw new CfApiError(response.status, `GraphQL failed: ${errorDetail(JSON.stringify({ errors: body.errors }))}`)
	}
	if (body.data == null) throw new CfApiError(response.status, 'GraphQL returned no data')
	return body.data
}

/**
 * Runs one statement against the Analytics SQL API (beta), scoped to the dashboard's account, and returns its `data` rows.
 * The query has no FORMAT clause, so the API answers with its default JSON output. Not the Analytics Engine SQL API: see
 * `analyticsSql` for that.
 */
export async function analyticsSqlApi<T>(env: DashEnv, sql: string): Promise<T[]> {
	const response = await send(env, `${API_BASE}/analytics/sql`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query: sql, scope: { accountTag: env.ACCOUNT_ID } }),
	})
	if (!response.ok) throw await failure(response, 'Analytics SQL API')

	const body = await readJson<AnalyticsSqlApiResponse<T>>(response, 'Analytics SQL API')
	if (body.success === false || (body.errors && body.errors.length > 0)) {
		const detail = body.errors?.find((error) => error.message)?.message
		throw new CfApiError(response.status, detail ? `Analytics SQL API failed: ${truncate(detail)}` : 'Analytics SQL API failed')
	}
	const data = body.data ?? body.result?.data
	if (!Array.isArray(data)) throw new CfApiError(response.status, 'Analytics SQL API returned no data')
	return data
}

/** Ends the statement with exactly one FORMAT JSON, dropping a trailing semicolon the SQL API would reject */
function withJsonFormat(sql: string): string {
	const statement = sql.trim().replace(/;\s*$/, '').trimEnd()
	return /\bFORMAT\s+JSON$/i.test(statement) ? statement : `${statement} FORMAT JSON`
}

/** Runs an Analytics Engine SQL query and returns the `data` rows of its JSON output */
export async function analyticsSql<T>(env: DashEnv, sql: string): Promise<T[]> {
	const response = await send(env, `${API_BASE}/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`, {
		method: 'POST',
		headers: { 'Content-Type': 'text/plain' },
		body: withJsonFormat(sql),
	})
	if (!response.ok) throw await failure(response, 'Analytics Engine SQL')

	const body = await readJson<AnalyticsSqlResponse<T>>(response, 'Analytics Engine SQL')
	return body.data ?? []
}
