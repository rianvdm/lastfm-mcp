// ABOUTME: Assembles the dashboard page model from the cron's active-user and grant summaries and the cached traffic and tool loads.
// ABOUTME: A failed load becomes a short reason for its own panel; upstream error text never reaches the page or the logs.
import { activeUserKey, readActiveUsersSummary } from './activeUsers'
import type { ActiveUsersSummary } from './activeUsers'
import { cachedJson } from './cached'
import { CfApiError } from './cfApi'
import type { DashEnv } from './env'
import { readGrantSummary } from './grants'
import type { GrantSummary } from './grants'
import { fetchToolStats } from './tools'
import type { ToolStats } from './tools'
import { fetchTraffic } from './traffic'
import type { TrafficSummary } from './traffic'

export interface LoadError {
	error: string
}

/** Active users aren't counted while the HMAC key is missing or too short */
export interface NotConfigured {
	notConfigured: true
}

export interface DashboardModel {
	generatedAt: string
	/** null until the first cron run (or warm-up refresh) has stored a summary */
	activeUsers: ActiveUsersSummary | LoadError | NotConfigured | null
	/** null until the first cron run (or warm-up refresh) has stored a summary */
	grants: GrantSummary | LoadError | null
	traffic: TrafficSummary | LoadError
	tools: ToolStats | LoadError
}

/** Reloads within this window reuse the stored traffic and tool results instead of querying the analytics APIs again */
export const ANALYTICS_CACHE_TTL_SECONDS = 300
// Versioned, so a deploy that changes a summary's shape never reads an old-shaped cached value
const TRAFFIC_CACHE_KEY = 'cache:traffic:v1'
const TOOLS_CACHE_KEY = 'cache:tools:v1'

export function isLoadError(value: unknown): value is LoadError {
	return typeof value === 'object' && value !== null && 'error' in value
}

export function isNotConfigured(value: unknown): value is NotConfigured {
	return typeof value === 'object' && value !== null && 'notConfigured' in value
}

/**
 * A short, fixed reason for a failed load. CfApiError messages can carry upstream body text, which can hold a grant key
 * and so a username, so only the HTTP status or a category is shown.
 */
export function loadFailureReason(error: unknown): string {
	// A CfApiError on a 200 is a body we couldn't use: not JSON, no rows, or a failure envelope
	if (error instanceof CfApiError) return error.status === 200 ? 'unexpected response' : `HTTP ${error.status}`
	// fetch rejects with a TypeError when the connection fails
	if (error instanceof TypeError) return 'network error'
	return 'unexpected error'
}

function settle<T>(name: string, result: PromiseSettledResult<T>): T | LoadError {
	if (result.status === 'fulfilled') return result.value
	const reason = loadFailureReason(result.reason)
	console.error(`[STATS] ${name} load failed: ${reason}`)
	return { error: reason }
}

/** Runs the loads in parallel; each one's failure is contained to its own field */
export async function buildDashboardModel(env: DashEnv, now: Date = new Date()): Promise<DashboardModel> {
	const configured = activeUserKey(env) !== null
	const [activeUsers, grants, traffic, tools] = await Promise.allSettled([
		configured ? readActiveUsersSummary(env) : Promise.resolve<NotConfigured>({ notConfigured: true }),
		readGrantSummary(env),
		cachedJson(env, TRAFFIC_CACHE_KEY, ANALYTICS_CACHE_TTL_SECONDS, () => fetchTraffic(env, now)),
		cachedJson(env, TOOLS_CACHE_KEY, ANALYTICS_CACHE_TTL_SECONDS, () => fetchToolStats(env)),
	])

	return {
		generatedAt: now.toISOString(),
		activeUsers: settle('active users', activeUsers),
		grants: settle('grant summary', grants),
		traffic: settle('traffic', traffic),
		tools: settle('tool stats', tools),
	}
}
