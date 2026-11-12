// ABOUTME: Entry point for the lastfm-mcp-stats Worker, the private usage dashboard at stats.lastfm-mcp.com.
// ABOUTME: Every request passes the Access gate before routing; the hourly cron refreshes the dashboard's cached summaries.
import { requireAccess } from './access'
import { refreshActiveUsers } from './activeUsers'
import { CfApiError } from './cfApi'
import type { DashEnv } from './env'
import { refreshGrantSummary } from './grants'
import { buildDashboardModel } from './model'
import { renderDashboard } from './page'

/** Marks a warm-up refresh as started, so reloads before the first summary exists don't each start another one */
const WARMUP_KEY = 'warmup:grants'
/** A warm-up refresh can run for a while; after this long without a summary, the next page load may start another */
const WARMUP_WINDOW_SECONDS = 600

// The page has no scripts, images or external assets: only its own inline styles may apply
const PAGE_HEADERS = {
	'Content-Type': 'text/html; charset=utf-8',
	'Cache-Control': 'private, no-store',
	'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer',
}

/**
 * Refreshes the grant summary and contains any failure. Only the status is logged: error messages can carry upstream body
 * text or a request URL, and both can hold a grant key, which contains a username.
 */
async function refreshGrantsSafely(env: DashEnv, now: Date): Promise<void> {
	try {
		await refreshGrantSummary(env, now)
	} catch (error) {
		// The previous summary stays in DASH_KV, and index entries written before the failure are kept for the next run
		const status = error instanceof CfApiError ? ` (status ${error.status})` : ''
		console.error(`[STATS] grant summary refresh failed${status}`)
	}
}

/** Refreshes the active-user summary and contains any failure, logging only the status, as for the grant summary */
async function refreshActiveUsersSafely(env: DashEnv, now: Date): Promise<void> {
	try {
		await refreshActiveUsers(env, now)
	} catch (error) {
		// The previous summary stays in DASH_KV, and markers written before the failure count on the next run
		const status = error instanceof CfApiError ? ` (status ${error.status})` : ''
		console.error(`[STATS] active user refresh failed${status}`)
	}
}

/**
 * Runs both hourly refreshes, each failure contained to its own summary. Active users go first: they're the headline
 * numbers, and their few DASH_KV operations are bounded on their own (see MAX_ACTIVE_USER_WRITES_PER_RUN).
 */
async function refreshAll(env: DashEnv, now: Date): Promise<void> {
	await refreshActiveUsersSafely(env, now)
	await refreshGrantsSafely(env, now)
}

/** Starts the summary refreshes after the response, unless one was started within the warm-up window */
async function startWarmup(env: DashEnv, ctx: ExecutionContext): Promise<void> {
	try {
		if (await env.DASH_KV.get(WARMUP_KEY)) return
		await env.DASH_KV.put(WARMUP_KEY, new Date().toISOString(), { expirationTtl: WARMUP_WINDOW_SECONDS })
	} catch {
		// Without the marker, a warm-up still beats an empty page until the hourly cron
	}
	ctx.waitUntil(refreshAll(env, new Date()))
}

export default {
	async fetch(request, env, ctx) {
		const denied = await requireAccess(request, env)
		if (denied) return denied

		const url = new URL(request.url)
		if (request.method === 'GET' && url.pathname === '/') {
			const model = await buildDashboardModel(env)
			if (model.grants === null || model.activeUsers === null) await startWarmup(env, ctx)
			return new Response(renderDashboard(model), { headers: PAGE_HEADERS })
		}
		return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
	},

	async scheduled(controller, env) {
		await refreshAll(env, new Date(controller.scheduledTime))
	},
} satisfies ExportedHandler<DashEnv>
