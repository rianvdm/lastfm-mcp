// ABOUTME: Public MCP tools that work without authentication using public Last.fm data.
// ABOUTME: Provides track/artist/album info, similar artist/track lookups, and server status.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { CachedLastfmClient } from '../../clients/cachedLastfm'
import { toolError } from './error-handler'

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
			return {
				content: [
					{
						type: 'text',
						text: `Pong! You said: ${echoMessage}`,
					},
				],
			}
		},
	)

	// server_info - Get server information
	server.tool('server_info', 'Get Last.fm MCP server information and available capabilities', {}, async () => {
		const baseUrl = getBaseUrl()
		const authUrl = `${baseUrl}/login`

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

To get started, authenticate at ${authUrl}`,
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

				return {
					content: [
						{
							type: 'text',
							text: `🎵 **Track Information**

**Track:** ${data.track.name}${loved}
**Artist:** ${data.track.artist['#text'] || (data.track.artist as unknown as { name: string }).name}
**Album:** ${data.track.album?.['#text'] || 'Unknown'}

**Stats:**
• Total plays: ${data.track.playcount}
• Total listeners: ${data.track.listeners}
${userStats}

**Tags:** ${tags}

${data.track.wiki?.summary ? `**Description:** ${data.track.wiki.summary.replace(/<[^>]*>/g, '')}` : ''}

${!username ? '*Note: Sign in to see your personal listening stats for this track*' : ''}`,
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

${!username ? '*Note: Sign in to see your personal listening stats for this artist*' : ''}`,
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

				return {
					content: [
						{
							type: 'text',
							text: `💿 **Album Information**

**Album:** ${data.album.name}
**Artist:** ${data.album.artist}

**Stats:**
• Total plays: ${data.album.playcount}
• Total listeners: ${data.album.listeners}
${userStats}

**Tags:** ${tags}

**Track Listing:**
${tracks}

${data.album.wiki?.summary ? `**Description:** ${data.album.wiki.summary.replace(/<[^>]*>/g, '')}` : ''}

${!username ? '*Note: Sign in to see your personal listening stats for this album*' : ''}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_album_info', error)
			}
		},
	)

	// get_similar_artists - Find similar artists
	server.tool(
		'get_similar_artists',
		'Find artists similar to any artist using Last.fm data - No authentication required',
		{
			artist: z.string().describe('Artist name'),
			limit: z.number().min(1).max(100).optional().default(30).describe('Number of similar artists to return (1-100)'),
		},
		async ({ artist, limit }) => {
			try {
				const data = await client.getSimilarArtists(artist, limit)

				const artists = data.similarartists.artist.slice(0, limit)
				const artistList = artists.map((a) => `• ${a.name} (${Math.round(parseFloat(a.match) * 100)}% match)`).join('\n')

				return {
					content: [
						{
							type: 'text',
							text: `🎤 **Artists Similar to ${artist}**

${artistList}`,
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
			limit: z.number().min(1).max(100).optional().default(30).describe('Number of similar tracks to return (1-100)'),
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

				return {
					content: [
						{
							type: 'text',
							text: `🎵 **Tracks Similar to ${track} by ${artist}**

${trackList}`,
						},
					],
				}
			} catch (error) {
				return toolError('get_similar_tracks', error)
			}
		},
	)
}
