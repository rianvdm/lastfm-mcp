/**
 * Last.fm MCP Resources
 *
 * Resource templates for accessing Last.fm data via MCP resource URIs.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'

import { CachedLastfmClient } from '../../clients/cachedLastfm'
import type { AuthSession } from '../tools/authenticated'

/**
 * Register all Last.fm resources with the MCP server.
 */
export function registerResources(
	server: McpServer,
	client: CachedLastfmClient,
	getSession: () => AuthSession | null,
): void {
	// User recent tracks resource
	server.resource(
		'user-recent-tracks',
		new ResourceTemplate('lastfm://user/{username}/recent', {
			list: async () => {
				const session = getSession()
				if (!session) return { resources: [] }
				return {
					resources: [
						{
							uri: `lastfm://user/${session.username}/recent`,
							name: `${session.username}'s Recent Tracks`,
							description: 'Recently played tracks with timestamps',
							mimeType: 'application/json',
						},
					],
				}
			},
		}),
		async (uri) => {
			const match = uri.href.match(/lastfm:\/\/user\/([^/]+)\/recent/)
			if (!match) throw new Error('Invalid URI')
			const username = decodeURIComponent(match[1])
			const data = await client.getRecentTracks(username, 50)
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: 'application/json',
						text: JSON.stringify(data, null, 2),
					},
				],
			}
		},
	)

	// User top artists resource
	server.resource(
		'user-top-artists',
		new ResourceTemplate('lastfm://user/{username}/top-artists', {
			list: async () => {
				const session = getSession()
				if (!session) return { resources: [] }
				return {
					resources: [
						{
							uri: `lastfm://user/${session.username}/top-artists`,
							name: `${session.username}'s Top Artists`,
							description: 'Most played artists by time period',
							mimeType: 'application/json',
						},
					],
				}
			},
		}),
		async (uri) => {
			const match = uri.href.match(/lastfm:\/\/user\/([^/]+)\/top-artists/)
			if (!match) throw new Error('Invalid URI')
			const username = decodeURIComponent(match[1])
			const data = await client.getTopArtists(username, 'overall', 50)
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: 'application/json',
						text: JSON.stringify(data, null, 2),
					},
				],
			}
		},
	)

	// User top albums resource
	server.resource(
		'user-top-albums',
		new ResourceTemplate('lastfm://user/{username}/top-albums', {
			list: async () => {
				const session = getSession()
				if (!session) return { resources: [] }
				return {
					resources: [
						{
							uri: `lastfm://user/${session.username}/top-albums`,
							name: `${session.username}'s Top Albums`,
							description: 'Most played albums by time period',
							mimeType: 'application/json',
						},
					],
				}
			},
		}),
		async (uri) => {
			const match = uri.href.match(/lastfm:\/\/user\/([^/]+)\/top-albums/)
			if (!match) throw new Error('Invalid URI')
			const username = decodeURIComponent(match[1])
			const data = await client.getTopAlbums(username, 'overall', 50)
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: 'application/json',
						text: JSON.stringify(data, null, 2),
					},
				],
			}
		},
	)

	// User loved tracks resource
	server.resource(
		'user-loved-tracks',
		new ResourceTemplate('lastfm://user/{username}/loved', {
			list: async () => {
				const session = getSession()
				if (!session) return { resources: [] }
				return {
					resources: [
						{
							uri: `lastfm://user/${session.username}/loved`,
							name: `${session.username}'s Loved Tracks`,
							description: 'Tracks marked as favorites',
							mimeType: 'application/json',
						},
					],
				}
			},
		}),
		async (uri) => {
			const match = uri.href.match(/lastfm:\/\/user\/([^/]+)\/loved/)
			if (!match) throw new Error('Invalid URI')
			const username = decodeURIComponent(match[1])
			const data = await client.getLovedTracks(username, 50)
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: 'application/json',
						text: JSON.stringify(data, null, 2),
					},
				],
			}
		},
	)

	// User profile resource
	server.resource(
		'user-profile',
		new ResourceTemplate('lastfm://user/{username}/profile', {
			list: async () => {
				const session = getSession()
				if (!session) return { resources: [] }
				return {
					resources: [
						{
							uri: `lastfm://user/${session.username}/profile`,
							name: `${session.username}'s Profile`,
							description: 'User profile and statistics',
							mimeType: 'application/json',
						},
					],
				}
			},
		}),
		async (uri) => {
			const match = uri.href.match(/lastfm:\/\/user\/([^/]+)\/profile/)
			if (!match) throw new Error('Invalid URI')
			const username = decodeURIComponent(match[1])
			const data = await client.getUserInfo(username)
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: 'application/json',
						text: JSON.stringify(data, null, 2),
					},
				],
			}
		},
	)

	// Track info resource
	server.resource(
		'track-info',
		new ResourceTemplate('lastfm://track/{artist}/{track}', { list: undefined }),
		async (uri) => {
			const match = uri.href.match(/lastfm:\/\/track\/([^/]+)\/([^/]+)$/)
			if (!match) throw new Error('Invalid URI')
			const artist = decodeURIComponent(match[1])
			const track = decodeURIComponent(match[2])
			const session = getSession()
			const data = await client.getTrackInfo(artist, track, session?.username)
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: 'application/json',
						text: JSON.stringify(data, null, 2),
					},
				],
			}
		},
	)

	// Artist info resource
	server.resource(
		'artist-info',
		new ResourceTemplate('lastfm://artist/{artist}', { list: undefined }),
		async (uri) => {
			const match = uri.href.match(/lastfm:\/\/artist\/([^/]+)$/)
			if (!match) throw new Error('Invalid URI')
			const artist = decodeURIComponent(match[1])
			const session = getSession()
			const data = await client.getArtistInfo(artist, session?.username)
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: 'application/json',
						text: JSON.stringify(data, null, 2),
					},
				],
			}
		},
	)

	// Album info resource
	server.resource(
		'album-info',
		new ResourceTemplate('lastfm://album/{artist}/{album}', { list: undefined }),
		async (uri) => {
			const match = uri.href.match(/lastfm:\/\/album\/([^/]+)\/([^/]+)/)
			if (!match) throw new Error('Invalid URI')
			const artist = decodeURIComponent(match[1])
			const album = decodeURIComponent(match[2])
			const session = getSession()
			const data = await client.getAlbumInfo(artist, album, session?.username)
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: 'application/json',
						text: JSON.stringify(data, null, 2),
					},
				],
			}
		},
	)

	// Similar artists resource
	server.resource(
		'similar-artists',
		new ResourceTemplate('lastfm://artist/{artist}/similar', { list: undefined }),
		async (uri) => {
			const match = uri.href.match(/lastfm:\/\/artist\/([^/]+)\/similar/)
			if (!match) throw new Error('Invalid URI')
			const artist = decodeURIComponent(match[1])
			const data = await client.getSimilarArtists(artist, 30)
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: 'application/json',
						text: JSON.stringify(data, null, 2),
					},
				],
			}
		},
	)

	// Similar tracks resource
	server.resource(
		'similar-tracks',
		new ResourceTemplate('lastfm://track/{artist}/{track}/similar', { list: undefined }),
		async (uri) => {
			const match = uri.href.match(/lastfm:\/\/track\/([^/]+)\/([^/]+)\/similar/)
			if (!match) throw new Error('Invalid URI')
			const artist = decodeURIComponent(match[1])
			const track = decodeURIComponent(match[2])
			const data = await client.getSimilarTracks(artist, track, 30)
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: 'application/json',
						text: JSON.stringify(data, null, 2),
					},
				],
			}
		},
	)
}
