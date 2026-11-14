// ABOUTME: Authenticated MCP tools that require Last.fm authentication to access personal user data.
// ABOUTME: Reads the signed-in user's session through a getter; without one, tools explain that the MCP client signs in over OAuth.
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { CachedLastfmClient } from '../../clients/cachedLastfm'
import { MAX_EXCLUDE, findRecommendations } from '../../recommendations/engine'
import { formatRecommendations } from '../../recommendations/format'
import { LASTFM_READ, LOCAL_READ } from './annotations'
import { isSameArtist, suggestArtistNames } from './artistMatch'
import { AUTHENTICATED_TOOL_CATALOG, PUBLIC_TOOL_CATALOG, renderToolList } from './catalog'
import { toolError } from './error-handler'
import { formatArtist, toArray } from './formatters'
import { buildNextSteps } from '../../utils/breadcrumb'
import { formatTimestamp, getDayBoundsUTC } from '../../utils/dateFormat'

/**
 * Last.fm user props stored in OAuth token
 */
export interface LastfmOAuthProps {
	userId: string
	username: string
	sessionKey: string
}

// Valid time periods for Last.fm API
const PERIOD_VALUES = ['7day', '1month', '3month', '6month', '12month', 'overall'] as const
type Period = (typeof PERIOD_VALUES)[number]

const CHART_FROM_DESCRIPTION =
	'Start of the range (Unix timestamp). Any range works (a week, a month, a year); get_weekly_chart_list is one source of week boundaries.'
const CHART_TO_DESCRIPTION =
	'End of the range (Unix timestamp). Any range works (a week, a month, a year); get_weekly_chart_list is one source of week boundaries.'
const ARTIST_FILTER_SCHEMA = z
	.string()
	.optional()
	.describe('Only show this artist (case-insensitive). Searches the whole chart, not just the top rows.')
const CHART_LIMIT_SCHEMA = z.coerce
	.number()
	.min(1)
	.max(1000)
	.optional()
	.default(30)
	.describe('Maximum rows to show (1-1000). Ignored when artist is set.')

const formatCount = (n: number) => n.toLocaleString('en-US')
const formatPlays = (playcount: string) => `${playcount} ${playcount === '1' ? 'play' : 'plays'}`

/** Message for an artist filter with no exact match, with up to 5 near-miss chart artists. */
function formatArtistNotFound(query: string, suggestions: string[]): string {
	const base = `${JSON.stringify(query)} doesn't appear in this period.`
	return suggestions.length > 0 ? `${base}\nDid you mean: ${suggestions.join(', ')}?` : base
}

/**
 * Session context for authenticated tools.
 */
export interface AuthSession {
	username: string
	sessionKey: string
}

/**
 * Shown by lastfm_auth_status without a session. Every client signs in through MCP OAuth, which the client starts
 * on the server's 401, so the only advice is to reconnect.
 */
const NOT_AUTHENTICATED_STATUS = `🔐 **Authentication Status: Not Authenticated**

You are not currently authenticated with Last.fm.

**How to authenticate:**
Your MCP client should automatically prompt you to authenticate. If not, try disconnecting and reconnecting to this server.

**Available without authentication:**
${renderToolList(PUBLIC_TOOL_CATALOG)}`

/** First line of AUTH_REQUIRED; tool-call instrumentation matches on it to classify a call as auth_required. */
export const AUTH_REQUIRED_HEADING = '🔐 **Authentication Required**'

/** Shown by every tool that needs the user's Last.fm session when there is none. */
const AUTH_REQUIRED = `${AUTH_REQUIRED_HEADING}

This tool requires authentication with Last.fm.

Your MCP client should automatically initiate the OAuth flow. If not, disconnect and reconnect to this server to start the authentication process.

Once authenticated, your session will persist across conversations.`

/**
 * Register all authenticated tools with the MCP server. `getSession` returns the signed-in user's
 * Last.fm session from the OAuth grant, or null before sign-in.
 */
export function registerAuthenticatedTools(server: McpServer, client: CachedLastfmClient, getSession: () => AuthSession | null): void {
	// lastfm_auth_status - Check authentication status
	server.registerTool(
		'lastfm_auth_status',
		{
			title: 'Last.fm sign-in status',
			annotations: LOCAL_READ,
			description: 'Check if user is authenticated with Last.fm - Use this to verify login status before accessing personal music data',
			inputSchema: z.object({}),
		},
		async () => {
			const session = getSession()

			if (!session) {
				return {
					content: [{ type: 'text', text: NOT_AUTHENTICATED_STATUS }],
				}
			}

			const nextSteps = buildNextSteps([
				{ tool: 'get_recent_tracks', args: '', hint: "see what you've been listening to lately" },
				{ tool: 'get_top_artists', args: 'period="1month"', hint: 'top artists for a recent window' },
				{ tool: 'get_listening_stats', args: '', hint: 'shape of your overall scrobble history' },
				{ tool: 'get_music_recommendations', args: '', hint: 'new-to-you artists based on your listening, with starter tracks' },
			])

			return {
				content: [
					{
						type: 'text',
						text: `🔐 **Authentication Status: Authenticated** (Last.fm)

✅ **Authenticated as:** ${session.username}
🎵 **Connected to:** Last.fm

**Available Last.fm tools:**
${renderToolList(AUTHENTICATED_TOOL_CATALOG)}

**Examples to try:**
- "Get my recent tracks"
- "Show me my top artists from the last month"
- "Find similar artists to Radiohead"
- "Get my listening statistics"
- "When did I start listening to Led Zeppelin?"${nextSteps}`,
					},
				],
			}
		},
	)

	// get_recent_tracks - Get user's recent listening history
	server.registerTool(
		'get_recent_tracks',
		{
			title: 'Recently played tracks',
			annotations: LASTFM_READ,
			description:
				"Get user's recent Last.fm listening history - REQUIRES AUTHENTICATION. Use lastfm_auth_status first to check login status.",
			inputSchema: z.object({
				username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
				limit: z.coerce.number().min(1).max(1000).optional().default(50).describe('Number of tracks to return per page (1-1000)'),
				page: z.coerce.number().min(1).optional().default(1).describe('Page number for pagination (starts at 1)'),
				date: z
					.string()
					.optional()
					.describe(
						'Calendar date in YYYY-MM-DD format (e.g. "2026-03-16"). The server computes correct UTC day boundaries using the timezone param. Prefer this over from/to when querying "today", "yesterday", or a specific date.',
					),
				from: z.coerce.number().optional().describe('Start timestamp (Unix timestamp). Ignored if date is provided.'),
				to: z.coerce.number().optional().describe('End timestamp (Unix timestamp). Ignored if date is provided.'),
				timezone: z
					.string()
					.optional()
					.default('UTC')
					.describe(
						'IANA timezone name (e.g. "America/New_York"). Defaults to UTC. Required for date param to work correctly — always pass when the user\'s timezone is known.',
					),
			}),
		},
		async ({ username, limit, page, date, from, to, timezone }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: AUTH_REQUIRED }] }
			}

			try {
				const effectiveUsername = username || session.username
				let effectiveFrom = from
				let effectiveTo = to
				if (date) {
					const bounds = getDayBoundsUTC(date, timezone)
					effectiveFrom = bounds.from
					effectiveTo = bounds.to
				}
				let effectiveTimezone = timezone
				let timezoneWarning: string | undefined
				try {
					Intl.DateTimeFormat('en-US', { timeZone: effectiveTimezone })
				} catch {
					timezoneWarning = `⚠️ Unrecognized timezone "${effectiveTimezone}" — falling back to UTC.`
					effectiveTimezone = 'UTC'
				}
				const data = await client.getRecentTracks(effectiveUsername, limit, effectiveFrom, effectiveTo, page)

				const tracks = data.recenttracks.track.slice(0, limit)
				const trackList = tracks
					.map((track) => {
						const nowPlaying = track.nowplaying ? ' 🎵 Now Playing' : ''
						const date = track.date ? formatTimestamp(parseInt(track.date.uts), effectiveTimezone) : ''
						const album = track.album?.['#text'] ? ` [${track.album['#text']}]` : ''
						return `• ${track.artist['#text']} - ${track.name}${album}${nowPlaying}${date ? ` (${date})` : ''}`
					})
					.join('\n')

				const currentPage = parseInt(data.recenttracks['@attr'].page)
				const totalPages = parseInt(data.recenttracks['@attr'].totalPages)
				const totalTracks = parseInt(data.recenttracks['@attr'].total)

				const nowStr = formatTimestamp(Math.floor(Date.now() / 1000), effectiveTimezone)
				const rangeStr =
					effectiveFrom && effectiveTo
						? `${formatTimestamp(effectiveFrom, effectiveTimezone)} – ${formatTimestamp(effectiveTo, effectiveTimezone)}`
						: effectiveFrom
							? `from ${formatTimestamp(effectiveFrom, effectiveTimezone)}`
							: `most recent (server time: ${nowStr})`

				const topTrack = tracks[0]
				const topArtist = topTrack ? topTrack.artist['#text'] || (topTrack.artist as unknown as { name: string }).name : null
				const nextSteps = buildNextSteps([
					topTrack && topArtist
						? {
								tool: 'get_track_info',
								args: `artist=${JSON.stringify(topArtist)}, track=${JSON.stringify(topTrack.name)}`,
								hint: 'expand the most recent track',
							}
						: {
								tool: 'get_track_info',
								args: 'artist="<ARTIST FROM LIST>", track="<TRACK FROM LIST>"',
								hint: 'expand a track from the feed',
							},
					{ tool: 'get_artist_info', args: 'artist="<ARTIST FROM LIST>"', hint: 'expand an artist from the feed' },
					{ tool: 'get_top_artists', args: 'period="7day"', hint: 'aggregate the recent feed into a 7-day top list' },
					{ tool: 'get_music_recommendations', args: '', hint: 'new-to-you artists based on your listening, with starter tracks' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `${timezoneWarning ? timezoneWarning + '\n\n' : ''}🎵 **Recent Tracks for ${effectiveUsername}** (times in ${effectiveTimezone})
📅 **Queried range:** ${rangeStr}

📊 **Pagination Info:**
• Page ${currentPage} of ${totalPages}
• Showing ${tracks.length} tracks out of ${totalTracks} total
• Per page: ${data.recenttracks['@attr'].perPage}

${trackList}

${currentPage < totalPages ? `\n💡 **Next page:** Use \`page: ${currentPage + 1}\` to get more tracks` : ''}
${currentPage > 1 ? `\n⬅️ **Previous page:** Use \`page: ${currentPage - 1}\` to go back` : ''}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_recent_tracks', error)
			}
		},
	)

	// get_top_artists - Get user's most listened to artists
	server.registerTool(
		'get_top_artists',
		{
			title: "User's top artists",
			annotations: LASTFM_READ,
			description:
				"Get user's most listened to artists from Last.fm - REQUIRES AUTHENTICATION. Specify time period like '7day', '1month', '6month', 'overall'.",
			inputSchema: z.object({
				username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
				period: z.enum(PERIOD_VALUES).optional().default('overall').describe('Time period for top artists'),
				limit: z.coerce.number().min(1).max(1000).optional().default(50).describe('Number of artists to return (1-1000)'),
			}),
		},
		async ({ username, period, limit }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: AUTH_REQUIRED }] }
			}

			try {
				const effectiveUsername = username || session.username
				const data = await client.getTopArtists(effectiveUsername, period as Period, limit)

				const artists = data.topartists.artist.slice(0, limit)
				const artistList = artists.map((artist, index) => `${index + 1}. ${artist.name} (${artist.playcount} plays)`).join('\n')

				const topArtistName = artists[0]?.name
				const nextSteps = buildNextSteps([
					topArtistName
						? { tool: 'get_artist_info', args: `artist=${JSON.stringify(topArtistName)}`, hint: 'expand your top artist' }
						: { tool: 'get_artist_info', args: 'artist="<NAME FROM LIST>"', hint: 'expand one of your top artists' },
					{ tool: 'get_artist_top_tracks', args: 'artist="<NAME FROM LIST>"', hint: 'see canonical tracks for one of them' },
					{ tool: 'get_top_albums', args: `period="${period}"`, hint: 'pivot to top albums for the same period' },
					{ tool: 'get_music_recommendations', args: '', hint: 'new-to-you artists based on your listening, with starter tracks' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `🎤 **Top Artists for ${effectiveUsername}** (${period})

${artistList}

Total artists: ${data.topartists['@attr'].total}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_top_artists', error)
			}
		},
	)

	// get_top_albums - Get user's most listened to albums
	server.registerTool(
		'get_top_albums',
		{
			title: "User's top albums",
			annotations: LASTFM_READ,
			description:
				"Get user's most listened to albums from Last.fm - REQUIRES AUTHENTICATION. Specify time period like '7day', '1month', '6month', 'overall'.",
			inputSchema: z.object({
				username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
				period: z.enum(PERIOD_VALUES).optional().default('overall').describe('Time period for top albums'),
				limit: z.coerce.number().min(1).max(1000).optional().default(50).describe('Number of albums to return (1-1000)'),
			}),
		},
		async ({ username, period, limit }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: AUTH_REQUIRED }] }
			}

			try {
				const effectiveUsername = username || session.username
				const data = await client.getTopAlbums(effectiveUsername, period as Period, limit)

				const albums = data.topalbums.album.slice(0, limit)
				const albumList = albums
					.map((album, index) => {
						return `${index + 1}. ${formatArtist(album.artist)} - ${album.name} (${album.playcount} plays)`
					})
					.join('\n')

				const topAlbum = albums[0]
				const nextSteps = buildNextSteps([
					topAlbum
						? {
								tool: 'get_album_info',
								args: `artist=${JSON.stringify(formatArtist(topAlbum.artist))}, album=${JSON.stringify(topAlbum.name)}`,
								hint: 'expand your top album',
							}
						: {
								tool: 'get_album_info',
								args: 'artist="<ARTIST FROM LIST>", album="<ALBUM FROM LIST>"',
								hint: 'expand one of your top albums',
							},
					{ tool: 'get_top_tracks', args: `period="${period}"`, hint: 'pivot to top tracks for the same period' },
					{ tool: 'get_top_artists', args: `period="${period}"`, hint: 'pivot to top artists for the same period' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `💿 **Top Albums for ${effectiveUsername}** (${period})

${albumList}

Total albums: ${data.topalbums['@attr'].total}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_top_albums', error)
			}
		},
	)

	// get_top_tracks - Get user's most listened to tracks
	server.registerTool(
		'get_top_tracks',
		{
			title: "User's top tracks",
			annotations: LASTFM_READ,
			description:
				"Get user's most listened to tracks from Last.fm - REQUIRES AUTHENTICATION. Specify time period like '7day', '1month', '6month', 'overall'.",
			inputSchema: z.object({
				username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
				period: z.enum(PERIOD_VALUES).optional().default('overall').describe('Time period for top tracks'),
				limit: z.coerce.number().min(1).max(1000).optional().default(50).describe('Number of tracks to return (1-1000)'),
			}),
		},
		async ({ username, period, limit }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: AUTH_REQUIRED }] }
			}

			try {
				const effectiveUsername = username || session.username
				const data = await client.getTopTracks(effectiveUsername, period as Period, limit)

				const tracks = data.toptracks.track.slice(0, limit)
				const trackList = tracks
					.map((track, index) => {
						const artistName = track.artist['#text'] || (track.artist as unknown as { name: string }).name
						return `${index + 1}. ${artistName} - ${track.name} (${track.playcount} plays)`
					})
					.join('\n')

				const topTrack = tracks[0]
				const topTrackArtist = topTrack ? topTrack.artist['#text'] || (topTrack.artist as unknown as { name: string }).name : null
				const nextSteps = buildNextSteps([
					topTrack && topTrackArtist
						? {
								tool: 'get_track_info',
								args: `artist=${JSON.stringify(topTrackArtist)}, track=${JSON.stringify(topTrack.name)}`,
								hint: 'expand your top track',
							}
						: {
								tool: 'get_track_info',
								args: 'artist="<ARTIST FROM LIST>", track="<TRACK FROM LIST>"',
								hint: 'expand one of your top tracks',
							},
					{
						tool: 'get_similar_tracks',
						args: 'artist="<ARTIST FROM LIST>", track="<TRACK FROM LIST>"',
						hint: 'find more like one of your favorites',
					},
					{ tool: 'get_top_albums', args: `period="${period}"`, hint: 'pivot to top albums for the same period' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `🎵 **Top Tracks for ${effectiveUsername}** (${period})

${trackList}

Total tracks: ${data.toptracks['@attr'].total}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_top_tracks', error)
			}
		},
	)

	// get_loved_tracks - Get user's loved/favorite tracks
	server.registerTool(
		'get_loved_tracks',
		{
			title: 'Loved tracks',
			annotations: LASTFM_READ,
			description:
				"Get user's loved/favorite tracks from Last.fm - REQUIRES AUTHENTICATION. Shows tracks the user has marked as favorites.",
			inputSchema: z.object({
				username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
				limit: z.coerce.number().min(1).max(1000).optional().default(50).describe('Number of tracks to return (1-1000)'),
			}),
		},
		async ({ username, limit }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: AUTH_REQUIRED }] }
			}

			try {
				const effectiveUsername = username || session.username
				const data = await client.getLovedTracks(effectiveUsername, limit)

				const tracks = data.lovedtracks.track.slice(0, limit)
				const trackList = tracks
					.map((track) => {
						const album = track.album?.['#text'] ? ` [${track.album['#text']}]` : ''
						return `• ${track.artist['#text'] || (track.artist as unknown as { name: string }).name} - ${track.name}${album}`
					})
					.join('\n')

				const topLoved = tracks[0]
				const topLovedArtist = topLoved ? topLoved.artist['#text'] || (topLoved.artist as unknown as { name: string }).name : null
				const nextSteps = buildNextSteps([
					topLoved && topLovedArtist
						? {
								tool: 'get_track_info',
								args: `artist=${JSON.stringify(topLovedArtist)}, track=${JSON.stringify(topLoved.name)}`,
								hint: 'expand your most-recently-loved track',
							}
						: {
								tool: 'get_track_info',
								args: 'artist="<ARTIST FROM LIST>", track="<TRACK FROM LIST>"',
								hint: 'expand one of your loved tracks',
							},
					{
						tool: 'get_similar_tracks',
						args: 'artist="<ARTIST FROM LIST>", track="<TRACK FROM LIST>"',
						hint: 'find more like a loved track',
					},
					{ tool: 'get_music_recommendations', args: '', hint: 'new-to-you artists based on your listening, with starter tracks' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `❤️ **Loved Tracks for ${effectiveUsername}**

${trackList}

Total loved tracks: ${data.lovedtracks['@attr'].total}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_loved_tracks', error)
			}
		},
	)

	// get_user_info - Get user profile information
	server.registerTool(
		'get_user_info',
		{
			title: 'Last.fm profile',
			annotations: LASTFM_READ,
			description: 'Get Last.fm user profile information and listening statistics - REQUIRES AUTHENTICATION',
			inputSchema: z.object({
				username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
			}),
		},
		async ({ username }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: AUTH_REQUIRED }] }
			}

			try {
				const effectiveUsername = username || session.username
				const data = await client.getUserInfo(effectiveUsername)
				const user = data.user

				const registrationDate = formatTimestamp(parseInt(user.registered.unixtime))

				const nextSteps = buildNextSteps([
					{ tool: 'get_listening_stats', args: '', hint: 'aggregate stats across the full scrobble history' },
					{ tool: 'get_top_artists', args: 'period="overall"', hint: 'all-time top artists' },
					{ tool: 'get_recent_tracks', args: '', hint: "see what they've been listening to lately" },
				])

				return {
					content: [
						{
							type: 'text',
							text: `👤 **User Profile**

**Username:** ${user.name}
**Real Name:** ${user.realname || 'Not provided'}
**Country:** ${user.country || 'Not provided'}

**Stats:**
• Total scrobbles: ${user.playcount}
• Member since: ${registrationDate}
• Subscriber: ${user.subscriber === '1' ? 'Yes' : 'No'}

**Profile URL:** ${user.url}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_user_info', error)
			}
		},
	)

	// get_listening_stats - Get comprehensive listening statistics
	server.registerTool(
		'get_listening_stats',
		{
			title: 'Listening stats',
			annotations: LASTFM_READ,
			description:
				'Get comprehensive Last.fm listening statistics and analytics - REQUIRES AUTHENTICATION. Shows detailed insights about music habits.',
			inputSchema: z.object({
				username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
				period: z.enum(PERIOD_VALUES).optional().default('overall').describe('Time period for statistics'),
			}),
		},
		async ({ username, period }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: AUTH_REQUIRED }] }
			}

			try {
				const effectiveUsername = username || session.username
				const stats = await client.getListeningStats(effectiveUsername, period as Period)

				const nextSteps = buildNextSteps([
					{ tool: 'get_top_artists', args: `period="${period}"`, hint: 'see top artists for the same period' },
					{ tool: 'get_top_albums', args: `period="${period}"`, hint: 'see top albums for the same period' },
					{ tool: 'get_top_tracks', args: `period="${period}"`, hint: 'see top tracks for the same period' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `📊 **Listening Statistics for ${effectiveUsername}** (${period})

**Overview:**
• Total scrobbles: ${stats.totalScrobbles.toLocaleString()}
• Average tracks per day: ${stats.listeningTrends.averageTracksPerDay}
• Top artists tracked: ${stats.topArtistsCount}
• Top albums tracked: ${stats.topAlbumsCount}

**Activity:**
• Recent activity level: ${stats.listeningTrends.recentActivity} tracked items${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_listening_stats', error)
			}
		},
	)

	// get_music_recommendations - New-to-the-user artists with reasons and starters
	server.registerTool(
		'get_music_recommendations',
		{
			title: 'Music recommendations',
			annotations: LASTFM_READ,
			description:
				'Find new music for the signed-in user: artists they don\'t already listen to, ranked by how strongly their recent and long-term listening points to them, each with the reason from their own Last.fm data plus a starter album and tracks. Use this for "what should I listen to?", "recommend something", "find me new music" or "like X but new to me", instead of chaining get_similar_artists calls. Optional genre filter; pass exclude with earlier picks to get different ones. REQUIRES AUTHENTICATION',
			inputSchema: z.object({
				username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
				limit: z.coerce.number().int().min(1).max(15).optional().default(8).describe('Number of artists to recommend (1-15)'),
				genre: z.string().trim().optional().describe('Optional Last.fm genre tag to keep picks in, e.g. "shoegaze"'),
				exclude: z
					.array(z.string().trim().min(1))
					.max(MAX_EXCLUDE)
					.optional()
					.default([])
					.describe(`Artist names to leave out, such as earlier picks (up to ${MAX_EXCLUDE}, case-insensitive)`),
			}),
		},
		async ({ username, limit, genre, exclude }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: AUTH_REQUIRED }] }
			}

			try {
				// The schema trims genre; a blank one means no genre filter
				const result = await findRecommendations(client, username || session.username, { limit, genre: genre || undefined, exclude })
				// Next steps names the user only when the request did, so a follow-up never switches whose picks these are
				return { content: [{ type: 'text', text: formatRecommendations(result, { username: username || undefined, exclude }) }] }
			} catch (error) {
				return toolError('get_music_recommendations', error)
			}
		},
	)

	// get_weekly_chart_list - Get available weekly chart date ranges
	server.registerTool(
		'get_weekly_chart_list',
		{
			title: 'Weekly chart periods',
			annotations: LASTFM_READ,
			description:
				'Get available weekly chart date ranges for user\'s listening history - REQUIRES AUTHENTICATION. Use this to find historical time periods for temporal queries like "when did I start listening to X".',
			inputSchema: z.object({
				username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
			}),
		},
		async ({ username }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: AUTH_REQUIRED }] }
			}

			try {
				const effectiveUsername = username || session.username
				const data = await client.getWeeklyChartList(effectiveUsername)

				const charts = data.weeklychartlist.chart
				const chartList = charts
					.slice(-20)
					.reverse()
					.map((chart) => {
						const fromDate = formatTimestamp(parseInt(chart.from))
						const toDate = formatTimestamp(parseInt(chart.to))
						return `• ${fromDate} to ${toDate} (from: ${chart.from}, to: ${chart.to})`
					})
					.join('\n')

				const sampleFrom = charts[charts.length - 1]?.from
				const sampleTo = charts[charts.length - 1]?.to
				const nextSteps = buildNextSteps([
					{
						tool: 'get_weekly_artist_chart',
						args: `from=${sampleFrom}, to=${sampleTo}`,
						hint: 'top artists for a specific week (substitute from/to from any row above)',
					},
					{
						tool: 'get_weekly_track_chart',
						args: `from=${sampleFrom}, to=${sampleTo}`,
						hint: 'top tracks for a specific week (substitute from/to from any row above)',
					},
				])

				return {
					content: [
						{
							type: 'text',
							text: `📅 **Weekly Chart Periods for ${effectiveUsername}**

🗓️ **Available Date Ranges** (showing most recent 20):

${chartList}

📊 **Total periods available:** ${charts.length}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_weekly_chart_list', error)
			}
		},
	)

	// get_weekly_artist_chart - Get artist listening data for a specific period
	server.registerTool(
		'get_weekly_artist_chart',
		{
			title: 'Weekly artist chart',
			annotations: LASTFM_READ,
			description:
				'Get artist listening data for a specific time period - REQUIRES AUTHENTICATION. Perfect for temporal queries like "what artists was I into in 2023". Any from/to Unix range works (a week, a month, a year). Set `artist` to find one artist anywhere in the chart, not just the top rows.',
			inputSchema: z.object({
				username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
				from: z.coerce.number().optional().describe(CHART_FROM_DESCRIPTION),
				to: z.coerce.number().optional().describe(CHART_TO_DESCRIPTION),
				artist: ARTIST_FILTER_SCHEMA,
				limit: CHART_LIMIT_SCHEMA,
			}),
		},
		async ({ username, from, to, artist: artistFilter, limit }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: AUTH_REQUIRED }] }
			}

			try {
				const effectiveUsername = username || session.username
				const data = await client.getWeeklyArtistChart(effectiveUsername, from, to)

				const artists = toArray(data.weeklyartistchart.artist)
				const periodInfo = from && to ? `${formatTimestamp(from)} to ${formatTimestamp(to)}` : 'Most Recent Week'

				let artistList: string
				let summary: string
				if (artistFilter) {
					const matches = artists.flatMap((a, index) => (isSameArtist(a.name, artistFilter) ? [{ artist: a, position: index + 1 }] : []))
					artistList =
						matches.length > 0
							? matches
									.map(
										({ artist: a, position }) => `#${position} of ${formatCount(artists.length)} · ${a.name} (${formatPlays(a.playcount)})`,
									)
									.join('\n')
							: formatArtistNotFound(
									artistFilter,
									suggestArtistNames(
										artists.map((a) => a.name),
										artistFilter,
									),
								)
					summary = `📊 **Total artists in this period:** ${artists.length}`
				} else {
					artistList = artists
						.slice(0, limit)
						.map((a, index) => `${index + 1}. ${a.name} (${a.playcount} plays)`)
						.join('\n')
					summary = `📊 **Total artists in this period:** ${artists.length}\n${artists.length > limit ? `\n📝 **Note:** Showing top ${limit} artists only` : ''}`
				}

				const topWeekArtist = artists[0]?.name
				const nextSteps = buildNextSteps([
					{ tool: 'get_weekly_track_chart', args: `from=${from}, to=${to}`, hint: 'see top tracks for the same week' },
					topWeekArtist
						? { tool: 'get_artist_info', args: `artist=${JSON.stringify(topWeekArtist)}`, hint: 'expand the top artist from this week' }
						: { tool: 'get_artist_info', args: 'artist="<NAME FROM LIST>"', hint: 'expand one of the artists from this week' },
					{ tool: 'get_weekly_chart_list', args: '', hint: 'pick a different week to explore' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `🎤 **Weekly Artist Chart for ${effectiveUsername}**
📅 **Period:** ${periodInfo}

${artistList}

${summary}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_weekly_artist_chart', error)
			}
		},
	)

	// get_weekly_track_chart - Get track listening data for a specific period
	server.registerTool(
		'get_weekly_track_chart',
		{
			title: 'Weekly track chart',
			annotations: LASTFM_READ,
			description:
				'Get track listening data for a specific time period - REQUIRES AUTHENTICATION. Perfect for temporal queries like "what songs was I obsessed with in summer 2023". Any from/to Unix range works (a week, a month, a year). Set `artist` to find every track by one artist anywhere in the chart, not just the top rows.',
			inputSchema: z.object({
				username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
				from: z.coerce.number().optional().describe(CHART_FROM_DESCRIPTION),
				to: z.coerce.number().optional().describe(CHART_TO_DESCRIPTION),
				artist: ARTIST_FILTER_SCHEMA,
				limit: CHART_LIMIT_SCHEMA,
			}),
		},
		async ({ username, from, to, artist: artistFilter, limit }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: AUTH_REQUIRED }] }
			}

			try {
				const effectiveUsername = username || session.username
				const data = await client.getWeeklyTrackChart(effectiveUsername, from, to)

				const tracks = toArray(data.weeklytrackchart.track)
				const periodInfo = from && to ? `${formatTimestamp(from)} to ${formatTimestamp(to)}` : 'Most Recent Week'

				let trackList: string
				let summary: string
				if (artistFilter) {
					const matches = tracks.flatMap((t, index) =>
						isSameArtist(t.artist['#text'], artistFilter) ? [{ track: t, position: index + 1 }] : [],
					)
					trackList =
						matches.length > 0
							? matches
									.map(
										({ track: t, position }) =>
											`#${position} of ${formatCount(tracks.length)} · ${t.artist['#text']} - ${t.name} (${formatPlays(t.playcount)})`,
									)
									.join('\n')
							: formatArtistNotFound(
									artistFilter,
									suggestArtistNames(
										tracks.map((t) => t.artist['#text']),
										artistFilter,
									),
								)
					summary = `📊 **Total tracks in this period:** ${tracks.length}`
				} else {
					trackList = tracks
						.slice(0, limit)
						.map((t, index) => `${index + 1}. ${t.artist['#text']} - ${t.name} (${t.playcount} plays)`)
						.join('\n')
					summary = `📊 **Total tracks in this period:** ${tracks.length}\n${tracks.length > limit ? `\n📝 **Note:** Showing top ${limit} tracks only` : ''}`
				}

				const topWeekTrack = tracks[0]
				const nextSteps = buildNextSteps([
					{ tool: 'get_weekly_artist_chart', args: `from=${from}, to=${to}`, hint: 'see top artists for the same week' },
					topWeekTrack
						? {
								tool: 'get_track_info',
								args: `artist=${JSON.stringify(topWeekTrack.artist['#text'])}, track=${JSON.stringify(topWeekTrack.name)}`,
								hint: 'expand the top track from this week',
							}
						: {
								tool: 'get_track_info',
								args: 'artist="<ARTIST FROM LIST>", track="<TRACK FROM LIST>"',
								hint: 'expand a track from this week',
							},
					{ tool: 'get_weekly_chart_list', args: '', hint: 'pick a different week to explore' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `🎵 **Weekly Track Chart for ${effectiveUsername}**
📅 **Period:** ${periodInfo}

${trackList}

${summary}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_weekly_track_chart', error)
			}
		},
	)
}
