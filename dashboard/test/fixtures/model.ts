// ABOUTME: A realistic dashboard page model for rendering tests and for previewing the page as a screenshot.
// ABOUTME: Numbers are shaped like production (about 45k requests a day, 900 grants, 4,700 registered clients), with no real data.
import type { GrantSummary } from '../../src/grants'
import type { DashboardModel } from '../../src/model'
import type { ToolRow, ToolStats } from '../../src/tools'
import type { TrafficSummary } from '../../src/traffic'

const DAY_MS = 86_400_000
export const FIXTURE_NOW = new Date('2026-11-12T15:30:00.000Z')

/** The 30 UTC dates ending on FIXTURE_NOW's day, oldest first */
export function fixtureDates(): string[] {
	const today = Math.floor(FIXTURE_NOW.getTime() / DAY_MS)
	return Array.from({ length: 30 }, (_, i) => new Date((today - 29 + i) * DAY_MS).toISOString().slice(0, 10))
}

export function fixtureGrants(): GrantSummary {
	return {
		computedAt: '2026-11-12T15:17:04.000Z',
		liveGrants: 924,
		liveUsers: 512,
		noExpiryGrants: 31,
		pendingGrants: 4,
		unresolvedGrants: 0,
		registeredClients: 4706,
		signInsLast7d: 141,
		signInsByDay: fixtureDates().map((date, i) => ({ date, count: 12 + ((i * 7) % 15) + (i % 6 === 0 ? 9 : 0) })),
		clients: [
			{ label: 'Claude', grants: 521, users: 344 },
			{ label: 'ChatGPT', grants: 188, users: 101 },
			{ label: 'Claude Code', grants: 97, users: 40 },
			{ label: 'cursor.com', grants: 61, users: 18 },
			{ label: 'unknown', grants: 57, users: 9 },
		],
	}
}

export function fixtureTraffic(): TrafficSummary {
	return {
		days: fixtureDates().map((date, i) => {
			const requests = 38_000 + ((i * 2_731) % 11_000) + (i === 29 ? -20_000 : 0)
			return { date, requests, errors: i === 21 ? 64 : (i * 3) % 7, disconnected: Math.round(requests * 0.11) }
		}),
		last24h: { requests: 44_812, errors: 9 },
	}
}

function toolRow(tool: string, calls: number, extra: Partial<ToolRow> = {}): ToolRow {
	return { tool, calls, errors: Math.round(calls * 0.012), authRequired: 0, p50Ms: 180, p95Ms: 1_240, cacheHitRate: 0.42, ...extra }
}

export function fixtureTools(): ToolStats {
	return {
		firstEventAt: '2026-11-10T08:15:00.000Z',
		last24h: [
			toolRow('get_recent_tracks', 2_310, { p50Ms: 212, p95Ms: 1_870, cacheHitRate: 0.18 }),
			toolRow('get_top_artists', 1_204, { cacheHitRate: 0.61 }),
			toolRow('get_music_recommendations', 655, { p50Ms: 2_410, p95Ms: 7_960, errors: 31 }),
			toolRow('lastfm_auth_status', 402, { authRequired: 96, p50Ms: 3, p95Ms: 11, cacheHitRate: null, errors: 0 }),
			toolRow('ping', 37, { p50Ms: 0.4, p95Ms: 1, cacheHitRate: null, errors: 0 }),
		],
		last7d: [
			toolRow('get_recent_tracks', 14_002, { p50Ms: 204, p95Ms: 1_790, cacheHitRate: 0.2 }),
			toolRow('get_top_artists', 7_310, { cacheHitRate: 0.58 }),
			toolRow('get_music_recommendations', 3_904, { p50Ms: 2_380, p95Ms: 8_120 }),
			toolRow('lastfm_auth_status', 2_288, { authRequired: 611, p50Ms: 3, p95Ms: 12, cacheHitRate: null, errors: 0 }),
			toolRow('get_artist_info', 1_016, { cacheHitRate: 0.77 }),
			toolRow('ping', 190, { p50Ms: 0.4, p95Ms: 1, cacheHitRate: null, errors: 0 }),
		],
		clients7d: [
			{ label: 'Claude', calls: 17_840 },
			{ label: 'ChatGPT', calls: 6_102 },
			{ label: 'Claude Code', calls: 3_311 },
			{ label: 'Goose', calls: 512 },
		],
	}
}

export function fixtureModel(): DashboardModel {
	return { generatedAt: FIXTURE_NOW.toISOString(), grants: fixtureGrants(), traffic: fixtureTraffic(), tools: fixtureTools() }
}
