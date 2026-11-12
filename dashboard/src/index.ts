// ABOUTME: Entry point for the lastfm-mcp-stats Worker, the private usage dashboard at stats.lastfm-mcp.com.
// ABOUTME: Every request passes the Access gate before routing; the hourly cron refreshes the dashboard's cached summaries.
import { requireAccess } from './access'
import type { DashEnv } from './env'

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

	async scheduled(_controller, _env, _ctx) {
		// Task 7 wires refreshGrantSummary in here.
	},
} satisfies ExportedHandler<DashEnv>
