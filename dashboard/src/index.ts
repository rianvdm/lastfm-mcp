// ABOUTME: Entry point for the lastfm-mcp-stats Worker, the private usage dashboard at stats.lastfm-mcp.com.
// ABOUTME: Every request passes the Access gate before routing; the hourly cron refreshes the dashboard's cached summaries.
import { requireAccess } from './access'
import type { DashEnv } from './env'
import { refreshGrantSummary } from './grants'

const STUB_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>lastfm-mcp usage</title>
</head>
<body>
<h1>lastfm-mcp usage</h1>
<p>The dashboard isn't built yet.</p>
</body>
</html>
`

export default {
	async fetch(request, env) {
		const denied = await requireAccess(request, env)
		if (denied) return denied

		const url = new URL(request.url)
		if (request.method === 'GET' && url.pathname === '/') {
			return new Response(STUB_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } })
		}
		return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
	},

	async scheduled(controller, env) {
		try {
			await refreshGrantSummary(env, new Date(controller.scheduledTime))
		} catch (error) {
			// The previous summary stays in DASH_KV, and index entries written before the failure are kept for the next run
			console.error(`[STATS] grant summary refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
		}
	},
} satisfies ExportedHandler<DashEnv>
