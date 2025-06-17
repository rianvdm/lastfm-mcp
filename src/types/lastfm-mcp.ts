/**
 * Last.fm MCP Server Type Definitions
 * Defines resources, tools, and prompts for Last.fm data access
 */

import { Resource, Prompt } from './mcp'

// Last.fm MCP Resource Definitions
export const LASTFM_RESOURCES: Resource[] = [
	{
		uri: 'lastfm://user/{username}/recent',
		name: 'Recent Tracks',
		description: "User's recently played tracks with timestamps and metadata",
		mimeType: 'application/json',
	},
	{
		uri: 'lastfm://user/{username}/top-artists',
		name: 'Top Artists',
		description: "User's most played artists by time period",
		mimeType: 'application/json',
	},
	{
		uri: 'lastfm://user/{username}/top-albums',
		name: 'Top Albums',
		description: "User's most played albums by time period",
		mimeType: 'application/json',
	},
	{
		uri: 'lastfm://user/{username}/loved',
		name: 'Loved Tracks',
		description: "User's loved/favorite tracks",
		mimeType: 'application/json',
	},
	{
		uri: 'lastfm://user/{username}/profile',
		name: 'User Profile',
		description: 'User profile information and listening statistics',
		mimeType: 'application/json',
	},
	{
		uri: 'lastfm://track/{artist}/{track}',
		name: 'Track Information',
		description: 'Detailed information about a specific track',
		mimeType: 'application/json',
	},
	{
		uri: 'lastfm://artist/{artist}',
		name: 'Artist Information',
		description: 'Detailed information about a specific artist',
		mimeType: 'application/json',
	},
	{
		uri: 'lastfm://album/{artist}/{album}',
		name: 'Album Information',
		description: 'Detailed information about a specific album',
		mimeType: 'application/json',
	},
	{
		uri: 'lastfm://artist/{artist}/similar',
		name: 'Similar Artists',
		description: 'Artists similar to the specified artist with similarity scores',
		mimeType: 'application/json',
	},
	{
		uri: 'lastfm://track/{artist}/{track}/similar',
		name: 'Similar Tracks',
		description: 'Tracks similar to the specified track with similarity scores',
		mimeType: 'application/json',
	},
]

// Last.fm MCP Tool Definitions
export interface LastfmTool {
	name: string
	description: string
	inputSchema: {
		type: 'object'
		properties: Record<
			string,
			{
				type: string
				description: string
				enum?: string[]
				minimum?: number
				maximum?: number
			}
		>
		required: string[]
	}
}

export const LASTFM_TOOLS: LastfmTool[] = [
	{
		name: 'ping',
		description: 'Test server connectivity',
		inputSchema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					description: 'Optional message to echo back',
				},
			},
			required: [],
		},
	},
	{
		name: 'server_info',
		description: 'Get server information and capabilities',
		inputSchema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
	{
		name: 'lastfm_auth_status',
		description: 'Check Last.fm authentication status',
		inputSchema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
	{
		name: 'get_recent_tracks',
		description: "Get user's recently played tracks with pagination support",
		inputSchema: {
			type: 'object',
			properties: {
				username: {
					type: 'string',
					description: 'Last.fm username',
				},
				limit: {
					type: 'number',
					description: 'Number of tracks to return per page (1-1000)',
					minimum: 1,
					maximum: 1000,
				},
				page: {
					type: 'number',
					description: 'Page number for pagination (starts at 1)',
					minimum: 1,
				},
				from: {
					type: 'number',
					description: 'Start timestamp (Unix timestamp)',
				},
				to: {
					type: 'number',
					description: 'End timestamp (Unix timestamp)',
				},
			},
			required: ['username'],
		},
	},
	{
		name: 'get_top_artists',
		description: "Get user's top artists by time period",
		inputSchema: {
			type: 'object',
			properties: {
				username: {
					type: 'string',
					description: 'Last.fm username',
				},
				period: {
					type: 'string',
					description: 'Time period for top artists',
					enum: ['7day', '1month', '3month', '6month', '12month', 'overall'],
				},
				limit: {
					type: 'number',
					description: 'Number of artists to return (1-1000)',
					minimum: 1,
					maximum: 1000,
				},
			},
			required: ['username'],
		},
	},
	{
		name: 'get_top_albums',
		description: "Get user's top albums by time period",
		inputSchema: {
			type: 'object',
			properties: {
				username: {
					type: 'string',
					description: 'Last.fm username',
				},
				period: {
					type: 'string',
					description: 'Time period for top albums',
					enum: ['7day', '1month', '3month', '6month', '12month', 'overall'],
				},
				limit: {
					type: 'number',
					description: 'Number of albums to return (1-1000)',
					minimum: 1,
					maximum: 1000,
				},
			},
			required: ['username'],
		},
	},
	{
		name: 'get_loved_tracks',
		description: "Get user's loved/favorite tracks",
		inputSchema: {
			type: 'object',
			properties: {
				username: {
					type: 'string',
					description: 'Last.fm username',
				},
				limit: {
					type: 'number',
					description: 'Number of tracks to return (1-1000)',
					minimum: 1,
					maximum: 1000,
				},
			},
			required: ['username'],
		},
	},
	{
		name: 'get_track_info',
		description: 'Get detailed information about a specific track',
		inputSchema: {
			type: 'object',
			properties: {
				artist: {
					type: 'string',
					description: 'Artist name',
				},
				track: {
					type: 'string',
					description: 'Track name',
				},
				username: {
					type: 'string',
					description: 'Last.fm username (optional, for user-specific data)',
				},
			},
			required: ['artist', 'track'],
		},
	},
	{
		name: 'get_artist_info',
		description: 'Get detailed information about an artist',
		inputSchema: {
			type: 'object',
			properties: {
				artist: {
					type: 'string',
					description: 'Artist name',
				},
				username: {
					type: 'string',
					description: 'Last.fm username (optional, for user-specific data)',
				},
			},
			required: ['artist'],
		},
	},
	{
		name: 'get_album_info',
		description: 'Get detailed information about a specific album',
		inputSchema: {
			type: 'object',
			properties: {
				artist: {
					type: 'string',
					description: 'Artist name',
				},
				album: {
					type: 'string',
					description: 'Album name',
				},
				username: {
					type: 'string',
					description: 'Last.fm username (optional, for user-specific data)',
				},
			},
			required: ['artist', 'album'],
		},
	},
	{
		name: 'get_user_info',
		description: 'Get user profile information and statistics',
		inputSchema: {
			type: 'object',
			properties: {
				username: {
					type: 'string',
					description: 'Last.fm username',
				},
			},
			required: ['username'],
		},
	},
	{
		name: 'get_similar_artists',
		description: 'Get artists similar to a specified artist',
		inputSchema: {
			type: 'object',
			properties: {
				artist: {
					type: 'string',
					description: 'Artist name',
				},
				limit: {
					type: 'number',
					description: 'Number of similar artists to return (1-100)',
					minimum: 1,
					maximum: 100,
				},
			},
			required: ['artist'],
		},
	},
	{
		name: 'get_similar_tracks',
		description: 'Get tracks similar to a specified track',
		inputSchema: {
			type: 'object',
			properties: {
				artist: {
					type: 'string',
					description: 'Artist name',
				},
				track: {
					type: 'string',
					description: 'Track name',
				},
				limit: {
					type: 'number',
					description: 'Number of similar tracks to return (1-100)',
					minimum: 1,
					maximum: 100,
				},
			},
			required: ['artist', 'track'],
		},
	},
	{
		name: 'get_listening_stats',
		description: 'Get comprehensive listening statistics for a user',
		inputSchema: {
			type: 'object',
			properties: {
				username: {
					type: 'string',
					description: 'Last.fm username',
				},
				period: {
					type: 'string',
					description: 'Time period for statistics',
					enum: ['7day', '1month', '3month', '6month', '12month', 'overall'],
				},
			},
			required: ['username'],
		},
	},
	{
		name: 'get_music_recommendations',
		description: 'Get music recommendations based on listening history',
		inputSchema: {
			type: 'object',
			properties: {
				username: {
					type: 'string',
					description: 'Last.fm username',
				},
				limit: {
					type: 'number',
					description: 'Number of recommendations to return (1-50)',
					minimum: 1,
					maximum: 50,
				},
				genre: {
					type: 'string',
					description: 'Optional genre filter for recommendations',
				},
			},
			required: ['username'],
		},
	},
]

// Last.fm MCP Prompt Definitions
export const LASTFM_PROMPTS: Prompt[] = [
	{
		name: 'listening_insights',
		description: "Get insights about user's listening habits and patterns",
		arguments: [
			{
				name: 'username',
				description: 'Last.fm username to analyze',
				required: true,
			},
			{
				name: 'period',
				description: 'Time period for analysis (7day, 1month, 3month, 6month, 12month, overall)',
				required: false,
			},
		],
	},
	{
		name: 'music_discovery',
		description: 'Discover new music based on listening history',
		arguments: [
			{
				name: 'username',
				description: 'Last.fm username for personalized recommendations',
				required: true,
			},
			{
				name: 'genre',
				description: 'Optional genre preference for recommendations',
				required: false,
			},
		],
	},
	{
		name: 'track_analysis',
		description: 'Get detailed analysis of a specific track',
		arguments: [
			{
				name: 'artist',
				description: 'Artist name',
				required: true,
			},
			{
				name: 'track',
				description: 'Track name',
				required: true,
			},
		],
	},
	{
		name: 'album_analysis',
		description: 'Get detailed analysis of a specific album',
		arguments: [
			{
				name: 'artist',
				description: 'Artist name',
				required: true,
			},
			{
				name: 'album',
				description: 'Album name',
				required: true,
			},
		],
	},
	{
		name: 'artist_analysis',
		description: 'Get detailed analysis of a specific artist',
		arguments: [
			{
				name: 'artist',
				description: 'Artist name',
				required: true,
			},
		],
	},
	{
		name: 'listening_habits',
		description: "Analyze and summarize user's listening habits",
		arguments: [
			{
				name: 'username',
				description: 'Last.fm username to analyze',
				required: true,
			},
			{
				name: 'timeframe',
				description: 'Optional timeframe for analysis (recent, historical, comparative)',
				required: false,
			},
		],
	},
]

// Helper functions for URI parsing
export function parseLastfmUri(uri: string): {
	type: 'user' | 'track' | 'artist' | 'album'
	username?: string
	artist?: string
	track?: string
	album?: string
	subtype?: string
} | null {
	if (!uri.startsWith('lastfm://')) {
		return null
	}

	const path = uri.replace('lastfm://', '')
	const parts = path.split('/')

	if (parts[0] === 'user' && parts.length >= 3) {
		const username = decodeURIComponent(parts[1])
		const subtype = parts[2]
		return { type: 'user', username, subtype }
	}

	if (parts[0] === 'track' && parts.length >= 3) {
		const artist = decodeURIComponent(parts[1])
		const track = decodeURIComponent(parts[2])
		const subtype = parts[3] // 'similar' if present
		return { type: 'track', artist, track, subtype }
	}

	if (parts[0] === 'artist' && parts.length >= 2) {
		const artist = decodeURIComponent(parts[1])
		const subtype = parts[2] // 'similar' if present
		return { type: 'artist', artist, subtype }
	}

	if (parts[0] === 'album' && parts.length >= 3) {
		const artist = decodeURIComponent(parts[1])
		const album = decodeURIComponent(parts[2])
		return { type: 'album', artist, album }
	}

	return null
}

// Tool call result content types
export interface ToolCallResult {
	content: Array<{
		type: 'text'
		text: string
	}>
	isError?: boolean
}
