// ABOUTME: Renders the dashboard page model to one self-contained HTML document: tiles, inline SVG charts and tables.
// ABOUTME: No client-side JS or external assets; every interpolated string is escaped, and failed panels say why.
import type { ActiveUsersSummary } from './activeUsers'
import type { GrantSummary } from './grants'
import { isLoadError, isNotConfigured } from './model'
import type { DashboardModel, LoadError } from './model'
import type { ToolRow, ToolStats } from './tools'
import type { TrafficSummary } from './traffic'

const DASH = '—'
const NO_DATA = 'no data yet'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ---------------------------------------------------------------------------------------------------------------------
// Escaping and number formatting. Every formatter returns DASH for a value that isn't a finite number.
// ---------------------------------------------------------------------------------------------------------------------

/** Escapes text for HTML element content and quoted attribute values */
function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const esc = escapeHtml

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

function formatCount(value: unknown): string {
	return isNumber(value) ? integerFormat.format(value) : DASH
}

/** A ratio as a percentage: two decimals under 1%, one decimal above */
function formatPercent(ratio: unknown): string {
	if (!isNumber(ratio)) return DASH
	const percent = ratio * 100
	if (percent === 0) return '0%'
	if (percent < 0.01) return '<0.01%'
	return `${percent < 1 ? percent.toFixed(2) : percent.toFixed(1)}%`
}

function ratio(part: number, whole: number): number | null {
	return isNumber(part) && isNumber(whole) && whole > 0 ? part / whole : null
}

function formatMs(ms: unknown): string {
	if (!isNumber(ms)) return DASH
	if (ms < 1) return '<1 ms'
	if (ms < 1000) return `${Math.round(ms)} ms`
	return `${(ms / 1000).toFixed(1)} s`
}

/** `2026-11-12 15:30 UTC`, or DASH for a value that isn't a timestamp */
function formatTime(iso: unknown): string {
	if (typeof iso !== 'string') return DASH
	const ms = Date.parse(iso)
	if (!Number.isFinite(ms)) return DASH
	return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** `Nov 12` for a `YYYY-MM-DD` date */
function formatDay(date: string): string {
	const [, month, day] = date.split('-').map(Number)
	return isNumber(month) && isNumber(day) && month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${day}` : date
}

/** True for a `YYYY-MM-DD` string */
function isIsoDate(value: unknown): value is string {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
}

/** The `YYYY-MM-DD` date `days` days after `date` (before, for a negative count) */
function addDays(date: string, days: number): string {
	return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10)
}

/** Axis ticks: in full under 10,000, compact (20K, 1.5M) on an axis that reaches it */
function formatTick(value: number, compact: boolean): string {
	if (!compact) return integerFormat.format(value)
	if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`
	if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}K`
	return String(value)
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------------------------------------------------

function loadErrorNote(reason: string, subject = ''): string {
	return `<p class="load-error"><span class="status-dot" aria-hidden="true"></span>${subject ? `${esc(subject)} ` : ''}couldn't load: ${esc(reason)}</p>`
}

function emptyNote(text: string = NO_DATA): string {
	return `<p class="empty">${esc(text)}</p>`
}

const WARMING_UP = 'warming up: the first grant summary is being computed, so check back in a few minutes'

/** A grant panel's body: the content, a warming-up note before the first summary, or the load error */
function withGrants(grants: DashboardModel['grants'], render: (summary: GrantSummary) => string): string {
	if (grants === null) return emptyNote(WARMING_UP)
	if (isLoadError(grants)) return loadErrorNote(grants.error)
	return render(grants)
}

function table(headers: Array<{ label: string; numeric?: boolean }>, rows: string[][], caption?: string): string {
	const head = headers.map(({ label, numeric }) => `<th scope="col"${numeric ? ' class="num"' : ''}>${esc(label)}</th>`).join('')
	const body = rows
		.map(
			(cells) =>
				`<tr>${cells.map((cell, i) => (headers[i]?.numeric ? `<td class="num">${cell}</td>` : `<td>${cell}</td>`)).join('\n')}</tr>`,
		)
		.join('\n')
	return `<div class="table-wrap"><table>${caption ? `<caption>${esc(caption)}</caption>` : ''}<thead><tr>${head}</tr></thead><tbody>
${body}
</tbody></table></div>`
}

// ---------------------------------------------------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------------------------------------------------

interface Tile {
	label: string
	/** Already formatted; DASH when there's no value */
	value: string
	/** Plain-text note under the value */
	note?: string
	/** Pre-rendered HTML that replaces the note, for load errors */
	noteHtml?: string
}

function renderTile({ label, value, note, noteHtml }: Tile): string {
	const footer = noteHtml ?? (note ? `<p class="tile-note">${esc(note)}</p>` : '')
	return `<div class="tile"><p class="tile-label">${esc(label)}</p><p class="tile-value">${esc(value)}</p>${footer}</div>`
}

/** The tile for a value whose source may be missing or failed */
function sourcedTile<T>(label: string, source: T | LoadError | null, value: (data: T) => string, note?: (data: T) => string): Tile {
	if (source === null) return { label, value: DASH, note: 'warming up' }
	if (isLoadError(source)) return { label, value: DASH, noteHtml: loadErrorNote(source.error) }
	return { label, value: value(source), note: note?.(source) }
}

/** An active-user tile, which also says when counting isn't configured */
function activeTile(
	label: string,
	state: DashboardModel['activeUsers'],
	value: (data: ActiveUsersSummary) => string,
	note: (data: ActiveUsersSummary) => string,
): Tile {
	if (isNotConfigured(state)) return { label, value: DASH, note: 'not configured' }
	return sourcedTile(label, state, value, note)
}

/** The UTC day an active-user summary counts as today, or null if its computedAt isn't a timestamp */
function summaryDay(summary: ActiveUsersSummary): string | null {
	const ms = typeof summary.computedAt === 'string' ? Date.parse(summary.computedAt) : Number.NaN
	return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null
}

/** A window count's note, which says the count is partial until counting covers the whole window */
function windowNote(summary: ActiveUsersSummary, days: number): string {
	const full = `Distinct users, last ${days} UTC days`
	if (summary.activeSince === null) return 'No active users seen yet'
	const today = summaryDay(summary)
	if (!isIsoDate(summary.activeSince) || today === null) return full
	if (summary.activeSince === today) return 'Counting started today'
	if (summary.activeSince > addDays(today, -(days - 1))) return `Partial: since ${formatDay(summary.activeSince)}`
	return full
}

function connectedUsersNote(grants: GrantSummary): string {
	const expiring = isNumber(grants.liveGrants) && isNumber(grants.noExpiryGrants) ? grants.liveGrants - grants.noExpiryGrants : null
	return `${formatCount(expiring)} grants with a 30-day expiry, ${formatCount(grants.noExpiryGrants)} legacy grants with no expiry`
}

function renderTiles(model: DashboardModel): string {
	const tiles: Tile[] = [
		activeTile(
			'Active users today',
			model.activeUsers,
			(a) => formatCount(a.dau),
			(a) => {
				const today = summaryDay(a)
				return today === null ? 'UTC day so far' : `So far on ${formatDay(today)} (UTC)`
			},
		),
		activeTile(
			'Active users, 7 days',
			model.activeUsers,
			(a) => formatCount(a.wau),
			(a) => windowNote(a, 7),
		),
		activeTile(
			'Active users, 30 days',
			model.activeUsers,
			(a) => formatCount(a.mau),
			(a) => windowNote(a, 30),
		),
		sourcedTile('Connected users', model.grants, (g) => formatCount(g.liveUsers), connectedUsersNote),
		sourcedTile(
			'Sign-ins, last 7 days',
			model.grants,
			(g) => formatCount(g.signInsLast7d),
			() => 'Sign-in events, not new users',
		),
		sourcedTile('Requests, last 24 hours', model.traffic, (t) => formatCount(t.last24h.requests)),
		sourcedTile(
			'Error rate, last 24 hours',
			model.traffic,
			(t) => formatPercent(ratio(t.last24h.errors, t.last24h.requests)),
			(t) => `${formatCount(t.last24h.errors)} errors`,
		),
		sourcedTile(
			'Tool calls, last 24 hours',
			model.tools,
			(s) => (s.firstEventAt === null ? DASH : formatCount(s.last24h.reduce((sum, row) => sum + row.calls, 0))),
			(s) => (s.firstEventAt === null ? NO_DATA : `Across ${formatCount(s.last24h.length)} tools`),
		),
	]
	return `<section class="tiles" aria-label="Headline numbers">
${tiles.map(renderTile).join('\n')}
</section>`
}

// ---------------------------------------------------------------------------------------------------------------------
// Column charts: inline SVG laid out in percentages horizontally and pixels vertically, so text never scales with the
// width. The y-axis labels sit in an HTML gutter beside the SVG. Each day has a hit area with a native <title> tooltip.
// ---------------------------------------------------------------------------------------------------------------------

interface ChartSeries {
	name: string
	/** A CSS custom property holding the series colour, e.g. `--series-1` */
	color: string
}

interface ColumnChartOptions {
	label: string
	dates: string[]
	/** Per day, one value per series, stacked bottom to top in series order */
	values: number[][]
	series: ChartSeries[]
	/** Height of the plot area in px, from the top tick to the baseline */
	height: number
	/** How many intervals the y-axis aims for */
	intervals: number
	/** Per day, the tooltip text */
	tooltips: string[]
}

const PLOT_TOP = 8
const X_LABEL_SPACE = 22
const BAR_SHARE = 0.6
const BAR_RADIUS = 3
const STACK_GAP = 2

/** Round tick values from 0 to at least `max`, with a step of 1, 2 or 5 × a power of ten, never below 1 */
function niceTicks(max: number, intervals: number): number[] {
	const top = Math.max(max, 1)
	const raw = top / intervals
	const magnitude = 10 ** Math.floor(Math.log10(raw))
	const step = Math.max(1, ([1, 2, 5, 10].find((m) => m * magnitude >= raw) ?? 10) * magnitude)
	const ticks: number[] = []
	for (let tick = 0; tick < top + step; tick += step) ticks.push(tick)
	return ticks
}

function pct(value: number): string {
	return `${+value.toFixed(3)}%`
}

function columnChart(options: ColumnChartOptions): string {
	const { dates, values, series, height, tooltips } = options
	if (dates.length === 0) return emptyNote()

	const totals = values.map((stack) => stack.reduce((sum, v) => sum + (isNumber(v) ? v : 0), 0))
	const ticks = niceTicks(Math.max(...totals), options.intervals)
	const top = ticks[ticks.length - 1]
	const compact = top >= 10_000
	const baseline = PLOT_TOP + height
	const y = (value: number): number => baseline - (value / top) * height

	const slot = 100 / dates.length
	const barWidth = slot * BAR_SHARE

	const grid = ticks
		.filter((tick) => tick > 0)
		.map((tick) => `<line class="gridline" x1="0" x2="100%" y1="${y(tick)}" y2="${y(tick)}"/>`)
		.join('')
	const yLabels = ticks.map((tick) => `<span style="top:${y(tick)}px">${esc(formatTick(tick, compact))}</span>`).join('')

	const hits: string[] = []
	const bars: string[] = []
	const xLabels: string[] = []
	dates.forEach((date, i) => {
		const slotX = i * slot
		const x = pct(slotX + (slot - barWidth) / 2)
		hits.push(
			`<rect class="hit" x="${pct(slotX)}" y="0" width="${pct(slot)}" height="${baseline}"><title>${esc(tooltips[i] ?? date)}</title></rect>`,
		)

		const stack = values[i] ?? []
		const lastDrawn = stack.reduce((last, v, s) => (isNumber(v) && v > 0 ? s : last), -1)
		let cumulative = 0
		stack.forEach((value, s) => {
			if (!isNumber(value) || value <= 0) return
			const bottom = y(cumulative)
			cumulative += value
			const topY = y(cumulative)
			// A segment above another leaves a surface-coloured gap at its base
			const gap = cumulative > value ? STACK_GAP : 0
			const h = Math.max(1, bottom - topY - gap)
			const fill = `style="fill:var(${series[s].color})"`
			if (s === lastDrawn && h > BAR_RADIUS * 2) {
				// Rounded data end, square at the base: a rounded rect with its lower corners covered by a square one
				bars.push(`<rect x="${x}" y="${topY}" width="${pct(barWidth)}" height="${h}" rx="${BAR_RADIUS}" ${fill}/>`)
				bars.push(`<rect x="${x}" y="${topY + BAR_RADIUS}" width="${pct(barWidth)}" height="${h - BAR_RADIUS}" ${fill}/>`)
			} else {
				bars.push(`<rect x="${x}" y="${topY}" width="${pct(barWidth)}" height="${h}" ${fill}/>`)
			}
		})

		// Label every 7th day, counting back from today; the last label is end-anchored so it stays inside the chart
		if ((dates.length - 1 - i) % 7 === 0) {
			const last = i === dates.length - 1
			const lx = last ? '100%' : pct(slotX + slot / 2)
			xLabels.push(`<text x="${lx}" y="${baseline + 16}" text-anchor="${last ? 'end' : 'middle'}">${esc(formatDay(date))}</text>`)
		}
	})

	const svgHeight = baseline + X_LABEL_SPACE
	return `<div class="chart">
<div class="y-axis" aria-hidden="true" style="height:${svgHeight}px">${yLabels}</div>
<svg class="plot" role="img" aria-label="${esc(options.label)}" width="100%" height="${svgHeight}">
<g class="hits">${hits.join('')}</g>
<g class="grid">${grid}</g>
<g class="bars">${bars.join('')}</g>
<line class="baseline" x1="0" x2="100%" y1="${baseline}" y2="${baseline}"/>
<g class="x-labels" aria-hidden="true">${xLabels.join('')}</g>
</svg>
</div>`
}

function legend(series: ChartSeries[]): string {
	const items = series.map(({ name, color }) => `<li><span class="swatch" style="background:var(${color})"></span>${esc(name)}</li>`)
	return `<ul class="legend">${items.join('')}</ul>`
}

function tableView(headers: Array<{ label: string; numeric?: boolean }>, rows: string[][]): string {
	return `<details class="table-view"><summary>Show as table</summary>${table(headers, rows)}</details>`
}

// ---------------------------------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------------------------------

const ACTIVE_WARMING_UP = 'warming up: the first active-user count is being computed, so check back in a few minutes'
const ACTIVE_NOT_CONFIGURED = 'Not configured: set the ACTIVE_USER_HMAC_KEY secret to start counting.'

function renderActiveUsersSection(state: DashboardModel['activeUsers']): string {
	let body: string
	if (isNotConfigured(state)) body = emptyNote(ACTIVE_NOT_CONFIGURED)
	else if (state === null) body = emptyNote(ACTIVE_WARMING_UP)
	else if (isLoadError(state)) body = loadErrorNote(state.error)
	else if (state.activeByDay.length === 0) body = emptyNote()
	else {
		const days = state.activeByDay
		const since = state.activeSince
		const partial =
			isIsoDate(since) && since > days[0].date
				? `<p class="caption">Counting started ${esc(formatDay(since))}; earlier days have no data.</p>\n`
				: ''
		body = `${partial}${columnChart({
			label: 'Daily active users over the last 30 days',
			dates: days.map((day) => day.date),
			values: days.map((day) => [day.count]),
			series: [{ name: 'Active users', color: '--series-active' }],
			height: 120,
			intervals: 3,
			tooltips: days.map((day) => `${formatDay(day.date)}: ${formatCount(day.count)} active users`),
		})}
${tableView(
	[{ label: 'Date' }, { label: 'Active users', numeric: true }],
	days.map((day) => [esc(day.date), formatCount(day.count)]),
)}`
	}
	return `<section class="panel"><h2>Active users, last 30 days</h2>
<p class="caption">Distinct users whose AI client held a live access token at any hourly check that UTC day.</p>
${body}
</section>`
}

const REQUEST_SERIES: ChartSeries[] = [
	{ name: 'Served', color: '--series-1' },
	{ name: 'Closed by client', color: '--series-2' },
]

function renderTrafficSection(traffic: TrafficSummary | LoadError): string {
	let body: string
	if (isLoadError(traffic)) {
		body = loadErrorNote(traffic.error)
	} else {
		const days = traffic.days
		const dates = days.map((day) => day.date)
		const tooltips = days.map(
			(day) =>
				`${formatDay(day.date)}: ${formatCount(day.requests)} requests (${formatCount(day.disconnected)} closed by client), ${formatCount(day.errors)} errors`,
		)
		body = `${legend(REQUEST_SERIES)}
<p class="caption">Closed by client means the client hung up before the response finished. Most are MCP session streams held open for minutes or hours and dropped when a session ends, so they aren't errors.</p>
${columnChart({
	label: 'Daily requests over the last 30 days, split into served and closed by the client',
	dates,
	values: days.map((day) => [Math.max(0, day.requests - day.disconnected), day.disconnected]),
	series: REQUEST_SERIES,
	height: 180,
	intervals: 4,
	tooltips,
})}
<h3 class="chart-title">Errors</h3>
${columnChart({
	label: 'Daily errors over the last 30 days',
	dates,
	values: days.map((day) => [day.errors]),
	series: [{ name: 'Errors', color: '--series-errors' }],
	height: 72,
	intervals: 2,
	tooltips,
})}
${tableView(
	[
		{ label: 'Date' },
		{ label: 'Requests', numeric: true },
		{ label: 'Closed by client', numeric: true },
		{ label: 'Errors', numeric: true },
	],
	days.map((day) => [esc(day.date), formatCount(day.requests), formatCount(day.disconnected), formatCount(day.errors)]),
)}`
	}
	return `<section class="panel"><h2>Requests, last 30 days</h2>
${body}
</section>`
}

function renderSignInsSection(grants: DashboardModel['grants']): string {
	const body = withGrants(grants, (summary) => {
		const days = summary.signInsByDay
		if (days.length === 0) return emptyNote()
		return `${columnChart({
			label: 'Daily sign-ins over the last 30 days',
			dates: days.map((day) => day.date),
			values: days.map((day) => [day.count]),
			series: [{ name: 'Sign-ins', color: '--series-signins' }],
			height: 120,
			intervals: 3,
			tooltips: days.map((day) => `${formatDay(day.date)}: ${formatCount(day.count)} sign-ins`),
		})}
${tableView(
	[{ label: 'Date' }, { label: 'Sign-ins', numeric: true }],
	days.map((day) => [esc(day.date), formatCount(day.count)]),
)}`
	})
	return `<section class="panel"><h2>Sign-ins, last 30 days</h2>
<p class="caption">Sign-in events from grant creation times, including grants a later sign-in replaced. Everyone signs in again when their 30-day grant expires. Sign-ins are seen hourly; a grant created and replaced within the same hour isn't counted.</p>
${body}
</section>`
}

function renderClientsSection(model: DashboardModel): string {
	const { grants, tools } = model
	const notes: string[] = []
	if (grants === null) notes.push(emptyNote(`Live grants are ${WARMING_UP}`))
	else if (isLoadError(grants)) notes.push(loadErrorNote(grants.error, 'Live grants'))
	if (isLoadError(tools)) notes.push(loadErrorNote(tools.error, 'Tool calls'))

	const grantClients = grants && !isLoadError(grants) ? grants.clients : []
	const toolsReady = !isLoadError(tools) && tools.firstEventAt !== null
	const callsByLabel = new Map(isLoadError(tools) ? [] : tools.clients7d.map(({ label, calls }) => [label, calls]))
	const calls = (label: string): string => (toolsReady ? formatCount(callsByLabel.get(label) ?? 0) : DASH)

	const rows = grantClients.map(({ label, users, grants: count }) => [esc(label), formatCount(users), formatCount(count), calls(label)])
	const withGrant = new Set(grantClients.map(({ label }) => label))
	for (const [label] of callsByLabel) if (!withGrant.has(label)) rows.push([esc(label), DASH, DASH, calls(label)])

	const body =
		rows.length > 0
			? table(
					[
						{ label: 'Client' },
						{ label: 'Users', numeric: true },
						{ label: 'Live grants', numeric: true },
						{ label: 'Tool calls, 7\u00a0days', numeric: true },
					],
					rows,
				)
			: notes.length === 0
				? emptyNote()
				: ''
	return `<section class="panel"><h2>Clients</h2>
<p class="caption">Labelled from a fixed list of known apps. Any other app shows as "other"; "unknown" is an app with no name, or one whose label a later hourly refresh will read.</p>
${notes.join('\n')}
${body}
</section>`
}

function toolTable(rows: ToolRow[], windowLabel: string, stats: ToolStats): string {
	if (rows.length === 0) return emptyNote(stats.firstEventAt === null ? NO_DATA : `No tool calls in the ${windowLabel}.`)
	return table(
		[
			{ label: 'Tool' },
			{ label: 'Calls', numeric: true },
			{ label: 'Error %', numeric: true },
			{ label: 'Auth required', numeric: true },
			{ label: 'p50', numeric: true },
			{ label: 'p95', numeric: true },
			{ label: 'Cache hit %', numeric: true },
		],
		rows.map((row) => [
			esc(row.tool),
			formatCount(row.calls),
			formatPercent(ratio(row.errors, row.calls)),
			formatCount(row.authRequired),
			formatMs(row.p50Ms),
			formatMs(row.p95Ms),
			formatPercent(row.cacheHitRate),
		]),
	)
}

function renderToolsSection(tools: ToolStats | LoadError): string {
	const body = isLoadError(tools)
		? loadErrorNote(tools.error)
		: `<details class="window" open>
<summary>Last 24 hours</summary>
${toolTable(tools.last24h, 'last 24 hours', tools)}
</details>
<details class="window">
<summary>Last 7 days</summary>
${toolTable(tools.last7d, 'last 7 days', tools)}
</details>`
	return `<section class="panel"><h2>Tools</h2>
<p class="caption">Error % is tool calls that returned an error. Auth required is calls refused because sign-in hadn't finished. Cache hit % shows ${DASH} for tools that don't use the cache.</p>
${body}
</section>`
}

function renderHygieneSection(grants: DashboardModel['grants']): string {
	const body = withGrants(grants, (summary) => {
		// An older stored summary can lack a count; it draws as an empty bar and prints DASH
		const length = (value: unknown): number => (isNumber(value) ? Math.max(0, value) : 0)
		const max = Math.max(length(summary.registeredClients), length(summary.liveGrants), 1)
		const bar = (label: string, value: number): string =>
			`<div class="compare-row"><span class="compare-label">${esc(label)}</span><span class="bar-track"><span class="bar-fill" style="width:${pct(
				(length(value) / max) * 100,
			)}"></span></span><span class="compare-value">${formatCount(value)}</span></div>`
		const perGrant = ratio(summary.registeredClients, summary.liveGrants)
		const gap =
			perGrant === null
				? 'No live grants yet.'
				: `${perGrant.toFixed(1)} registered clients per live grant. A wide gap can mean clients register again every time they connect instead of reusing their registration.`
		const stats: Array<[string, number, string]> = [
			['Pending grants', summary.pendingGrants, 'Authorization codes that were never exchanged'],
			['Grants with no expiry', summary.noExpiryGrants, 'Written by the 0.x OAuth provider'],
			['Unresolved grants', summary.unresolvedGrants, 'Not read yet; a later hourly run reads them'],
		]
		return `<div class="compare">
${bar('Registered clients', summary.registeredClients)}
${bar('Live grants', summary.liveGrants)}
</div>
<p>${esc(gap)}</p>
<dl class="mini-stats">
${stats.map(([label, value, note]) => `<div><dt>${esc(label)}</dt><dd><span class="mini-value">${formatCount(value)}</span> <span class="mini-note">${esc(note)}</span></dd></div>`).join('\n')}
</dl>`
	})
	return `<section class="panel"><h2>OAuth hygiene</h2>
${body}
</section>`
}

const ACTIVE_NOTE = 'Active users count anyone whose AI client held a live access token during an hourly check'
const ACTIVE_STORAGE_NOTE = 'Stored as keyed hashes, deleted after 31 days.'

function activeUsersNote(state: DashboardModel['activeUsers']): string {
	if (isNotConfigured(state)) return `<p>${esc("Active users aren't counted: the ACTIVE_USER_HMAC_KEY secret isn't set.")}</p>`
	if (isLoadError(state)) return loadErrorNote(state.error, 'Active-user summary')
	let counted = '.'
	if (state !== null && state.activeSince === null) counted = '. None recorded yet.'
	else if (state !== null && isIsoDate(state.activeSince)) {
		counted = `, counted from ${state.activeSince === summaryDay(state) ? 'today' : formatDay(state.activeSince)}.`
	}
	return `<p>${esc(`${ACTIVE_NOTE}${counted} ${ACTIVE_STORAGE_NOTE}`)}</p>`
}

function renderNotes(model: DashboardModel): string {
	const { tools, grants } = model
	const tracking = isLoadError(tools)
		? loadErrorNote(tools.error, 'Oldest retained tool event')
		: `<p>${tools.firstEventAt === null ? 'No tool events yet.' : `Oldest retained tool event: ${esc(formatTime(tools.firstEventAt))}.`}</p>`
	const computed =
		grants && !isLoadError(grants) ? ` Grant summary computed ${esc(formatTime(grants.computedAt))}; it refreshes hourly.` : ''
	return `<footer class="panel notes"><h2>Notes</h2>
${activeUsersNote(model.activeUsers)}
${tracking}
<p>Errors are requests that threw an uncaught exception or hit a Workers limit such as CPU or memory. Requests closed by the client aren't errors; tool failures are in the Tools table.</p>
<p>Traffic comes from the Analytics SQL API (beta). Traffic and tool numbers are cached for up to 5 minutes.</p>
<p>Page generated ${esc(formatTime(model.generatedAt))}.${computed}</p>
</footer>`
}

// ---------------------------------------------------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------------------------------------------------

// Colours follow the dataviz reference palette: categorical slots 1 and 2 for the stacked requests chart (validated as an
// adjacent pair in both modes), red for errors, violet for sign-ins and aqua for active users as single-series charts.
// Light aqua sits under 3:1 on the light surface, so its chart keeps a table view.
const LIGHT_TOKENS = `
	color-scheme: light;
	--page: #f9f9f7;
	--surface: #fcfcfb;
	--ink: #0b0b0b;
	--ink-2: #52514e;
	--muted: #898781;
	--grid: #e1e0d9;
	--axis: #c3c2b7;
	--border: rgba(11, 11, 11, 0.1);
	--hover: rgba(11, 11, 11, 0.05);
	--series-1: #2a78d6;
	--series-2: #b4b2a9;
	--series-errors: #e34948;
	--series-signins: #6250d6;
	--series-active: #1baf7a;
	--critical: #d03b3b;`

const DARK_TOKENS = `
	color-scheme: dark;
	--page: #0d0d0d;
	--surface: #1a1a19;
	--ink: #f0efec;
	--ink-2: #c3c2b7;
	--muted: #898781;
	--grid: #2c2c2a;
	--axis: #383835;
	--border: rgba(255, 255, 255, 0.1);
	--hover: rgba(255, 255, 255, 0.06);
	--series-1: #3987e5;
	--series-2: #6b6a64;
	--series-errors: #e66767;
	--series-signins: #9085e9;
	--series-active: #199e70;
	--critical: #d03b3b;`

const STYLES = `
:root {${LIGHT_TOKENS}
}
@media (prefers-color-scheme: dark) {
	:root:not([data-theme="light"]) {${DARK_TOKENS}
	}
}
:root[data-theme="dark"] {${DARK_TOKENS}
}
* { box-sizing: border-box; }
html { overflow-x: clip; }
body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 48px; display: grid; gap: 16px; }
header h1 { margin: 0; font-size: 22px; font-weight: 600; }
header p { margin: 4px 0 0; color: var(--ink-2); }
h2 { margin: 0 0 8px; font-size: 17px; font-weight: 600; }
.chart-title { margin: 20px 0 4px; font-size: 14px; font-weight: 600; color: var(--ink-2); }
p { margin: 8px 0; }
.caption { margin-top: 0; color: var(--ink-2); font-size: 14px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; min-width: 0; }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; min-width: 0; }
.tile p { margin: 0; }
.tile-label { color: var(--ink-2); font-size: 13px; }
.tile-value { font-size: 30px; font-weight: 600; line-height: 1.25; margin-top: 4px; }
.tile-note { color: var(--ink-2); font-size: 13px; margin-top: 2px; }
.tile .load-error { font-size: 13px; margin-top: 2px; }
.load-error { color: var(--ink); }
.status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--critical); margin-right: 6px; vertical-align: 1px; }
.empty { color: var(--ink-2); font-style: italic; }
.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0 0 8px; padding: 0; color: var(--ink-2); font-size: 13px; }
.legend li { display: flex; align-items: center; gap: 6px; }
.swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.chart { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 8px; }
.y-axis { position: relative; }
.y-axis span { position: absolute; right: 0; transform: translateY(-50%); color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; line-height: 1; }
.plot { display: block; overflow: visible; }
.plot .gridline { stroke: var(--grid); stroke-width: 1; }
.plot .baseline { stroke: var(--axis); stroke-width: 1; }
.plot .bars rect { pointer-events: none; }
.plot .hit { fill: transparent; }
.plot .hit:hover { fill: var(--hover); }
.plot .x-labels text { fill: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
details > summary { cursor: pointer; font-weight: 600; font-size: 14px; padding: 4px 0; }
.table-view { margin-top: 12px; }
.table-view > summary { font-weight: 500; color: var(--ink-2); }
details.window + details.window { margin-top: 8px; }
.table-wrap { overflow-x: auto; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 6px 12px 6px 0; border-bottom: 1px solid var(--grid); white-space: nowrap; }
th { color: var(--ink-2); font-weight: 500; white-space: normal; vertical-align: bottom; }
/* Client labels wrap at spaces; tool names have none, so they stay whole and the table scrolls instead */
td:first-child { white-space: normal; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
th:last-child, td:last-child { padding-right: 0; }
caption { text-align: left; color: var(--ink-2); }
.compare { display: grid; gap: 8px; margin: 4px 0 12px; }
.compare-row { display: grid; grid-template-columns: 9.5em minmax(0, 1fr) 4.5em; align-items: center; gap: 12px; font-size: 14px; }
.compare-label { color: var(--ink-2); }
.bar-track { height: 12px; }
.bar-fill { display: block; height: 100%; min-width: 2px; background: var(--series-1); border-radius: 0 4px 4px 0; }
.compare-value { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.mini-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 12px 0 0; }
.mini-stats dt { color: var(--ink-2); font-size: 13px; }
.mini-stats dd { margin: 0; }
.mini-value { font-size: 20px; font-weight: 600; }
.mini-note { display: block; color: var(--ink-2); font-size: 13px; }
.notes p { color: var(--ink-2); font-size: 14px; margin: 4px 0; }
@media (max-width: 720px) {
	.tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 520px) {
	main { padding-top: 16px; }
	table { font-size: 13px; }
	th, td { padding-right: 8px; }
	.panel { padding: 16px; }
	.tile-value { font-size: 24px; }
	.compare-row { grid-template-columns: 7.5em minmax(0, 1fr) 3.5em; gap: 8px; }
}
`

/** Renders the whole dashboard page */
export function renderDashboard(model: DashboardModel): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>lastfm-mcp usage</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<header>
<h1>lastfm-mcp usage</h1>
<p>Production, as of ${esc(formatTime(model.generatedAt))}</p>
</header>
${renderTiles(model)}
${renderActiveUsersSection(model.activeUsers)}
${renderTrafficSection(model.traffic)}
${renderSignInsSection(model.grants)}
${renderClientsSection(model)}
${renderToolsSection(model.tools)}
${renderHygieneSection(model.grants)}
${renderNotes(model)}
</main>
</body>
</html>
`
}
