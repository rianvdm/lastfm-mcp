/**
 * Authenticated MCP Tools
 *
 * Tools that require Last.fm authentication to access personal user data.
 * Uses the official MCP SDK with Zod schemas for validation.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { CachedLastfmClient } from '../../clients/cachedLastfm'

// Valid time periods for Last.fm API
const PERIOD_VALUES = ['7day', '1month', '3month', '6month', '12month', 'overall'] as const
type Period = (typeof PERIOD_VALUES)[number]

/**
 * Session context for authenticated tools.
 * This is passed to the registration function and captured in closures.
 */
export interface AuthSession {
	username: string
	sessionKey: string
}

/**
 * Register all authenticated tools with the MCP server.
 *
 * These tools access the authenticated user's personal Last.fm data.
 * The session is passed at registration time and captured in closures.
 */
export function registerAuthenticatedTools(
	server: McpServer,
	client: CachedLastfmClient,
	getSession: () => AuthSession | null,
	getBaseUrl: () => string,
): void {
	// lastfm_auth_status - Check authentication status
	server.tool(
		'lastfm_auth_status',
		'Check if user is authenticated with Last.fm - Use this to verify login status before accessing personal music data',
		{},
		async () => {
			const session = getSession()
			const baseUrl = getBaseUrl()

			if (!session) {
				const loginUrl = `${baseUrl}/login`
				return {
					content: [
						{
							type: 'text',
							text: `🔐 **Authentication Status: Not Authenticated**

You are not currently authenticated with Last.fm. To access your personal listening data, you need to authenticate first.

**How to authenticate:**
1. Visit: ${loginUrl}
2. Sign in with your Last.fm account
3. Authorize access to your listening data
4. Return here and try your query again

**What you'll be able to do after authentication:**
• Get your recent tracks and listening history
• View your top artists and albums by time period
• Access your loved tracks and user profile
• Get detailed information about tracks, artists, and albums (with personal stats)
• Discover similar music and get personalized recommendations
• Analyze your listening patterns and statistics

**Available without authentication:**
• \`ping\` - Test server connectivity
• \`server_info\` - Get server information
• \`lastfm_auth_status\` - Check authentication status (this tool)
• \`get_track_info\` - Get basic track information
• \`get_artist_info\` - Get basic artist information  
• \`get_album_info\` - Get basic album information
• \`get_similar_artists\` - Find similar artists
• \`get_similar_tracks\` - Find similar tracks`,
						},
					],
				}
			}

			return {
				content: [
					{
						type: 'text',
						text: `🔐 **Authentication Status: Authenticated** (Last.fm)

✅ **Authenticated as:** ${session.username}
🎵 **Connected to:** Last.fm
⏰ **Session expires:** Never (permanent session key)

**Available Last.fm tools:**
• \`get_recent_tracks\` - Get your recent listening history
• \`get_top_artists\` - Get your top artists by time period
• \`get_top_albums\` - Get your top albums by time period
• \`get_loved_tracks\` - Get your loved/favorite tracks
• \`get_track_info\` - Get detailed track information
• \`get_artist_info\` - Get detailed artist information
• \`get_album_info\` - Get detailed album information
• \`get_user_info\` - Get your profile information
• \`get_similar_artists\` - Find similar artists
• \`get_similar_tracks\` - Find similar tracks
• \`get_listening_stats\` - Get listening statistics
• \`get_music_recommendations\` - Get personalized recommendations
• \`get_weekly_chart_list\` - Get available historical time periods
• \`get_weekly_artist_chart\` - Get artist listening data for specific periods
• \`get_weekly_track_chart\` - Get track listening data for specific periods

**Examples to try:**
- "Get my recent tracks"
- "Show me my top artists from the last month"
- "Find similar artists to Radiohead"
- "Get my listening statistics"
- "When did I start listening to Led Zeppelin?"`,
					},
				],
			}
		},
	)

	// get_recent_tracks - Get user's recent listening history
	server.tool(
		'get_recent_tracks',
		"Get user's recent Last.fm listening history - REQUIRES AUTHENTICATION. Use lastfm_auth_status first to check login status.",
		{
			username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
			limit: z.number().min(1).max(1000).optional().default(50).describe('Number of tracks to return per page (1-1000)'),
			page: z.number().min(1).optional().default(1).describe('Page number for pagination (starts at 1)'),
			from: z.number().optional().describe('Start timestamp (Unix timestamp)'),
			to: z.number().optional().describe('End timestamp (Unix timestamp)'),
		},
		async ({ username, limit, page, from, to }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: requiresAuthMessage(getBaseUrl()) }] }
			}

			const effectiveUsername = username || session.username
			const data = await client.getRecentTracks(effectiveUsername, limit, from, to, page)

			const tracks = data.recenttracks.track.slice(0, limit)
			const trackList = tracks
				.map((track) => {
					const nowPlaying = track.nowplaying ? ' 🎵 Now Playing' : ''
					const date = track.date ? new Date(parseInt(track.date.uts) * 1000).toLocaleDateString() : ''
					const album = track.album?.['#text'] ? ` [${track.album['#text']}]` : ''
					return `• ${track.artist['#text']} - ${track.name}${album}${nowPlaying}${date ? ` (${date})` : ''}`
				})
				.join('\n')

			const currentPage = parseInt(data.recenttracks['@attr'].page)
			const totalPages = parseInt(data.recenttracks['@attr'].totalPages)
			const totalTracks = parseInt(data.recenttracks['@attr'].total)

			return {
				content: [
					{
						type: 'text',
						text: `🎵 **Recent Tracks for ${effectiveUsername}**

📊 **Pagination Info:**
• Page ${currentPage} of ${totalPages}
• Showing ${tracks.length} tracks out of ${totalTracks} total
• Per page: ${data.recenttracks['@attr'].perPage}

${trackList}

${currentPage < totalPages ? `\n💡 **Next page:** Use \`page: ${currentPage + 1}\` to get more tracks` : ''}
${currentPage > 1 ? `\n⬅️ **Previous page:** Use \`page: ${currentPage - 1}\` to go back` : ''}`,
					},
				],
			}
		},
	)

	// get_top_artists - Get user's most listened to artists
	server.tool(
		'get_top_artists',
		"Get user's most listened to artists from Last.fm - REQUIRES AUTHENTICATION. Specify time period like '7day', '1month', '6month', 'overall'.",
		{
			username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
			period: z.enum(PERIOD_VALUES).optional().default('overall').describe('Time period for top artists'),
			limit: z.number().min(1).max(1000).optional().default(50).describe('Number of artists to return (1-1000)'),
		},
		async ({ username, period, limit }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: requiresAuthMessage(getBaseUrl()) }] }
			}

			const effectiveUsername = username || session.username
			const data = await client.getTopArtists(effectiveUsername, period as Period, limit)

			const artists = data.topartists.artist.slice(0, limit)
			const artistList = artists.map((artist, index) => `${index + 1}. ${artist.name} (${artist.playcount} plays)`).join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `🎤 **Top Artists for ${effectiveUsername}** (${period})

${artistList}

Total artists: ${data.topartists['@attr'].total}`,
					},
				],
			}
		},
	)

	// get_top_albums - Get user's most listened to albums
	server.tool(
		'get_top_albums',
		"Get user's most listened to albums from Last.fm - REQUIRES AUTHENTICATION. Specify time period like '7day', '1month', '6month', 'overall'.",
		{
			username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
			period: z.enum(PERIOD_VALUES).optional().default('overall').describe('Time period for top albums'),
			limit: z.number().min(1).max(1000).optional().default(50).describe('Number of albums to return (1-1000)'),
		},
		async ({ username, period, limit }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: requiresAuthMessage(getBaseUrl()) }] }
			}

			const effectiveUsername = username || session.username
			const data = await client.getTopAlbums(effectiveUsername, period as Period, limit)

			const albums = data.topalbums.album.slice(0, limit)
			const albumList = albums
				.map((album, index) => {
					const artist = typeof album.artist === 'string' ? album.artist : album.artist.name
					return `${index + 1}. ${artist} - ${album.name} (${album.playcount} plays)`
				})
				.join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `💿 **Top Albums for ${effectiveUsername}** (${period})

${albumList}

Total albums: ${data.topalbums['@attr'].total}`,
					},
				],
			}
		},
	)

	// get_loved_tracks - Get user's loved/favorite tracks
	server.tool(
		'get_loved_tracks',
		"Get user's loved/favorite tracks from Last.fm - REQUIRES AUTHENTICATION. Shows tracks the user has marked as favorites.",
		{
			username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
			limit: z.number().min(1).max(1000).optional().default(50).describe('Number of tracks to return (1-1000)'),
		},
		async ({ username, limit }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: requiresAuthMessage(getBaseUrl()) }] }
			}

			const effectiveUsername = username || session.username
			const data = await client.getLovedTracks(effectiveUsername, limit)

			const tracks = data.lovedtracks.track.slice(0, limit)
			const trackList = tracks
				.map((track) => {
					const album = track.album?.['#text'] ? ` [${track.album['#text']}]` : ''
					return `• ${track.artist['#text'] || (track.artist as unknown as { name: string }).name} - ${track.name}${album}`
				})
				.join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `❤️ **Loved Tracks for ${effectiveUsername}**

${trackList}

Total loved tracks: ${data.lovedtracks['@attr'].total}`,
					},
				],
			}
		},
	)

	// get_user_info - Get user profile information
	server.tool(
		'get_user_info',
		'Get Last.fm user profile information and listening statistics - REQUIRES AUTHENTICATION for private profiles',
		{
			username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
		},
		async ({ username }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: requiresAuthMessage(getBaseUrl()) }] }
			}

			const effectiveUsername = username || session.username
			const data = await client.getUserInfo(effectiveUsername)
			const user = data.user

			const registrationDate = new Date(parseInt(user.registered.unixtime) * 1000).toLocaleDateString()

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

**Profile URL:** ${user.url}`,
					},
				],
			}
		},
	)

	// get_listening_stats - Get comprehensive listening statistics
	server.tool(
		'get_listening_stats',
		'Get comprehensive Last.fm listening statistics and analytics - REQUIRES AUTHENTICATION. Shows detailed insights about music habits.',
		{
			username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
			period: z.enum(PERIOD_VALUES).optional().default('overall').describe('Time period for statistics'),
		},
		async ({ username, period }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: requiresAuthMessage(getBaseUrl()) }] }
			}

			const effectiveUsername = username || session.username
			const stats = await client.getListeningStats(effectiveUsername, period as Period)

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
• Recent activity level: ${stats.listeningTrends.recentActivity} tracked items`,
					},
				],
			}
		},
	)

	// get_music_recommendations - Get personalized recommendations
	server.tool(
		'get_music_recommendations',
		'Get personalized music recommendations from Last.fm based on listening history - REQUIRES AUTHENTICATION',
		{
			username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
			limit: z.number().min(1).max(50).optional().default(20).describe('Number of recommendations to return (1-50)'),
			genre: z.string().optional().describe('Optional genre filter for recommendations'),
		},
		async ({ username, limit, genre }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: requiresAuthMessage(getBaseUrl()) }] }
			}

			const effectiveUsername = username || session.username
			const recommendations = await client.getMusicRecommendations(effectiveUsername, limit, genre)

			const artistRecs = recommendations.recommendedArtists.slice(0, 8)
			const artistList = artistRecs.map((rec) => `• ${rec.name} (${rec.reason})`).join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `🎯 **Music Recommendations for ${effectiveUsername}**
${genre ? `**Genre Filter:** ${genre}\n` : ''}
**Recommended Artists:**

${artistList}

*Based on your listening history and similar user preferences*`,
					},
				],
			}
		},
	)

	// get_weekly_chart_list - Get available weekly chart date ranges
	server.tool(
		'get_weekly_chart_list',
		'Get available weekly chart date ranges for user\'s listening history - REQUIRES AUTHENTICATION. Use this to find historical time periods for temporal queries like "when did I start listening to X".',
		{
			username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
		},
		async ({ username }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: requiresAuthMessage(getBaseUrl()) }] }
			}

			const effectiveUsername = username || session.username
			const data = await client.getWeeklyChartList(effectiveUsername)

			const charts = data.weeklychartlist.chart
			const chartList = charts
				.slice(-20)
				.reverse()
				.map((chart) => {
					const fromDate = new Date(parseInt(chart.from) * 1000).toLocaleDateString()
					const toDate = new Date(parseInt(chart.to) * 1000).toLocaleDateString()
					return `• ${fromDate} to ${toDate} (from: ${chart.from}, to: ${chart.to})`
				})
				.join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `📅 **Weekly Chart Periods for ${effectiveUsername}**

🗓️ **Available Date Ranges** (showing most recent 20):

${chartList}

💡 **Usage:** Use the 'from' and 'to' timestamps with \`get_weekly_artist_chart\` or \`get_weekly_track_chart\` to explore specific time periods.

📊 **Total periods available:** ${charts.length}

**Example:** To see what artists you were listening to during a specific week:
\`get_weekly_artist_chart\` with from: ${charts[charts.length - 1]?.from} and to: ${charts[charts.length - 1]?.to}`,
					},
				],
			}
		},
	)

	// get_weekly_artist_chart - Get artist listening data for a specific period
	server.tool(
		'get_weekly_artist_chart',
		'Get artist listening data for a specific time period - REQUIRES AUTHENTICATION. Perfect for temporal queries like "what artists was I into in 2023".',
		{
			username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
			from: z.number().optional().describe('Start timestamp (Unix timestamp) - get from weekly_chart_list'),
			to: z.number().optional().describe('End timestamp (Unix timestamp) - get from weekly_chart_list'),
		},
		async ({ username, from, to }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: requiresAuthMessage(getBaseUrl()) }] }
			}

			const effectiveUsername = username || session.username
			const data = await client.getWeeklyArtistChart(effectiveUsername, from, to)

			const artists = data.weeklyartistchart.artist
			const periodInfo =
				from && to ? `${new Date(from * 1000).toLocaleDateString()} to ${new Date(to * 1000).toLocaleDateString()}` : 'Most Recent Week'

			const artistList = artists
				.slice(0, 30)
				.map((artist, index) => `${index + 1}. ${artist.name} (${artist.playcount} plays)`)
				.join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `🎤 **Weekly Artist Chart for ${effectiveUsername}**
📅 **Period:** ${periodInfo}

${artistList}

📊 **Total artists in this period:** ${artists.length}
${artists.length > 30 ? '\n📝 **Note:** Showing top 30 artists only' : ''}

💡 **Tip:** Use \`get_weekly_chart_list\` to find other time periods to explore!`,
					},
				],
			}
		},
	)

	// get_weekly_track_chart - Get track listening data for a specific period
	server.tool(
		'get_weekly_track_chart',
		'Get track listening data for a specific time period - REQUIRES AUTHENTICATION. Perfect for temporal queries like "what songs was I obsessed with in summer 2023".',
		{
			username: z.string().optional().describe('Last.fm username (defaults to authenticated user)'),
			from: z.number().optional().describe('Start timestamp (Unix timestamp) - get from weekly_chart_list'),
			to: z.number().optional().describe('End timestamp (Unix timestamp) - get from weekly_chart_list'),
		},
		async ({ username, from, to }) => {
			const session = getSession()
			if (!session) {
				return { content: [{ type: 'text', text: requiresAuthMessage(getBaseUrl()) }] }
			}

			const effectiveUsername = username || session.username
			const data = await client.getWeeklyTrackChart(effectiveUsername, from, to)

			const tracks = data.weeklytrackchart.track
			const periodInfo =
				from && to ? `${new Date(from * 1000).toLocaleDateString()} to ${new Date(to * 1000).toLocaleDateString()}` : 'Most Recent Week'

			const trackList = tracks
				.slice(0, 30)
				.map((track, index) => `${index + 1}. ${track.artist['#text']} - ${track.name} (${track.playcount} plays)`)
				.join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `🎵 **Weekly Track Chart for ${effectiveUsername}**
📅 **Period:** ${periodInfo}

${trackList}

📊 **Total tracks in this period:** ${tracks.length}
${tracks.length > 30 ? '\n📝 **Note:** Showing top 30 tracks only' : ''}

💡 **Tip:** Use \`get_weekly_chart_list\` to find other time periods to explore!`,
					},
				],
			}
		},
	)
}

/**
 * Helper to generate authentication required message.
 */
function requiresAuthMessage(baseUrl: string): string {
	return `🔐 **Authentication Required**

This tool requires authentication with Last.fm. Please authenticate first:

1. Visit: ${baseUrl}/login
2. Sign in with your Last.fm account
3. Return here and try again

Use the \`lastfm_auth_status\` tool to check your current authentication status.`
}
