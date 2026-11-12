// ABOUTME: Per-tool and per-client usage from the tool-call events the MCP Worker writes to Workers Analytics Engine.
// ABOUTME: Counts are weighted by _sample_interval, latency quantiles by the same weight; four SQL queries run in parallel.
import { CLIENT_LABELS } from '../../src/analytics/clientLabel'
import { analyticsSql, toCount } from './cfApi'
import type { DashEnv } from './env'

export interface ToolRow {
	tool: string
	calls: number
	errors: number
	authRequired: number
	p50Ms: number | null
	p95Ms: number | null
	/** hits / (hits + misses), or null when the tool made no cache lookups */
	cacheHitRate: number | null
}

export interface ToolStats {
	/** The oldest event still in the dataset (Analytics Engine keeps about three months), or null before the first event */
	firstEventAt: string | null
	last24h: ToolRow[]
	last7d: ToolRow[]
	clients7d: Array<{ label: string; calls: number }>
}

/** The dataset name is interpolated into SQL, so it must be a plain identifier */
const DATASET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** SQL output for one tool. The SQL API's JSON output quotes 64-bit integers, so counts can arrive as strings. */
interface ToolSqlRow {
	tool: string
	calls: number | string
	errors: number | string
	auth_required: number | string
	p50: number | string | null
	p95: number | string | null
	hits: number | string
	misses: number | string
}

interface ClientSqlRow {
	label: string
	calls: number | string
}

interface FirstEventSqlRow {
	first_event: string
	events: number | string
}

/*
 * Event layout (written by src/analytics in the MCP Worker): index1 = tool, blob1 = tool, blob2 = client label,
 * blob3 = outcome (ok | error | auth_required), blob4 = cache (hit | miss | none), blob5 = server version, double1 = ms.
 *
 * Latency uses quantileExactWeighted(q)(column, weight). The Analytics Engine SQL reference documents it as the weighted
 * quantile function and lists quantileWeighted(q, column, weight) only as a backwards-compatibility alias, so the documented
 * form is used rather than the alias: https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/aggregate-functions/
 * Checked against the docs on 2026-11-12, not yet against the live API.
 */
function toolSql(dataset: string, days: 1 | 7): string {
	return `SELECT
	blob1 AS tool,
	SUM(_sample_interval) AS calls,
	sumIf(_sample_interval, blob3 = 'error') AS errors,
	sumIf(_sample_interval, blob3 = 'auth_required') AS auth_required,
	quantileExactWeighted(0.5)(double1, _sample_interval) AS p50,
	quantileExactWeighted(0.95)(double1, _sample_interval) AS p95,
	sumIf(_sample_interval, blob4 = 'hit') AS hits,
	sumIf(_sample_interval, blob4 = 'miss') AS misses
FROM ${dataset}
WHERE timestamp > NOW() - INTERVAL '${days}' DAY
GROUP BY blob1
ORDER BY calls DESC`
}

function clientSql(dataset: string): string {
	return `SELECT
	blob2 AS label,
	SUM(_sample_interval) AS calls
FROM ${dataset}
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY blob2
ORDER BY calls DESC`
}

// min() over an empty table returns the epoch rather than no row, so the weighted event count tells the two apart
function firstEventSql(dataset: string): string {
	return `SELECT
	min(timestamp) AS first_event,
	SUM(_sample_interval) AS events
FROM ${dataset}`
}

function toMs(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null
	const n = typeof value === 'string' ? Number(value) : value
	return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function toToolRow(row: ToolSqlRow): ToolRow {
	const hits = toCount(row.hits)
	const misses = toCount(row.misses)
	return {
		tool: String(row.tool),
		calls: toCount(row.calls),
		errors: toCount(row.errors),
		authRequired: toCount(row.auth_required),
		p50Ms: toMs(row.p50),
		p95Ms: toMs(row.p95),
		cacheHitRate: hits + misses > 0 ? hits / (hits + misses) : null,
	}
}

/** Analytics Engine timestamps come back as `YYYY-MM-DD hh:mm:ss` in UTC */
function toIsoTimestamp(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value)
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * Calls per client label, with any label outside CLIENT_LABELS folded into "other". The MCP Worker only writes allowlisted
 * labels, so this guards the page against events written by an older or misconfigured version.
 */
function toClientRows(rows: ClientSqlRow[]): ToolStats['clients7d'] {
	const callsByLabel = new Map<string, number>()
	for (const row of rows) {
		const label = CLIENT_LABELS.has(String(row.label)) ? String(row.label) : 'other'
		callsByLabel.set(label, (callsByLabel.get(label) ?? 0) + toCount(row.calls))
	}
	return [...callsByLabel].map(([label, calls]) => ({ label, calls }))
}

function byCallsDescending<T extends { calls: number }>(rows: T[]): T[] {
	return rows.sort((a, b) => b.calls - a.calls)
}

/** Fetches per-tool stats for the last 24 hours and 7 days, 7-day calls per client, and when tool events start */
export async function fetchToolStats(env: DashEnv): Promise<ToolStats> {
	const dataset = env.TOOL_EVENTS_DATASET
	if (!DATASET_NAME.test(dataset)) throw new Error('TOOL_EVENTS_DATASET is not a valid dataset name')

	const [tools24h, tools7d, clients, first] = await Promise.all([
		analyticsSql<ToolSqlRow>(env, toolSql(dataset, 1)),
		analyticsSql<ToolSqlRow>(env, toolSql(dataset, 7)),
		analyticsSql<ClientSqlRow>(env, clientSql(dataset)),
		analyticsSql<FirstEventSqlRow>(env, firstEventSql(dataset)),
	])

	const firstRow = first[0]
	return {
		firstEventAt: firstRow && toCount(firstRow.events) > 0 ? toIsoTimestamp(firstRow.first_event) : null,
		last24h: byCallsDescending(tools24h.map(toToolRow)),
		last7d: byCallsDescending(tools7d.map(toToolRow)),
		clients7d: byCallsDescending(toClientRows(clients)),
	}
}
