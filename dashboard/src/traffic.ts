// ABOUTME: Daily request, error and client-disconnect counts for the production MCP Worker from Workers GraphQL Analytics.
// ABOUTME: One GraphQL request returns the 30-day daily split by status and the rolling 24-hour totals.
import { CfApiError, graphql } from './cfApi'
import type { DashEnv } from './env'

export interface TrafficSummary {
	/** The last 30 UTC days, oldest first, zero-filled */
	days: Array<{ date: string; requests: number; errors: number; disconnected: number }>
	last24h: { requests: number; errors: number }
}

const DAYS = 30
const DAY_MS = 86_400_000

/** The status workersInvocationsAdaptive gives a request whose client went away before the response finished */
const DISCONNECTED_STATUS = 'clientDisconnected'

// Rows are one per (date, status): about 30 days × a handful of statuses, far under the limit. `last24h` has no dimensions,
// so it aggregates to one row; it's still summed in case the API splits it.
const TRAFFIC_QUERY = `query DashboardTraffic($accountTag: string!, $scriptName: string!, $since: Date!, $until: Date!, $since24h: Time!, $now: Time!) {
	viewer {
		accounts(filter: { accountTag: $accountTag }) {
			days: workersInvocationsAdaptive(limit: 1000, filter: { scriptName: $scriptName, date_geq: $since, date_leq: $until }) {
				dimensions { date status }
				sum { requests errors }
			}
			last24h: workersInvocationsAdaptive(limit: 1000, filter: { scriptName: $scriptName, datetime_geq: $since24h, datetime_leq: $now }) {
				sum { requests errors }
			}
		}
	}
}`

interface Sum {
	requests?: number
	errors?: number
}

interface TrafficResponse {
	viewer?: {
		accounts?: Array<{
			days?: Array<{ dimensions?: { date?: string; status?: string }; sum?: Sum }>
			last24h?: Array<{ sum?: Sum }>
		}>
	}
}

function utcDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10)
}

function count(value: number | undefined): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Fetches the 30-day daily traffic and the last 24 hours for the production MCP Worker (`SCRIPT_NAME`) */
export async function fetchTraffic(env: DashEnv, now: Date = new Date()): Promise<TrafficSummary> {
	const todayMs = Math.floor(now.getTime() / DAY_MS) * DAY_MS
	const dates = Array.from({ length: DAYS }, (_, i) => utcDate(todayMs - (DAYS - 1 - i) * DAY_MS))

	const data = await graphql<TrafficResponse>(env, TRAFFIC_QUERY, {
		accountTag: env.ACCOUNT_ID,
		scriptName: env.SCRIPT_NAME,
		since: dates[0],
		until: dates[DAYS - 1],
		since24h: new Date(now.getTime() - DAY_MS).toISOString(),
		now: now.toISOString(),
	})

	const account = data.viewer?.accounts?.[0]
	// Our own message, not upstream text: an account the token can't see comes back as an empty list, not an error
	if (!account) throw new CfApiError(200, 'GraphQL returned no account')

	const byDate = new Map(dates.map((date) => [date, { date, requests: 0, errors: 0, disconnected: 0 }]))
	for (const row of account.days ?? []) {
		const day = row.dimensions?.date ? byDate.get(row.dimensions.date) : undefined
		if (!day) continue
		const requests = count(row.sum?.requests)
		day.requests += requests
		day.errors += count(row.sum?.errors)
		if (row.dimensions?.status === DISCONNECTED_STATUS) day.disconnected += requests
	}

	const last24h = { requests: 0, errors: 0 }
	for (const row of account.last24h ?? []) {
		last24h.requests += count(row.sum?.requests)
		last24h.errors += count(row.sum?.errors)
	}

	return { days: [...byDate.values()], last24h }
}
