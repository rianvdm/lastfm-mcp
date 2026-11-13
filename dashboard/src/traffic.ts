// ABOUTME: Request, error and client-disconnect counts for the production MCP Worker from the Analytics SQL API (beta).
// ABOUTME: The hourly cron stores 30 Pacific days, added up from hourly rows, in DASH_KV; the page queries the last 24 hours live.
import { analyticsSqlApi, toCount } from './cfApi'
import type { DashEnv } from './env'
import { lastPacificDates, pacificDate } from './pacific'

export interface TrafficDay {
	date: string
	requests: number
	errors: number
	disconnected: number
}

/** The cron's 30-day summary: the 30-day query takes about 7 seconds uncached, too slow to run on a page load */
export interface TrafficDays {
	computedAt: string
	/** The last 30 Pacific days as of computedAt, oldest first, zero-filled */
	days: TrafficDay[]
}

export interface TrafficLast24h {
	requests: number
	errors: number
}

const SUMMARY_KEY = 'summary:traffic-days'
const DAYS = 30
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** The script name is interpolated into SQL, so it must be a plain Worker name */
const SCRIPT_NAME = /^[A-Za-z0-9_-]+$/

/** Statuses for a request whose client went away before the response finished. They're shown apart and aren't errors. */
const DISCONNECTED_STATUSES = ['clientDisconnected', 'responseStreamDisconnected']
/** Every other status (an exception, an exceeded CPU or memory limit, and so on) counts as an error */
const NON_ERROR_STATUSES = ['success', ...DISCONNECTED_STATUSES]

const DISCONNECTED = new Set(DISCONNECTED_STATUSES)
const NON_ERROR = new Set(NON_ERROR_STATUSES)

/** A SQL list of the fixed status names above */
function sqlList(values: string[]): string {
	return values.map((value) => `'${value}'`).join(', ')
}

/*
 * The SQL API weights count() and countIf() by the adaptive sample interval itself, so neither query touches sampleInterval:
 * weighting again would multiply every count. Time bounds are timezone-qualified literals, and neither query has an ORDER BY,
 * which the API only accepts with a LIMIT.
 */

// One row per (hour, status): about 720 hours × a handful of statuses, about 1,500 rows. Grouped by hour because the API's
// toDate() takes no time zone; Pacific offsets are whole hours, so each UTC hour falls inside one Pacific day. Grouped by
// status rather than by countIf, so the same status sets classify the rows here as in the 24-hour query.
function dailySql(scriptName: string, since: string, until: string): string {
	return `SELECT
	toStartOfHour(timestamp) AS hour,
	status,
	count() AS requests
FROM events.workersInvocations
WHERE scriptName = '${scriptName}'
	AND timestamp >= '${since}'
	AND timestamp < '${until}'
GROUP BY toStartOfHour(timestamp), status`
}

// No dimensions, so it aggregates to one row; it's still summed in case the API splits it
function last24hSql(scriptName: string, since: string, until: string): string {
	return `SELECT
	count() AS requests,
	countIf(status NOT IN (${sqlList(NON_ERROR_STATUSES)})) AS errors
FROM events.workersInvocations
WHERE scriptName = '${scriptName}'
	AND timestamp >= '${since}'
	AND timestamp <= '${until}'`
}

/** SQL output rows. The API's JSON output can quote 64-bit integers, so counts can arrive as strings. */
interface HourSqlRow {
	/** The hour's start in UTC, as `YYYY-MM-DD hh:mm:ss` */
	hour: string
	status: string
	requests: number | string
}

interface TotalsSqlRow {
	requests: number | string
	errors: number | string
}

/** The epoch milliseconds of a SQL API hour (`YYYY-MM-DD hh:mm:ss` in UTC), or NaN for anything else */
function parseHour(hour: unknown): number {
	return typeof hour === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(hour)
		? Date.parse(`${hour.replace(' ', 'T')}Z`)
		: Number.NaN
}

/** A timezone-qualified SQL timestamp literal, to the second */
function sqlTimestamp(ms: number): string {
	return `${new Date(ms).toISOString().slice(0, 19)}Z`
}

/** A SCRIPT_NAME safe to interpolate into SQL; it throws before any query is sent otherwise */
function scriptNameOf(env: DashEnv): string {
	if (!SCRIPT_NAME.test(env.SCRIPT_NAME)) throw new Error('SCRIPT_NAME is not a valid Worker script name')
	return env.SCRIPT_NAME
}

/**
 * Recomputes the last 30 Pacific days of traffic for the production MCP Worker (`SCRIPT_NAME`) and stores them at
 * `summary:traffic-days`. A failed query rejects and leaves the previous summary in place.
 */
export async function refreshTrafficDays(env: DashEnv, now: Date = new Date()): Promise<TrafficDays> {
	const scriptName = scriptNameOf(env)
	const dates = lastPacificDates(now, DAYS)
	// UTC midnight of the first Pacific date is 7 or 8 hours before that day starts in Pacific time; the extra hours are
	// dropped below. The upper bound is the end of the current hour.
	const sinceMs = Date.parse(dates[0])
	const untilMs = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS
	const hourRows = await analyticsSqlApi<HourSqlRow>(env, dailySql(scriptName, sqlTimestamp(sinceMs), sqlTimestamp(untilMs)))

	const byDate = new Map(dates.map((date): [string, TrafficDay] => [date, { date, requests: 0, errors: 0, disconnected: 0 }]))
	for (const row of hourRows) {
		const hourMs = parseHour(row.hour)
		if (!Number.isFinite(hourMs)) continue
		const day = byDate.get(pacificDate(hourMs))
		if (!day) continue
		const requests = toCount(row.requests)
		const status = String(row.status)
		day.requests += requests
		if (DISCONNECTED.has(status)) day.disconnected += requests
		else if (!NON_ERROR.has(status)) day.errors += requests
	}

	const summary: TrafficDays = { computedAt: now.toISOString(), days: [...byDate.values()] }
	await env.DASH_KV.put(SUMMARY_KEY, JSON.stringify(summary))
	return summary
}

function isTrafficDay(value: unknown): value is TrafficDay {
	if (typeof value !== 'object' || value === null) return false
	const day = value as Record<string, unknown>
	return (
		typeof day.date === 'string' &&
		[day.requests, day.errors, day.disconnected].every((count) => typeof count === 'number' && Number.isFinite(count))
	)
}

function isTrafficDays(value: unknown): value is TrafficDays {
	if (typeof value !== 'object' || value === null) return false
	const summary = value as Record<string, unknown>
	return typeof summary.computedAt === 'string' && Array.isArray(summary.days) && summary.days.every(isTrafficDay)
}

/**
 * The stored 30-day traffic summary, or null before the first refresh. A stored value of any other shape also reads as
 * null, so the page warms up a fresh one instead of failing to render.
 */
export async function readTrafficDays(env: DashEnv): Promise<TrafficDays | null> {
	const stored = await env.DASH_KV.get<unknown>(SUMMARY_KEY, 'json')
	return isTrafficDays(stored) ? stored : null
}

/** Counts the production MCP Worker's requests and errors over the 24 hours before `now` */
export async function fetchTrafficLast24h(env: DashEnv, now: Date = new Date()): Promise<TrafficLast24h> {
	const scriptName = scriptNameOf(env)
	const nowMs = now.getTime()
	const rows = await analyticsSqlApi<TotalsSqlRow>(env, last24hSql(scriptName, sqlTimestamp(nowMs - DAY_MS), sqlTimestamp(nowMs)))

	const last24h = { requests: 0, errors: 0 }
	for (const row of rows) {
		last24h.requests += toCount(row.requests)
		last24h.errors += toCount(row.errors)
	}
	return last24h
}
