// ABOUTME: Tests the dashboard page's server-side HTML: section order, escaping, per-panel failures and empty-data states.
// ABOUTME: Renders fixture models and inspects the HTML string; no Worker, network or KV is involved.
import { describe, expect, it } from 'vitest'

import type { DashboardModel } from '../src/model'
import { renderDashboard } from '../src/page'
import type { ToolStats } from '../src/tools'
import type { TrafficSummary } from '../src/traffic'
import type { ActiveUsersSummary } from '../src/activeUsers'
import { fixtureActiveUsers, fixtureDates, fixtureGrants, fixtureModel, fixtureTools } from './fixtures/model'

const EMPTY_TOOLS: ToolStats = { firstEventAt: null, last24h: [], last7d: [], clients7d: [] }

function zeroTraffic(): TrafficSummary {
	return { days: fixtureDates().map((date) => ({ date, requests: 0, errors: 0, disconnected: 0 })), last24h: { requests: 0, errors: 0 } }
}

function activeUsers(fields: Partial<ActiveUsersSummary>): ActiveUsersSummary {
	return { ...fixtureActiveUsers(), ...fields }
}

/** The text of the tile labelled `label`: its value and note */
function tileText(html: string, label: string): string {
	const match = new RegExp(`<div class="tile"><p class="tile-label">${label}</p>(.*?)</div>`).exec(html)
	return match
		? match[1]
				.replace(/<[^>]+>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
		: ''
}

function expectNoBrokenNumbers(html: string): void {
	expect(html).not.toMatch(/NaN|Infinity|undefined|null/)
}

describe('renderDashboard', () => {
	it('should render the sections in the spec order', () => {
		const html = renderDashboard(fixtureModel())

		const headings = [
			'Active users, last 30 days',
			'Requests, last 30 days',
			'Sign-ins, last 30 days',
			'Clients',
			'Tools',
			'OAuth hygiene',
			'Notes',
		]
		const positions = headings.map((heading) => html.indexOf(`>${heading}</h2>`))
		expect(positions.every((position) => position > 0)).toBe(true)
		expect([...positions].sort((a, b) => a - b)).toEqual(positions)
		expect(html.indexOf('class="tiles"')).toBeLessThan(positions[0])
	})

	it('should lead with active users, then connected users, sign-ins, requests, error rate and tool calls', () => {
		const html = renderDashboard(fixtureModel())

		const labels = [...html.matchAll(/<p class="tile-label">([^<]+)<\/p>/g)].map(([, label]) => label)
		expect(labels).toEqual([
			'Active users today',
			'Active users, 7 days',
			'Active users, 30 days',
			'Connected users',
			'Sign-ins, last 7 days',
			'Requests, last 24 hours',
			'Error rate, last 24 hours',
			'Tool calls, last 24 hours',
		])
		expect(tileText(html, 'Active users today')).toBe('138 So far on Nov 12 (UTC)')
		expect(tileText(html, 'Active users, 7 days')).toBe('291 Distinct users, last 7 UTC days')
		expect(tileText(html, 'Active users, 30 days')).toBe('447 Distinct users, last 30 UTC days')
		expect(tileText(html, 'Connected users')).toBe('512 893 grants with a 30-day expiry, 31 legacy grants with no expiry')
		expect(html).toContain('Sign-ins, last 7 days')
		expect(html).toContain('>141<')
		expect(html).toContain('Requests, last 24 hours')
		expect(html).toContain('>44,812<')
		expect(html).toContain('Error rate, last 24 hours')
		expect(html).toContain('>0.02%<')
		expect(html).toContain('Tool calls, last 24 hours')
		expect(html).toContain('>4,608<')
	})

	it('should HTML-escape an attacker-chosen client label everywhere it appears', () => {
		const model = fixtureModel()
		const label = '<script>alert(1)</script>'
		model.grants = { ...fixtureGrants(), clients: [{ label, grants: 1, users: 1 }] }
		model.tools = {
			...fixtureTools(),
			clients7d: [
				{ label, calls: 3 },
				{ label: '"><img src=x onerror=alert(1)>', calls: 1 },
			],
		}

		const html = renderDashboard(model)

		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
		expect(html).not.toContain('<script')
		expect(html).not.toContain('<img')
		expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;')
	})

	it('should show a failed tools load as couldn’t load and still render the grant tiles and charts', () => {
		const html = renderDashboard({ ...fixtureModel(), tools: { error: 'CfApiError 403' } })

		expect(html).toContain("couldn't load: CfApiError 403")
		expect(html).toContain('Connected users')
		expect(html).toContain('>512<')
		expect(html).toContain('>44,812<')
		expect(html).toContain('Sign-ins, last 30 days')
		expectNoBrokenNumbers(html)
	})

	it('should show a failed traffic load in its tiles and chart, and keep the other panels', () => {
		const html = renderDashboard({ ...fixtureModel(), traffic: { error: 'HTTP 429' } })

		expect(html.match(/couldn't load: HTTP 429/g)?.length).toBeGreaterThanOrEqual(2)
		expect(html).toContain('get_recent_tracks')
		expect(html).toContain('>512<')
		expectNoBrokenNumbers(html)
	})

	it('should show a failed grant summary read in the grant panels', () => {
		const html = renderDashboard({ ...fixtureModel(), grants: { error: 'unexpected error' } })

		expect(html.match(/couldn't load: unexpected error/g)?.length).toBeGreaterThanOrEqual(3)
		expect(html).toContain('>44,812<')
		expectNoBrokenNumbers(html)
	})

	it('should say the grant summary is warming up before the first cron run', () => {
		const html = renderDashboard({ ...fixtureModel(), grants: null })

		expect(html).toContain('warming up')
		expect(html).toContain('>44,812<')
		expectNoBrokenNumbers(html)
	})

	it('should never print NaN, Infinity or undefined with no tool data and a tool with no cache lookups', () => {
		const empty = renderDashboard({ ...fixtureModel(), tools: EMPTY_TOOLS, traffic: zeroTraffic() })
		expect(empty).toContain('no data yet')
		expect(empty).toContain('No tool events yet')
		expectNoBrokenNumbers(empty)

		const zeroLookups: ToolStats = {
			firstEventAt: '2026-11-12T10:00:00.000Z',
			last24h: [{ tool: 'ping', calls: 1, errors: 0, authRequired: 0, p50Ms: null, p95Ms: null, cacheHitRate: null }],
			last7d: [{ tool: 'ping', calls: 0, errors: 0, authRequired: 0, p50Ms: null, p95Ms: null, cacheHitRate: null }],
			clients7d: [],
		}
		const html = renderDashboard({ ...fixtureModel(), tools: zeroLookups })
		expect(html).toContain('>ping<')
		expect(html).toContain('>—<')
		expectNoBrokenNumbers(html)
	})

	it('should never print NaN or Infinity for an empty grant summary', () => {
		const grants = { ...fixtureGrants(), liveGrants: 0, liveUsers: 0, registeredClients: 0, clients: [], signInsByDay: [] }

		const html = renderDashboard({ ...fixtureModel(), grants })

		expectNoBrokenNumbers(html)
	})

	it('should offer the tools table for 24 hours (open) and 7 days through two details blocks', () => {
		const html = renderDashboard(fixtureModel())

		expect(html).toMatch(/<details class="window" open>\s*<summary>Last 24 hours<\/summary>/)
		expect(html).toMatch(/<details class="window">\s*<summary>Last 7 days<\/summary>/)
		for (const column of ['Calls', 'Error %', 'Auth required', 'p50', 'p95', 'Cache hit %']) expect(html).toContain(`>${column}</th>`)
		expect(html).toContain('get_artist_info')
	})

	it('should merge grant clients with their 7-day tool calls in the clients table', () => {
		const html = renderDashboard(fixtureModel())

		expect(html).toMatch(/<td>Claude<\/td>\s*<td class="num">344<\/td>\s*<td class="num">521<\/td>\s*<td class="num">17,840<\/td>/)
		// A label with tool calls but no live grant still gets a row
		expect(html).toMatch(/<td>Goose<\/td>\s*<td class="num">—<\/td>\s*<td class="num">—<\/td>\s*<td class="num">512<\/td>/)
	})

	it('should say client labels come from a fixed list of known apps, with everything else shown as other', () => {
		const html = renderDashboard(fixtureModel())

		expect(html).toContain(
			'<p class="caption">Labelled from a fixed list of known apps. Any other app shows as "other"; "unknown" is an app with no name, or one whose label a later hourly refresh will read.</p>',
		)
		expect(html).not.toContain('registered name')
		expect(html).not.toContain('metadata URL')
	})

	it('should compare registered clients with live grants in the hygiene section', () => {
		const html = renderDashboard(fixtureModel())

		expect(html).toContain('4,706')
		expect(html).toContain('924')
		expect(html).toContain('5.1 registered clients per live grant')
		expect(html).toContain('Pending grants')
		expect(html).toContain('Grants with no expiry')
		expect(html).toContain('Unresolved grants')
	})

	it('should no longer call connected users roughly monthly active, and say sign-ins are seen hourly', () => {
		const html = renderDashboard(fixtureModel())

		expect(html).not.toContain('Roughly monthly active')
		expect(html).toContain("Sign-ins are seen hourly; a grant created and replaced within the same hour isn't counted.")
	})

	it('should carry the footer notes, without the retired session_id note', () => {
		const html = renderDashboard(fixtureModel())

		expect(html).toContain('Oldest retained tool event: 2026-11-10 08:15 UTC')
		expect(html).not.toContain('Tool tracking started')
		expect(html).toContain('Error rate counts uncaught exceptions; tool failures are in the Tools table.')
		expect(html).toContain('Page generated 2026-11-12 15:30 UTC')
		expect(html).toContain('Grant summary computed 2026-11-12 15:17 UTC')
		expect(html).not.toContain('session_id')
	})

	it('should be a complete document with theme tokens, a dark-mode override and no scripts', () => {
		const html = renderDashboard(fixtureModel())

		expect(html).toMatch(/^<!doctype html>/)
		expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
		expect(html).toContain(':root {')
		expect(html).toContain('@media (prefers-color-scheme: dark)')
		expect(html).not.toMatch(/<script|<link|@import|https?:\/\//)
	})

	it('should give each chart an accessible name and a table view', () => {
		const html = renderDashboard(fixtureModel())

		expect(html.match(/<svg[^>]*role="img"[^>]*aria-label="[^"]+"/g)?.length).toBe(4)
		expect(html.match(/<summary>Show as table<\/summary>/g)?.length).toBe(3)
	})
})

describe('renderDashboard active users', () => {
	const NOTE_START = 'Active users count anyone whose AI client held a live access token during an hourly check'

	it('should chart active users per day with a table view, in its own series colour in both themes', () => {
		const html = renderDashboard(fixtureModel())

		expect(html).toMatch(/<svg[^>]*aria-label="Daily active users over the last 30 days"/)
		expect(html).toContain('fill:var(--series-active)')
		expect(html.match(/--series-active: #[0-9a-f]{6};/g)?.length).toBe(3)
		expect(html).toContain('>Active users</th>')
		expect(html).toContain('Nov 12: 127 active users')
		expect(html).not.toContain('Counting started')
	})

	it('should carry the footer note, counted from the first day with data', () => {
		const html = renderDashboard(fixtureModel())

		expect(html).toContain(`<p>${NOTE_START}, counted from Oct 8. Stored as keyed hashes, deleted after 31 days.</p>`)
	})

	it('should label the 7-day and 30-day counts partial until counting covers their windows', () => {
		const model = fixtureModel()

		model.activeUsers = activeUsers({ activeSince: '2026-11-09' })
		let html = renderDashboard(model)
		expect(tileText(html, 'Active users, 7 days')).toBe('291 Partial: since Nov 9')
		expect(tileText(html, 'Active users, 30 days')).toBe('447 Partial: since Nov 9')
		expect(html).toContain('Counting started Nov 9; earlier days have no data.')

		// Nov 6 is the first day of the 7-day window ending Nov 12
		model.activeUsers = activeUsers({ activeSince: '2026-11-06' })
		html = renderDashboard(model)
		expect(tileText(html, 'Active users, 7 days')).toBe('291 Distinct users, last 7 UTC days')
		expect(tileText(html, 'Active users, 30 days')).toBe('447 Partial: since Nov 6')

		// Oct 14 is the first day of the 30-day window
		model.activeUsers = activeUsers({ activeSince: '2026-10-14' })
		html = renderDashboard(model)
		expect(tileText(html, 'Active users, 30 days')).toBe('447 Distinct users, last 30 UTC days')
		expect(html).not.toContain('Counting started')
	})

	it('should say counting started today on the first day', () => {
		const html = renderDashboard({ ...fixtureModel(), activeUsers: activeUsers({ dau: 12, wau: 12, mau: 12, activeSince: '2026-11-12' }) })

		expect(tileText(html, 'Active users today')).toBe('12 So far on Nov 12 (UTC)')
		expect(tileText(html, 'Active users, 7 days')).toBe('12 Counting started today')
		expect(tileText(html, 'Active users, 30 days')).toBe('12 Counting started today')
		expect(html).toContain(`<p>${NOTE_START}, counted from today. Stored as keyed hashes, deleted after 31 days.</p>`)
		expectNoBrokenNumbers(html)
	})

	it('should show zeros and say nobody has been seen before the first active user', () => {
		const summary = activeUsers({
			dau: 0,
			wau: 0,
			mau: 0,
			activeSince: null,
			activeByDay: fixtureDates().map((date) => ({ date, count: 0 })),
		})

		const html = renderDashboard({ ...fixtureModel(), activeUsers: summary })

		expect(tileText(html, 'Active users today')).toBe('0 So far on Nov 12 (UTC)')
		expect(tileText(html, 'Active users, 7 days')).toBe('0 No active users seen yet')
		expect(tileText(html, 'Active users, 30 days')).toBe('0 No active users seen yet')
		expect(html).toContain(`<p>${NOTE_START}. None recorded yet. Stored as keyed hashes, deleted after 31 days.</p>`)
		expectNoBrokenNumbers(html)
	})

	it('should say active users are not configured while the HMAC key is missing', () => {
		const html = renderDashboard({ ...fixtureModel(), activeUsers: { notConfigured: true } })

		for (const label of ['Active users today', 'Active users, 7 days', 'Active users, 30 days']) {
			expect(tileText(html, label)).toBe('— not configured')
		}
		expect(html).toContain('Not configured: set the ACTIVE_USER_HMAC_KEY secret to start counting.')
		expect(html).toContain('<p>Active users aren&#39;t counted: the ACTIVE_USER_HMAC_KEY secret isn&#39;t set.</p>')
		expect(html).not.toContain('Daily active users over the last 30 days')
		expect(tileText(html, 'Connected users')).toContain('512')
		expectNoBrokenNumbers(html)
	})

	it('should say active users are warming up before the first run, and show a failed read', () => {
		const warming = renderDashboard({ ...fixtureModel(), activeUsers: null })
		expect(tileText(warming, 'Active users today')).toBe('— warming up')
		expect(warming).toContain('warming up: the first active-user count is being computed, so check back in a few minutes')
		expectNoBrokenNumbers(warming)

		const failed = renderDashboard({ ...fixtureModel(), activeUsers: { error: 'HTTP 500' } })
		expect(failed.match(/couldn't load: HTTP 500/g)?.length).toBeGreaterThanOrEqual(4)
		expect(failed).toContain('>512<')
		expectNoBrokenNumbers(failed)
	})

	it('should escape a stored start date and never print NaN for broken counts', () => {
		const summary = {
			...activeUsers({ activeByDay: [], activeSince: '<b>x</b>' }),
			dau: Number.NaN,
			wau: Number.POSITIVE_INFINITY,
			mau: undefined as unknown as number,
		}

		const html = renderDashboard({ ...fixtureModel(), activeUsers: summary })

		expect(html).not.toContain('<b>')
		expect(tileText(html, 'Active users today')).toBe('— So far on Nov 12 (UTC)')
		expect(tileText(html, 'Active users, 7 days')).toBe('— Distinct users, last 7 UTC days')
		expect(html).toContain('no data yet')
		expectNoBrokenNumbers(html)
	})

	it('should not print NaN in the connected-users note for a summary missing its counts', () => {
		const grants = { ...fixtureGrants(), liveGrants: undefined as unknown as number }

		const html = renderDashboard({ ...fixtureModel(), grants })

		expect(tileText(html, 'Connected users')).toBe('512 — grants with a 30-day expiry, 31 legacy grants with no expiry')
	})
})
