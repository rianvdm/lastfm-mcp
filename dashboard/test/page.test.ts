// ABOUTME: Tests the dashboard page's server-side HTML: section order, escaping, per-panel failures and empty-data states.
// ABOUTME: Renders fixture models and inspects the HTML string; no Worker, network or KV is involved.
import { describe, expect, it } from 'vitest'

import type { DashboardModel } from '../src/model'
import { renderDashboard } from '../src/page'
import type { ToolStats } from '../src/tools'
import type { TrafficSummary } from '../src/traffic'
import { fixtureDates, fixtureGrants, fixtureModel, fixtureTools } from './fixtures/model'

const EMPTY_TOOLS: ToolStats = { firstEventAt: null, last24h: [], last7d: [], clients7d: [] }

function zeroTraffic(): TrafficSummary {
	return { days: fixtureDates().map((date) => ({ date, requests: 0, errors: 0, disconnected: 0 })), last24h: { requests: 0, errors: 0 } }
}

function expectNoBrokenNumbers(html: string): void {
	expect(html).not.toMatch(/NaN|Infinity|undefined|null/)
}

describe('renderDashboard', () => {
	it('should render the sections in the spec order', () => {
		const html = renderDashboard(fixtureModel())

		const headings = ['Requests, last 30 days', 'Sign-ins, last 30 days', 'Clients', 'Tools', 'OAuth hygiene', 'Notes']
		const positions = headings.map((heading) => html.indexOf(`>${heading}</h2>`))
		expect(positions.every((position) => position > 0)).toBe(true)
		expect([...positions].sort((a, b) => a - b)).toEqual(positions)
		expect(html.indexOf('class="tiles"')).toBeLessThan(positions[0])
	})

	it('should show the five headline tiles with their values', () => {
		const html = renderDashboard(fixtureModel())

		expect(html).toContain('Users with live grants')
		expect(html).toContain('>512<')
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
		expect(html).toContain('Users with live grants')
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

	it('should compare registered clients with live grants in the hygiene section', () => {
		const html = renderDashboard(fixtureModel())

		expect(html).toContain('4,706')
		expect(html).toContain('924')
		expect(html).toContain('5.1 registered clients per live grant')
		expect(html).toContain('Pending grants')
		expect(html).toContain('Grants with no expiry')
		expect(html).toContain('Unresolved grants')
	})

	it('should carry the footer notes, without the retired session_id note', () => {
		const html = renderDashboard(fixtureModel())

		expect(html).toContain('Tool tracking started 2026-11-10 08:15 UTC')
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

		expect(html.match(/<svg[^>]*role="img"[^>]*aria-label="[^"]+"/g)?.length).toBe(3)
		expect(html.match(/<summary>Show as table<\/summary>/g)?.length).toBe(2)
	})
})
