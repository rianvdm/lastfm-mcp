// ABOUTME: Public MCP tools that work without authentication using public Last.fm data.
// ABOUTME: Provides track/artist/album info, similar artist/track lookups, and server status.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { CachedLastfmClient } from '../../clients/cachedLastfm'
import { buildNextSteps } from '../../utils/breadcrumb'
import { toolError } from './error-handler'
import { formatArtist } from './formatters'

/**
 * Register all public (non-authenticated) tools with the MCP server.
 */
export function registerPublicTools(server: McpServer, client: CachedLastfmClient, getBaseUrl: () => string): void {
	// ping - Test server connectivity
	server.tool(
		'ping',
		'Test Last.fm MCP server connectivity - Use this to verify the server is working',
		{
			message: z.string().optional().describe('Optional message to echo back'),
		},
		async ({ message }) => {
			const echoMessage = message || 'Hello from Last.fm MCP!'
			const nextSteps = buildNextSteps([
				{ tool: 'server_info', args: '', hint: 'see server version and feature list' },
				{ tool: 'lastfm_auth_status', args: '', hint: 'check whether you are authenticated for personal listening data' },
			])
			return {
				content: [
					{
						type: 'text',
						text: `Pong! You said: ${echoMessage}${nextSteps}`,
					},
				],
			}
		},
	)

	// server_info - Get server information
	server.tool('server_info', 'Get Last.fm MCP server information and available capabilities', {}, async () => {
		const baseUrl = getBaseUrl()
		const authUrl = `${baseUrl}/login`

		const nextSteps = buildNextSteps([
			{ tool: 'lastfm_auth_status', args: '', hint: 'check whether the current session is authenticated' },
			{ tool: 'ping', args: '', hint: 'test connectivity' },
		])

		return {
			content: [
				{
					type: 'text',
					text: `Last.fm MCP Server v1.0.0

Status: Running
Protocol: MCP 2024-11-05
Features:
- Resources: User Listening Data, Track/Artist/Album Info
- Authentication: Last.fm Web Auth
- Rate Limiting: Enabled

To get started, authenticate at ${authUrl}${nextSteps}`,
				},
			],
		}
	})

	// get_track_info - Get detailed track information (public data)
	server.tool(
		'get_track_info',
		'Get detailed Last.fm information about any track (artist, album, play count, tags, similar tracks) - No authentication required',
		{
			artist: z.string().describe('Artist name'),
			track: z.string().describe('Track name'),
			username: z.string().optional().describe('Last.fm username (optional, for user-specific data)'),
		},
		async ({ artist, track, username }) => {
			try {
				const data = await client.getTrackInfo(artist, track, username)

				const tags =
					data.track.toptags?.tag
						.slice(0, 5)
						.map((tag) => tag.name)
						.join(', ') || 'None'

				const userStats = username && data.track.userplaycount ? `• Your plays: ${data.track.userplaycount}` : ''
				const loved = data.track.userloved === '1' ? ' ❤️' : ''

				const trackArtist = data.track.artist['#text'] || (data.track.artist as unknown as { name: string }).name
				const nextSteps = buildNextSteps([
					{ tool: 'get_similar_tracks', args: `artist="${trackArtist}", track="${data.track.name}"`, hint: 'find more like this track' },
					{ tool: 'get_artist_info', args: `artist="${trackArtist}"`, hint: 'pull bio, tags, and similar artists' },
					{ tool: 'get_album_info', args: `artist="${trackArtist}", album="${data.track.album?.['#text'] || ''}"`, hint: 'pull tracklist and album-level stats' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `🎵 **Track Information**

**Track:** ${data.track.name}${loved}
**Artist:** ${trackArtist}
**Album:** ${data.track.album?.['#text'] || 'Unknown'}

**Stats:**
• Total plays: ${data.track.playcount}
• Total listeners: ${data.track.listeners}
${userStats}

**Tags:** ${tags}

${data.track.wiki?.summary ? `**Description:** ${data.track.wiki.summary.replace(/<[^>]*>/g, '')}` : ''}

${!username ? '*Note: Sign in to see your personal listening stats for this track*' : ''}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_track_info', error)
			}
		},
	)

	// get_artist_info - Get detailed artist information (public data)
	server.tool(
		'get_artist_info',
		'Get detailed Last.fm information about any artist (biography, tags, similar artists, top tracks) - No authentication required',
		{
			artist: z.string().describe('Artist name'),
			username: z.string().optional().describe('Last.fm username (optional, for user-specific data)'),
		},
		async ({ artist, username }) => {
			try {
				const data = await client.getArtistInfo(artist, username)

				const tags =
					data.artist.tags?.tag
						.slice(0, 5)
						.map((tag) => tag.name)
						.join(', ') || 'None'
				const similar =
					data.artist.similar?.artist
						.slice(0, 5)
						.map((a) => a.name)
						.join(', ') || 'None'
				const userStats = username && data.artist.stats.userplaycount ? `• Your plays: ${data.artist.stats.userplaycount}` : ''

				const nextSteps = buildNextSteps([
					{ tool: 'get_artist_top_tracks', args: `artist="${data.artist.name}"`, hint: 'see this artist\'s most-played tracks' },
					{ tool: 'get_artist_top_albums', args: `artist="${data.artist.name}"`, hint: 'see this artist\'s most-played albums' },
					{ tool: 'get_similar_artists', args: `artist="${data.artist.name}"`, hint: 'find similar artists' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `🎤 **Artist Information**

**Artist:** ${data.artist.name}

**Stats:**
• Total plays: ${data.artist.stats.playcount}
• Total listeners: ${data.artist.stats.listeners}
${userStats}

**Tags:** ${tags}
**Similar Artists:** ${similar}

${data.artist.bio?.summary ? `**Bio:** ${data.artist.bio.summary.replace(/<[^>]*>/g, '')}` : ''}

${!username ? '*Note: Sign in to see your personal listening stats for this artist*' : ''}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_artist_info', error)
			}
		},
	)

	// get_album_info - Get detailed album information (public data)
	server.tool(
		'get_album_info',
		'Get detailed Last.fm information about any album (track listing, tags, play counts) - No authentication required',
		{
			artist: z.string().describe('Artist name'),
			album: z.string().describe('Album name'),
			username: z.string().optional().describe('Last.fm username (optional, for user-specific data)'),
		},
		async ({ artist, album, username }) => {
			try {
				const data = await client.getAlbumInfo(artist, album, username)

				const tags =
					data.album.tags?.tag
						.slice(0, 5)
						.map((tag) => tag.name)
						.join(', ') || 'None'
				const tracks =
					data.album.tracks?.track
						.slice(0, 10)
						.map((track, i) => `${i + 1}. ${track.name}`)
						.join('\n') || 'Track listing not available'
				const userStats = username && data.album.userplaycount ? `• Your plays: ${data.album.userplaycount}` : ''

				const albumArtist = formatArtist(data.album.artist)
				const nextSteps = buildNextSteps([
					{ tool: 'get_artist_info', args: `artist="${albumArtist}"`, hint: 'pull bio, tags, and similar artists' },
					{ tool: 'get_artist_top_albums', args: `artist="${albumArtist}"`, hint: 'see what else is canonical from this artist' },
					{ tool: 'get_track_info', args: `artist="${albumArtist}", track="<TRACK NAME>"`, hint: 'expand a track from the listing above' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `💿 **Album Information**

**Album:** ${data.album.name}
**Artist:** ${albumArtist}

**Stats:**
• Total plays: ${data.album.playcount}
• Total listeners: ${data.album.listeners}
${userStats}

**Tags:** ${tags}

**Track Listing:**
${tracks}

${data.album.wiki?.summary ? `**Description:** ${data.album.wiki.summary.replace(/<[^>]*>/g, '')}` : ''}

${!username ? '*Note: Sign in to see your personal listening stats for this album*' : ''}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_album_info', error)
			}
		},
	)

	// get_artist_top_tracks - An artist's globally most-played tracks
	server.tool(
		'get_artist_top_tracks',
		"Get an artist's globally most-played tracks on Last.fm (not user-specific) - No authentication required. Useful for finding canonical / signature songs by an artist.",
		{
			artist: z.string().describe('Artist name'),
			limit: z.coerce.number().min(1).max(50).optional().default(10).describe('Number of tracks to return (1-50)'),
			mbid: z.string().optional().describe('MusicBrainz ID of the artist (optional, more reliable than name)'),
		},
		async ({ artist, limit, mbid }) => {
			try {
				const data = await client.getArtistTopTracks(artist, limit, mbid)

				const tracks = data.toptracks.track.slice(0, limit)
				const trackList = tracks
					.map((track, index) => `${index + 1}. ${track.name} (${track.playcount} plays, ${track.listeners} listeners)`)
					.join('\n')

				const nextSteps = buildNextSteps([
					{ tool: 'get_track_info', args: `artist="${artist}", track="<TRACK NAME>"`, hint: 'expand one of these tracks' },
					{ tool: 'get_similar_tracks', args: `artist="${artist}", track="<TRACK NAME>"`, hint: 'find more like a specific track' },
					{ tool: 'get_artist_top_albums', args: `artist="${artist}"`, hint: 'pivot to canonical albums by this artist' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `🎵 **Top Tracks by ${artist}**

${trackList}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_artist_top_tracks', error)
			}
		},
	)

	// get_artist_top_albums - An artist's globally most-played albums
	server.tool(
		'get_artist_top_albums',
		"Get an artist's globally most-played albums on Last.fm (not user-specific) - No authentication required. Useful for finding the canonical record by an artist.",
		{
			artist: z.string().describe('Artist name'),
			limit: z.coerce.number().min(1).max(50).optional().default(10).describe('Number of albums to return (1-50)'),
			mbid: z.string().optional().describe('MusicBrainz ID of the artist (optional, more reliable than name)'),
		},
		async ({ artist, limit, mbid }) => {
			try {
				const data = await client.getArtistTopAlbums(artist, limit, mbid)

				const albums = data.topalbums.album.slice(0, limit)
				const albumList = albums.map((album, index) => `${index + 1}. ${album.name} (${album.playcount} plays)`).join('\n')

				const nextSteps = buildNextSteps([
					{ tool: 'get_album_info', args: `artist="${artist}", album="<ALBUM NAME>"`, hint: 'pull tracklist and stats for one of these albums' },
					{ tool: 'get_artist_top_tracks', args: `artist="${artist}"`, hint: 'pivot to canonical tracks by this artist' },
					{ tool: 'get_similar_artists', args: `artist="${artist}"`, hint: 'find similar artists' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `💿 **Top Albums by ${artist}**

${albumList}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_artist_top_albums', error)
			}
		},
	)

	// get_similar_artists - Find similar artists
	server.tool(
		'get_similar_artists',
		'Find artists similar to any artist using Last.fm data - No authentication required',
		{
			artist: z.string().describe('Artist name'),
			limit: z.coerce.number().min(1).max(100).optional().default(30).describe('Number of similar artists to return (1-100)'),
		},
		async ({ artist, limit }) => {
			try {
				const data = await client.getSimilarArtists(artist, limit)

				const artists = data.similarartists.artist.slice(0, limit)
				const artistList = artists.map((a) => `• ${a.name} (${Math.round(parseFloat(a.match) * 100)}% match)`).join('\n')

				const topSimilar = artists[0]?.name
				const nextSteps = buildNextSteps([
					topSimilar
						? { tool: 'get_artist_info', args: `artist=${JSON.stringify(topSimilar)}`, hint: 'expand the closest match' }
						: { tool: 'get_artist_info', args: 'artist="<NAME FROM LIST>"', hint: 'expand one of the similar artists' },
					{ tool: 'get_artist_top_tracks', args: 'artist="<NAME FROM LIST>"', hint: 'jump straight to canonical tracks for one of them' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `🎤 **Artists Similar to ${artist}**

${artistList}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_similar_artists', error)
			}
		},
	)

	// get_similar_tracks - Find similar tracks
	server.tool(
		'get_similar_tracks',
		'Find tracks similar to any track using Last.fm data - No authentication required',
		{
			artist: z.string().describe('Artist name'),
			track: z.string().describe('Track name'),
			limit: z.coerce.number().min(1).max(100).optional().default(30).describe('Number of similar tracks to return (1-100)'),
		},
		async ({ artist, track, limit }) => {
			try {
				const data = await client.getSimilarTracks(artist, track, limit)

				const tracks = data.similartracks.track.slice(0, limit)
				const trackList = tracks
					.map((t) => {
						const album = t.album?.['#text'] ? ` [${t.album['#text']}]` : ''
						return `• ${t.artist['#text'] || (t.artist as unknown as { name: string }).name} - ${t.name}${album} (${Math.round(parseFloat(t.match) * 100)}% match)`
					})
					.join('\n')

				const nextSteps = buildNextSteps([
					{ tool: 'get_track_info', args: 'artist="<ARTIST FROM LIST>", track="<TRACK FROM LIST>"', hint: 'expand one of the similar tracks' },
					{ tool: 'get_artist_info', args: 'artist="<ARTIST FROM LIST>"', hint: 'pivot to one of the artists from the list' },
				])

				return {
					content: [
						{
							type: 'text',
							text: `🎵 **Tracks Similar to ${track} by ${artist}**

${trackList}${nextSteps}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_similar_tracks', error)
			}
		},
	)
}
