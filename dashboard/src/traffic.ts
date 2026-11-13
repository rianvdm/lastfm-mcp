// ABOUTME: Daily request, error and client-disconnect counts for the production MCP Worker from the Analytics SQL API (beta).
// ABOUTME: Two queries over events.workersInvocations run in parallel: 30 days by hour and status, added into Pacific days, and the last 24 hours.
import { analyticsSqlApi, toCount } from './cfApi'
import type { DashEnv } from './env'
import { lastPacificDates, pacificDate } from './pacific'

export interface TrafficSummary {
	/** The last 30 Pacific days, oldest first, zero-filled */
	days: Array<{ date: string; requests: number; errors: number; disconnected: number }>
	last24h: { requests: number; errors: number }
}

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

/** Fetches the 30-day daily traffic and the last 24 hours for the production MCP Worker (`SCRIPT_NAME`) */
export async function fetchTraffic(env: DashEnv, now: Date = new Date()): Promise<TrafficSummary> {
	const scriptName = env.SCRIPT_NAME
	if (!SCRIPT_NAME.test(scriptName)) throw new Error('SCRIPT_NAME is not a valid Worker script name')

	const nowMs = now.getTime()
	const dates = lastPacificDates(now, DAYS)
	// UTC midnight of the first Pacific date is 7 or 8 hours before that day starts in Pacific time; the extra hours are
	// dropped below. The upper bound is the end of the current hour.
	const sinceMs = Date.parse(dates[0])
	const untilMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS + HOUR_MS

	const [hourRows, totalsRows] = await Promise.all([
		analyticsSqlApi<HourSqlRow>(env, dailySql(scriptName, sqlTimestamp(sinceMs), sqlTimestamp(untilMs))),
		analyticsSqlApi<TotalsSqlRow>(env, last24hSql(scriptName, sqlTimestamp(nowMs - DAY_MS), sqlTimestamp(nowMs))),
	])

	const byDate = new Map(dates.map((date) => [date, { date, requests: 0, errors: 0, disconnected: 0 }]))
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

	const last24h = { requests: 0, errors: 0 }
	for (const row of totalsRows) {
		last24h.requests += toCount(row.requests)
		last24h.errors += toCount(row.errors)
	}

	return { days: [...byDate.values()], last24h }
}
