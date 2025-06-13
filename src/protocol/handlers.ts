/**
 * MCP Protocol Handlers
 * Implements the core MCP methods
 */

import { JSONRPCRequest, hasId, mapErrorToJSONRPC, MCPErrorCode, ErrorCode } from '../types/jsonrpc'
import { createResponse, createError, createMethodNotFoundError } from './parser'
import {
	InitializeResult,
	PROTOCOL_VERSION,
	SERVER_INFO,
	DEFAULT_CAPABILITIES,
	ResourcesListResult,
	ResourcesReadResult,
	PromptsListParams,
	PromptsListResult,
	PromptsGetResult,
} from '../types/mcp'
import type { Env } from '../types/env'
import {
	validateJSONRPCMessage,
	validateProtocolFlow,
	validateInitializeParams,
	validateResourcesReadParams,
	validatePromptsGetParams,
	validateToolArguments,
	validateJSONRPCResponse,
	markInitialized,
	ValidationError,
} from './validation'
import { verifySessionToken, SessionPayload } from '../auth/jwt'
import { LastfmClient } from '../clients/lastfm'
import { CachedLastfmClient } from '../clients/cachedLastfm'
import { LASTFM_RESOURCES, LASTFM_TOOLS, LASTFM_PROMPTS, parseLastfmUri } from '../types/lastfm-mcp'
import { isConnectionAuthenticated } from '../transport/sse'

/**
 * Get cached Last.fm client instance
 */
function getCachedLastfmClient(env?: Env): CachedLastfmClient | null {
	if (!env?.LASTFM_API_KEY) {
		console.warn('No Last.fm API key available', { hasEnv: !!env, hasApiKey: !!env?.LASTFM_API_KEY })
		return null
	}
	
	const client = new LastfmClient(env.LASTFM_API_KEY)
	return new CachedLastfmClient(client, env?.MCP_SESSIONS)
}

/**
 * Extract and verify session token from request
 */
export async function verifyAuthentication(request: Request, jwtSecret: string): Promise<SessionPayload | null> {
	try {
		// Get session cookie
		const cookieHeader = request.headers.get('Cookie')
		if (!cookieHeader) {
			return null
		}

		// Parse cookies
		const cookies = cookieHeader.split(';').reduce(
			(acc, cookie) => {
				const [key, value] = cookie.trim().split('=')
				if (key && value) {
					acc[key] = value
				}
				return acc
			},
			{} as Record<string, string>,
		)

		const sessionToken = cookies.session
		if (!sessionToken) {
			return null
		}

		// Verify JWT token
		return await verifySessionToken(sessionToken, jwtSecret)
	} catch (error) {
		console.error('Authentication verification error:', error)
		return null
	}
}

/**
 * Get connection-specific authentication session
 */
async function getConnectionSession(request: Request, jwtSecret: string, env?: Env): Promise<SessionPayload | null> {
	// First try standard authentication via cookie
	const cookieSession = await verifyAuthentication(request, jwtSecret)
	if (cookieSession) {
		return cookieSession
	}

	// Try connection-specific authentication only if we have a connection ID and KV storage
	const connectionId = request.headers.get('X-Connection-ID')
	if (!connectionId || !env?.MCP_SESSIONS) {
		// No connection ID or KV storage, but cookie auth failed, so return null
		return null
	}

	// For mcp-remote connections, skip the SSE connection check
	// mcp-remote uses deterministic connection IDs and doesn't establish SSE connections
	if (!connectionId.startsWith('mcp-remote-')) {
		// Check if SSE connection is authenticated
		if (!isConnectionAuthenticated(connectionId)) {
			return null
		}
	}

	try {
		// Try to get connection-specific session from KV storage
		const sessionDataStr = await env.MCP_SESSIONS.get(`session:${connectionId}`)
		if (!sessionDataStr) {
			return null
		}

		const sessionData = JSON.parse(sessionDataStr)
		
		// Verify the stored session is still valid
		if (!sessionData.expiresAt || new Date(sessionData.expiresAt) <= new Date()) {
			console.log('Connection session has expired')
			return null
		}

		// Return session payload
		return {
			userId: sessionData.userId,
			sessionKey: sessionData.sessionKey,
			username: sessionData.username,
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(new Date(sessionData.expiresAt).getTime() / 1000),
		}
	} catch (error) {
		console.error('Error retrieving connection session:', error)
		return null
	}
}

/**
 * Generate authentication instructions for unauthenticated requests
 */
function generateAuthInstructions(request: Request): string {
	const connectionId = request.headers.get('X-Connection-ID')
	const baseUrl = 'https://lastfm-mcp-prod.rian-db8.workers.dev'
	
	if (connectionId) {
		// Connection-specific auth instructions
		return `visit ${baseUrl}/login?connection_id=${connectionId} to authenticate with your Last.fm account`
	} else {
		// Generic auth instructions
		return `visit ${baseUrl}/login to authenticate with Last.fm`
	}
}

/**
 * Handle initialize request
 */
export function handleInitialize(params: unknown): InitializeResult {
	// Validate params using comprehensive validation
	validateInitializeParams(params)

	// Check protocol version compatibility
	// For now, we accept any version but return our version
	console.log(`Client protocol version: ${params.protocolVersion}`)
	console.log(`Client info: ${params.clientInfo.name} v${params.clientInfo.version}`)

	// Mark as initialized in both places (idempotent operation)
	markInitialized()

	// Return server capabilities
	const result = {
		protocolVersion: PROTOCOL_VERSION,
		capabilities: DEFAULT_CAPABILITIES,
		serverInfo: SERVER_INFO,
	}

	// Validate our own response
	try {
		validateJSONRPCResponse({
			jsonrpc: '2.0',
			id: 1, // dummy ID for validation
			result,
		})
	} catch (error) {
		console.error('Invalid initialize result:', error)
		throw new Error('Internal error: Invalid initialize result')
	}

	return result
}

/**
 * Handle initialized notification
 */
export function handleInitialized(): void {
	console.log('Client sent initialized notification')
	// No response needed for notifications
}

/**
 * Handle resources/list request
 */
export function handleResourcesList(): ResourcesListResult {
	return { resources: LASTFM_RESOURCES }
}

/**
 * Handle resources/read request
 */
export async function handleResourcesRead(params: unknown, session: SessionPayload, env?: Env): Promise<ResourcesReadResult> {
	// Validate params using comprehensive validation
	validateResourcesReadParams(params)

	const { uri } = params

	try {
		// Get cached Last.fm client instance
		const client = getCachedLastfmClient(env)
		if (!client) {
			throw new Error('Last.fm API client not available')
		}

		// Parse the Last.fm URI to determine what resource is being requested
		const parsedUri = parseLastfmUri(uri)
		if (!parsedUri) {
			throw new Error(`Invalid Last.fm URI format: ${uri}`)
		}

		let data: unknown

		switch (parsedUri.type) {
			case 'user': {
				if (!parsedUri.username) {
					throw new Error('Username is required for user resources')
				}

				switch (parsedUri.subtype) {
					case 'recent':
						data = await client.getRecentTracks(parsedUri.username, 50)
						break
					case 'top-artists':
						data = await client.getTopArtists(parsedUri.username, 'overall', 50)
						break
					case 'top-albums':
						data = await client.getTopAlbums(parsedUri.username, 'overall', 50)
						break
					case 'loved':
						data = await client.getLovedTracks(parsedUri.username, 50)
						break
					case 'profile':
						data = await client.getUserInfo(parsedUri.username)
						break
					default:
						throw new Error(`Unsupported user resource subtype: ${parsedUri.subtype}`)
				}
				break
			}

			case 'track': {
				if (!parsedUri.artist || !parsedUri.track) {
					throw new Error('Artist and track names are required for track resources')
				}

				if (parsedUri.subtype === 'similar') {
					data = await client.getSimilarTracks(parsedUri.artist, parsedUri.track, 30)
				} else {
					data = await client.getTrackInfo(parsedUri.artist, parsedUri.track, session.username)
				}
				break
			}

			case 'artist': {
				if (!parsedUri.artist) {
					throw new Error('Artist name is required for artist resources')
				}

				if (parsedUri.subtype === 'similar') {
					data = await client.getSimilarArtists(parsedUri.artist, 30)
				} else {
					data = await client.getArtistInfo(parsedUri.artist, session.username)
				}
				break
			}

			case 'album': {
				if (!parsedUri.artist || !parsedUri.album) {
					throw new Error('Artist and album names are required for album resources')
				}

				data = await client.getAlbumInfo(parsedUri.artist, parsedUri.album, session.username)
				break
			}

			default:
				throw new Error(`Unsupported resource type: ${parsedUri.type}`)
		}

		return {
			contents: [
				{
					uri,
					mimeType: 'application/json',
					text: JSON.stringify(data, null, 2),
				},
			],
		}
	} catch (error) {
		console.error('Error reading Last.fm resource:', error)
		throw new Error(`Failed to read Last.fm resource: ${error instanceof Error ? error.message : 'Unknown error'}`)
	}
}

/**
 * Handle prompts/list request
 */
export function handlePromptsList(params?: unknown): PromptsListResult {
	// Validate params if provided
	if (params && !isPromptsListParams(params)) {
		throw new Error('Invalid prompts/list params')
	}

	return { prompts: LASTFM_PROMPTS }
}

/**
 * Handle prompts/get request
 */
export function handlePromptsGet(params: unknown): PromptsGetResult {
	// Validate params using comprehensive validation
	validatePromptsGetParams(params)

	const { name, arguments: args } = params

	switch (name) {
		case 'listening_insights': {
			const username = args?.username as string
			const period = args?.period as string
			if (!username) {
				throw new Error('listening_insights prompt requires a username argument')
			}
			
			const periodText = period ? ` over the ${period} period` : ''
			return {
				description: 'Get insights about user\'s listening habits and patterns',
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Analyze the listening habits and patterns for Last.fm user "${username}"${periodText}. Use the available tools to gather their recent tracks, top artists, top albums, and listening statistics. Provide insights about their musical preferences, listening patterns, genre diversity, and any interesting trends. Identify their most played artists and tracks, and suggest what their listening data reveals about their musical taste.`,
						},
					},
				],
			}
		}

		case 'music_discovery': {
			const username = args?.username as string
			const genre = args?.genre as string
			if (!username) {
				throw new Error('music_discovery prompt requires a username argument')
			}
			
			const genreText = genre ? ` focusing on ${genre} music` : ''
			return {
				description: 'Discover new music based on listening history',
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Help discover new music for Last.fm user "${username}"${genreText}. Analyze their listening history, top artists, and loved tracks to understand their musical preferences. Use similar artists and tracks data to recommend new music they might enjoy. Provide explanations for why each recommendation would suit their taste based on their listening patterns.`,
						},
					},
				],
			}
		}

		case 'track_analysis': {
			const artist = args?.artist as string
			const track = args?.track as string
			if (!artist || !track) {
				throw new Error('track_analysis prompt requires both artist and track arguments')
			}
			
			return {
				description: 'Get detailed analysis of a specific track',
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Provide a detailed analysis of the track "${track}" by ${artist}. Use the available tools to gather comprehensive information including track details, tags, similar tracks, and statistics. Analyze the track's musical characteristics, its place in the artist's catalog, its popularity, and what makes it distinctive. Include information about similar tracks and recommendations for listeners who enjoy this song.`,
						},
					},
				],
			}
		}

		case 'album_analysis': {
			const artist = args?.artist as string
			const album = args?.album as string
			if (!artist || !album) {
				throw new Error('album_analysis prompt requires both artist and album arguments')
			}
			
			return {
				description: 'Get detailed analysis of a specific album',
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Provide a detailed analysis of the album "${album}" by ${artist}. Use the available tools to gather comprehensive information including album details, track listing, tags, and statistics. Analyze the album's musical themes, its significance in the artist's discography, critical reception, and notable tracks. Include information about the album's style, influences, and recommendations for similar albums.`,
						},
					},
				],
			}
		}

		case 'artist_analysis': {
			const artist = args?.artist as string
			if (!artist) {
				throw new Error('artist_analysis prompt requires an artist argument')
			}
			
			return {
				description: 'Get detailed analysis of a specific artist',
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Provide a detailed analysis of the artist ${artist}. Use the available tools to gather comprehensive information including artist bio, top tracks, albums, tags, and similar artists. Analyze their musical style, career highlights, influences, and impact on music. Include information about their most popular works and recommendations for listeners new to this artist.`,
						},
					},
				],
			}
		}

		case 'listening_habits': {
			const username = args?.username as string
			const timeframe = args?.timeframe as string
			if (!username) {
				throw new Error('listening_habits prompt requires a username argument')
			}
			
			const timeframeText = timeframe ? ` with a focus on ${timeframe} listening` : ''
			return {
				description: 'Analyze and summarize user\'s listening habits',
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Analyze and summarize the listening habits of Last.fm user "${username}"${timeframeText}. Use the available tools to examine their recent activity, top artists and albums, loved tracks, and overall statistics. Identify patterns in their listening behavior, preferred genres, discovery habits, and music consumption patterns. Provide insights about their musical journey and evolution of taste over time.`,
						},
					},
				],
			}
		}

		default:
			throw new Error(`Unknown prompt: ${name}`)
	}
}

/**
 * Interface for tools/call parameters
 */
interface ToolsCallParams {
	name: string
	arguments?: Record<string, unknown>
}

/**
 * Interface for tool call result
 */
interface ToolCallResult {
	content: Array<{
		type: 'text'
		text: string
	}>
}

/**
 * Handle non-authenticated tools
 */
async function handleToolsCall(params: unknown, httpRequest?: Request, env?: Env): Promise<ToolCallResult> {
	// Validate params
	if (!isToolsCallParams(params)) {
		throw new Error('Invalid tools/call params - name and arguments are required')
	}

	const { name, arguments: args } = params

	// Get tool schema for validation
	const toolSchemas: Record<string, unknown> = {
		ping: {
			type: 'object',
			properties: {
				message: { type: 'string' },
			},
			required: [],
		},
		server_info: {
			type: 'object',
			properties: {},
			required: [],
		},
		auth_status: {
			type: 'object',
			properties: {},
			required: [],
		},
	}

	// Validate tool arguments against schema
	if (name in toolSchemas) {
		try {
			validateToolArguments(args, toolSchemas[name])
		} catch (error) {
			throw new ValidationError(error instanceof Error ? error.message : 'Invalid tool arguments')
		}
	}

	switch (name) {
		case 'ping': {
			const message = args?.message || 'Hello from Last.fm MCP!'
			return {
				content: [
					{
						type: 'text',
						text: `Pong! You said: ${message}`,
					},
				],
			}
		}
		case 'server_info': {
			// Provide connection-specific authentication URL if available
			const connectionId = httpRequest?.headers.get('X-Connection-ID')
			const baseUrl = 'https://lastfm-mcp-prod.rian-db8.workers.dev'
			const authUrl = connectionId ? `${baseUrl}/login?connection_id=${connectionId}` : `${baseUrl}/login`
			
			return {
				content: [
					{
						type: 'text',
						text: `Last.fm MCP Server v1.0.0\n\nStatus: Running\nProtocol: MCP 2024-11-05\nFeatures:\n- Resources: User Listening Data, Track/Artist/Album Info\n- Authentication: Last.fm Web Auth\n- Rate Limiting: Enabled\n\nTo get started, authenticate at ${authUrl}`,
					},
				],
			}
		}
		case 'auth_status': {
			// Provide unauthenticated status with connection-specific instructions
			const connectionId = httpRequest?.headers.get('X-Connection-ID')
			const connectionInfo = connectionId ? `\n🔗 **Connection ID:** ${connectionId}` : ''
			const baseUrl = 'https://lastfm-mcp-prod.rian-db8.workers.dev'
			const loginUrl = connectionId ? `${baseUrl}/login?connection_id=${connectionId}` : `${baseUrl}/login`
			
			return {
				content: [
					{
						type: 'text',
						text: `🔐 **Authentication Status: Not Authenticated**${connectionInfo}

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

Your authentication will be secure and connection-specific - only you will have access to your listening data.

**Available without authentication:**
• \`ping\` - Test server connectivity
• \`server_info\` - Get server information
• \`auth_status\` - Check authentication status (this tool)
• \`get_track_info\` - Get basic track information
• \`get_artist_info\` - Get basic artist information  
• \`get_album_info\` - Get basic album information
• \`get_similar_artists\` - Find similar artists
• \`get_similar_tracks\` - Find similar tracks`,
					},
				],
			}
		}

		// Non-authenticated Last.fm tools that work with public data
		case 'get_track_info': {
			const artist = args?.artist as string
			const track = args?.track as string

			if (!artist || !track) {
				throw new Error('get_track_info requires artist and track parameters')
			}

			// Get cached Last.fm client instance
			const client = getCachedLastfmClient(env)
			if (!client) {
				throw new Error('Last.fm API client not available')
			}

			const data = await client.getTrackInfo(artist, track)
			
			const tags = data.track.toptags?.tag.slice(0, 5).map(tag => tag.name).join(', ') || 'None'

			return {
				content: [
					{
						type: 'text',
						text: `🎵 **Track Information**

**Track:** ${data.track.name}
**Artist:** ${data.track.artist.name}
**Album:** ${data.track.album?.['#text'] || 'Unknown'}

**Stats:**
• Total plays: ${data.track.playcount}
• Total listeners: ${data.track.listeners}

**Tags:** ${tags}

${data.track.wiki?.summary ? `**Description:** ${data.track.wiki.summary.replace(/<[^>]*>/g, '')}` : ''}

*Note: Sign in to see your personal listening stats for this track*`,
					},
				],
			}
		}

		case 'get_artist_info': {
			const artist = args?.artist as string

			if (!artist) {
				throw new Error('get_artist_info requires artist parameter')
			}

			// Get cached Last.fm client instance
			const client = getCachedLastfmClient(env)
			if (!client) {
				throw new Error('Last.fm API client not available')
			}

			const data = await client.getArtistInfo(artist)
			
			const tags = data.artist.tags?.tag.slice(0, 5).map(tag => tag.name).join(', ') || 'None'
			const similar = data.artist.similar?.artist.slice(0, 5).map(a => a.name).join(', ') || 'None'

			return {
				content: [
					{
						type: 'text',
						text: `🎤 **Artist Information**

**Artist:** ${data.artist.name}

**Stats:**
• Total plays: ${data.artist.stats.playcount}
• Total listeners: ${data.artist.stats.listeners}

**Tags:** ${tags}
**Similar Artists:** ${similar}

${data.artist.bio?.summary ? `**Bio:** ${data.artist.bio.summary.replace(/<[^>]*>/g, '')}` : ''}

*Note: Sign in to see your personal listening stats for this artist*`,
					},
				],
			}
		}

		case 'get_album_info': {
			const artist = args?.artist as string
			const album = args?.album as string

			if (!artist || !album) {
				throw new Error('get_album_info requires artist and album parameters')
			}

			// Get cached Last.fm client instance
			const client = getCachedLastfmClient(env)
			if (!client) {
				throw new Error('Last.fm API client not available')
			}

			const data = await client.getAlbumInfo(artist, album)
			
			const tags = data.album.tags?.tag.slice(0, 5).map(tag => tag.name).join(', ') || 'None'
			const tracks = data.album.tracks?.track.slice(0, 10).map((track, i) => `${i + 1}. ${track.name}`).join('\n') || 'Track listing not available'

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

**Tags:** ${tags}

**Track Listing:**
${tracks}

${data.album.wiki?.summary ? `**Description:** ${data.album.wiki.summary.replace(/<[^>]*>/g, '')}` : ''}

*Note: Sign in to see your personal listening stats for this album*`,
					},
				],
			}
		}

		case 'get_similar_artists': {
			const artist = args?.artist as string
			const limit = Math.min(Math.max((args?.limit as number) || 30, 1), 100)

			if (!artist) {
				throw new Error('get_similar_artists requires artist parameter')
			}

			// Get cached Last.fm client instance
			const client = getCachedLastfmClient(env)
			if (!client) {
				throw new Error('Last.fm API client not available')
			}

			const data = await client.getSimilarArtists(artist, limit)
			
			const artists = data.similarartists.artist.slice(0, limit)
			const artistList = artists.map(a => `• ${a.name} (${Math.round(parseFloat(a.match) * 100)}% match)`).join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `🎤 **Artists Similar to ${artist}**

${artistList}`,
					},
				],
			}
		}

		case 'get_similar_tracks': {
			const artist = args?.artist as string
			const track = args?.track as string
			const limit = Math.min(Math.max((args?.limit as number) || 30, 1), 100)

			if (!artist || !track) {
				throw new Error('get_similar_tracks requires artist and track parameters')
			}

			// Get cached Last.fm client instance
			const client = getCachedLastfmClient(env)
			if (!client) {
				throw new Error('Last.fm API client not available')
			}

			const data = await client.getSimilarTracks(artist, track, limit)
			
			const tracks = data.similartracks.track.slice(0, limit)
			const trackList = tracks.map(t => `• ${t.artist.name} - ${t.name} (${Math.round(parseFloat(t.match) * 100)}% match)`).join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `🎵 **Tracks Similar to ${track} by ${artist}**

${trackList}`,
					},
				],
			}
		}

		default:
			throw new Error(`Unknown tool: ${name}. This tool may require authentication.`)
	}
}

/**
 * Handle authenticated tools
 */
async function handleAuthenticatedToolsCall(params: unknown, session: SessionPayload, env?: Env, httpRequest?: Request): Promise<ToolCallResult> {
	// Validate params
	if (!isToolsCallParams(params)) {
		throw new Error('Invalid tools/call params - name and arguments are required')
	}

	const { name, arguments: args } = params

	// Get cached Last.fm client instance
	const client = getCachedLastfmClient(env)
	if (!client) {
		throw new Error('Last.fm API client not available')
	}

	// Get tool schema for validation (use the schemas from LASTFM_TOOLS)
	const toolSchemas: Record<string, unknown> = {}
	for (const tool of LASTFM_TOOLS) {
		toolSchemas[tool.name] = tool.inputSchema
	}

	// Validate tool arguments against schema
	if (name in toolSchemas) {
		try {
			validateToolArguments(args, toolSchemas[name])
		} catch (error) {
			throw new ValidationError(error instanceof Error ? error.message : 'Invalid tool arguments')
		}
	}

	switch (name) {
		case 'auth_status': {
			// Get connection information if available
			const connectionId = httpRequest?.headers.get('X-Connection-ID')
			const connectionInfo = connectionId ? `\n🔗 **Connection ID:** ${connectionId}` : ''
			
			return {
				content: [
					{
						type: 'text',
						text: `🔐 **Authentication Status: Authenticated** (Last.fm)${connectionInfo}

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

**Examples to try:**
- "Get my recent tracks"
- "Show me my top artists from the last month"
- "Find similar artists to Radiohead"
- "Get my listening statistics"
- "Recommend some music based on my taste"

Your authentication is secure and tied to your specific session.`,
					},
				],
			}
		}

		case 'get_recent_tracks': {
			const username = args?.username as string || session.username
			const limit = Math.min(Math.max((args?.limit as number) || 50, 1), 200)
			const from = args?.from as number
			const to = args?.to as number

			const data = await client.getRecentTracks(username, limit, from, to)
			
			const tracks = data.recenttracks.track.slice(0, limit)
			const trackList = tracks.map(track => {
				const nowPlaying = track.nowplaying ? ' 🎵 Now Playing' : ''
				const date = track.date ? new Date(parseInt(track.date.uts) * 1000).toLocaleDateString() : ''
				return `• ${track.artist['#text']} - ${track.name}${nowPlaying}${date ? ` (${date})` : ''}`
			}).join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `🎵 **Recent Tracks for ${username}**

Total tracks: ${data.recenttracks['@attr'].total}
Showing: ${tracks.length} most recent tracks

${trackList}

${tracks.length < parseInt(data.recenttracks['@attr'].total) ? '\n*Use tools/call with specific parameters to get more tracks*' : ''}`,
					},
				],
			}
		}

		case 'get_top_artists': {
			const username = args?.username as string || session.username
			const period = args?.period as string || 'overall'
			const limit = Math.min(Math.max((args?.limit as number) || 50, 1), 1000)

			const data = await client.getTopArtists(username, period as '7day' | '1month' | '3month' | '6month' | '12month' | 'overall', limit)
			
			const artists = data.topartists.artist.slice(0, limit)
			const artistList = artists.map((artist, index) => {
				return `${index + 1}. ${artist.name} (${artist.playcount} plays)`
			}).join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `🎤 **Top Artists for ${username}** (${period})

${artistList}

Total artists: ${data.topartists['@attr'].total}`,
					},
				],
			}
		}

		case 'get_top_albums': {
			const username = args?.username as string || session.username
			const period = args?.period as string || 'overall'
			const limit = Math.min(Math.max((args?.limit as number) || 50, 1), 1000)

			const data = await client.getTopAlbums(username, period as '7day' | '1month' | '3month' | '6month' | '12month' | 'overall', limit)
			
			const albums = data.topalbums.album.slice(0, limit)
			const albumList = albums.map((album, index) => {
				const artist = typeof album.artist === 'string' ? album.artist : album.artist.name
				return `${index + 1}. ${artist} - ${album.name} (${album.playcount} plays)`
			}).join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `💿 **Top Albums for ${username}** (${period})

${albumList}

Total albums: ${data.topalbums['@attr'].total}`,
					},
				],
			}
		}

		case 'get_loved_tracks': {
			const username = args?.username as string || session.username
			const limit = Math.min(Math.max((args?.limit as number) || 50, 1), 1000)

			const data = await client.getLovedTracks(username, limit)
			
			const tracks = data.lovedtracks.track.slice(0, limit)
			const trackList = tracks.map(track => {
				return `• ${track.artist.name} - ${track.name}`
			}).join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `❤️ **Loved Tracks for ${username}**

${trackList}

Total loved tracks: ${data.lovedtracks['@attr'].total}`,
					},
				],
			}
		}

		case 'get_track_info': {
			const artist = args?.artist as string
			const track = args?.track as string
			const username = args?.username as string || session.username

			if (!artist || !track) {
				throw new Error('get_track_info requires artist and track parameters')
			}

			const data = await client.getTrackInfo(artist, track, username)
			
			const tags = data.track.toptags?.tag.slice(0, 5).map(tag => tag.name).join(', ') || 'None'
			const userPlaycount = data.track.userplaycount || '0'
			const loved = data.track.userloved === '1' ? ' ❤️' : ''

			return {
				content: [
					{
						type: 'text',
						text: `🎵 **Track Information**

**Track:** ${data.track.name}${loved}
**Artist:** ${data.track.artist.name}
**Album:** ${data.track.album?.['#text'] || 'Unknown'}

**Stats:**
• Total plays: ${data.track.playcount}
• Total listeners: ${data.track.listeners}
• Your plays: ${userPlaycount}

**Tags:** ${tags}

${data.track.wiki?.summary ? `**Description:** ${data.track.wiki.summary.replace(/<[^>]*>/g, '')}` : ''}`,
					},
				],
			}
		}

		case 'get_artist_info': {
			const artist = args?.artist as string
			const username = args?.username as string || session.username

			if (!artist) {
				throw new Error('get_artist_info requires artist parameter')
			}

			const data = await client.getArtistInfo(artist, username)
			
			const tags = data.artist.tags?.tag.slice(0, 5).map(tag => tag.name).join(', ') || 'None'
			const userPlaycount = data.artist.stats.userplaycount || '0'
			const similar = data.artist.similar?.artist.slice(0, 5).map(a => a.name).join(', ') || 'None'

			return {
				content: [
					{
						type: 'text',
						text: `🎤 **Artist Information**

**Artist:** ${data.artist.name}

**Stats:**
• Total plays: ${data.artist.stats.playcount}
• Total listeners: ${data.artist.stats.listeners}
• Your plays: ${userPlaycount}

**Tags:** ${tags}
**Similar Artists:** ${similar}

${data.artist.bio?.summary ? `**Bio:** ${data.artist.bio.summary.replace(/<[^>]*>/g, '')}` : ''}`,
					},
				],
			}
		}

		case 'get_album_info': {
			const artist = args?.artist as string
			const album = args?.album as string
			const username = args?.username as string || session.username

			if (!artist || !album) {
				throw new Error('get_album_info requires artist and album parameters')
			}

			const data = await client.getAlbumInfo(artist, album, username)
			
			const tags = data.album.tags?.tag.slice(0, 5).map(tag => tag.name).join(', ') || 'None'
			const userPlaycount = data.album.userplaycount || '0'
			const tracks = data.album.tracks?.track.slice(0, 10).map((track, i) => `${i + 1}. ${track.name}`).join('\n') || 'Track listing not available'

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
• Your plays: ${userPlaycount}

**Tags:** ${tags}

**Track Listing:**
${tracks}

${data.album.wiki?.summary ? `**Description:** ${data.album.wiki.summary.replace(/<[^>]*>/g, '')}` : ''}`,
					},
				],
			}
		}

		case 'get_user_info': {
			const username = args?.username as string || session.username

			const data = await client.getUserInfo(username)
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
		}

		case 'get_similar_artists': {
			const artist = args?.artist as string
			const limit = Math.min(Math.max((args?.limit as number) || 30, 1), 100)

			if (!artist) {
				throw new Error('get_similar_artists requires artist parameter')
			}

			const data = await client.getSimilarArtists(artist, limit)
			
			const artists = data.similarartists.artist.slice(0, limit)
			const artistList = artists.map(a => `• ${a.name} (${Math.round(parseFloat(a.match) * 100)}% match)`).join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `🎤 **Artists Similar to ${artist}**

${artistList}`,
					},
				],
			}
		}

		case 'get_similar_tracks': {
			const artist = args?.artist as string
			const track = args?.track as string
			const limit = Math.min(Math.max((args?.limit as number) || 30, 1), 100)

			if (!artist || !track) {
				throw new Error('get_similar_tracks requires artist and track parameters')
			}

			const data = await client.getSimilarTracks(artist, track, limit)
			
			const tracks = data.similartracks.track.slice(0, limit)
			const trackList = tracks.map(t => `• ${t.artist.name} - ${t.name} (${Math.round(parseFloat(t.match) * 100)}% match)`).join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `🎵 **Tracks Similar to ${track} by ${artist}**

${trackList}`,
					},
				],
			}
		}

		case 'get_listening_stats': {
			const username = args?.username as string || session.username
			const period = args?.period as string || 'overall'

			const stats = await client.getListeningStats(username, period as '7day' | '1month' | '3month' | '6month' | '12month' | 'overall')

			return {
				content: [
					{
						type: 'text',
						text: `📊 **Listening Statistics for ${username}** (${period})

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
		}

		case 'get_music_recommendations': {
			const username = args?.username as string || session.username
			const limit = Math.min(Math.max((args?.limit as number) || 20, 1), 50)
			const genre = args?.genre as string

			const recommendations = await client.getMusicRecommendations(username, limit, genre)
			
			const artistRecs = recommendations.recommendedArtists.slice(0, 8)
			const artistList = artistRecs.map(rec => `• ${rec.name} (${rec.reason})`).join('\n')

			return {
				content: [
					{
						type: 'text',
						text: `🎯 **Music Recommendations for ${username}**
${genre ? `**Genre Filter:** ${genre}\n` : ''}
**Recommended Artists:**

${artistList}

*Based on your listening history and similar user preferences*`,
					},
				],
			}
		}

		default:
			throw new Error(`Unknown tool: ${name}. Available tools: ${LASTFM_TOOLS.map(t => t.name).join(', ')}`)
	}
}

/**
 * Type guard for ToolsCallParams
 */
function isToolsCallParams(params: unknown): params is ToolsCallParams {
	return typeof params === 'object' && params !== null && 'name' in params && typeof (params as Record<string, unknown>).name === 'string'
}

/**
 * Type guard for ResourcesReadParams
 */

/**
 * Type guard for PromptsListParams
 */
function isPromptsListParams(params: unknown): params is PromptsListParams {
	return (
		typeof params === 'object' && params !== null && (!('cursor' in params) || typeof (params as PromptsListParams).cursor === 'string')
	)
}

/**
 * Type guard for PromptsGetParams
 */

/**
 * Main method router
 */
export async function handleMethod(request: JSONRPCRequest, httpRequest?: Request, jwtSecret?: string, env?: Env) {
	// Validate JSON-RPC message structure
	try {
		validateJSONRPCMessage(request)
	} catch (error) {
		if (error instanceof ValidationError) {
			return hasId(request) ? createError(request.id!, error.code, error.message) : null
		}
		return hasId(request) ? createError(request.id!, ErrorCode.InvalidRequest, 'Invalid request') : null
	}

	const { method, params, id } = request

	// Validate protocol flow
	try {
		validateProtocolFlow(method)
	} catch (error) {
		if (error instanceof ValidationError) {
			return hasId(request) ? createError(id!, error.code, error.message) : null
		}
		return hasId(request) ? createError(id!, MCPErrorCode.ServerNotInitialized, 'Server not initialized') : null
	}

	// Special case: initialize can be called before initialization
	if (method === 'initialize') {
		const result = handleInitialize(params)
		return hasId(request) ? createResponse(id!, result) : null
	}

	// Special case: initialized notification
	if (method === 'initialized') {
		handleInitialized()
		return null // No response for notifications
	}

	// In stateless HTTP mode, we don't enforce initialization state
	// The mcp-remote client handles the proper initialization flow

	// Some methods don't require authentication
	switch (method) {
		case 'resources/list': {
			const resourcesResult = handleResourcesList()
			return hasId(request) ? createResponse(id!, resourcesResult) : null
		}

		case 'tools/list': {
			// Return all available Last.fm tools
			return hasId(request) ? createResponse(id!, { tools: LASTFM_TOOLS }) : null
		}

		case 'tools/call-old': {
			// Legacy Discogs tools (keeping for reference but not used)
			const _legacyTools = [
				{
					name: 'ping',
					description: 'Test connectivity to the Discogs MCP server',
					inputSchema: {
						type: 'object',
						properties: {
							message: {
								type: 'string',
								description: 'Message to echo back',
								default: 'Hello from Discogs MCP!',
							},
						},
						required: [],
					},
				},
				{
					name: 'server_info',
					description: 'Get information about the Discogs MCP server',
					inputSchema: {
						type: 'object',
						properties: {},
						required: [],
					},
				},
				{
					name: 'auth_status',
					description: 'Check authentication status and get login instructions if needed',
					inputSchema: {
						type: 'object',
						properties: {},
						required: [],
					},
				},
				{
					name: 'search_collection',
					description: "Search through the user's Discogs collection with mood and contextual awareness",
					inputSchema: {
						type: 'object',
						properties: {
							query: {
								type: 'string',
								description:
									'Search query - supports artist/album names, genres, and mood descriptors like "mellow", "energetic", "Sunday evening", "melancholy"',
							},
							per_page: {
								type: 'number',
								description: 'Number of results per page (1-100)',
								default: 50,
								minimum: 1,
								maximum: 100,
							},
						},
						required: ['query'],
					},
				},
				{
					name: 'get_release',
					description: 'Get detailed information about a specific Discogs release',
					inputSchema: {
						type: 'object',
						properties: {
							release_id: {
								type: 'string',
								description: 'The Discogs release ID',
							},
						},
						required: ['release_id'],
					},
				},
				{
					name: 'get_collection_stats',
					description: "Get statistics about the user's collection",
					inputSchema: {
						type: 'object',
						properties: {},
						required: [],
					},
				},
				{
					name: 'get_recommendations',
					description: 'Get context-aware music recommendations with mood and emotional understanding',
					inputSchema: {
						type: 'object',
						properties: {
							limit: {
								type: 'number',
								description: 'Number of recommendations to return',
								default: 10,
								minimum: 1,
								maximum: 50,
							},
							genre: {
								type: 'string',
								description:
									'Filter by genre or mood - supports both concrete genres ("Jazz", "Rock") and mood descriptors ("mellow", "energetic", "melancholy")',
							},
							decade: {
								type: 'string',
								description: 'Filter recommendations by decade (e.g., "1960s", "1970s", "1980s")',
							},
							similar_to: {
								type: 'string',
								description: 'Find albums similar to this artist or album name',
							},
							query: {
								type: 'string',
								description:
									'Contextual query with mood support - try "Sunday evening vibes", "energetic workout music", "mellow jazz for studying"',
							},
							format: {
								type: 'string',
								description: 'Filter recommendations by format (e.g., "Vinyl", "CD", "Cassette", "Digital")',
							},
						},
						required: [],
					},
				},
				{
					name: 'get_cache_stats',
					description: 'Get cache performance statistics to monitor API optimization',
					inputSchema: {
						type: 'object',
						properties: {},
						required: [],
					},
				},
			]
			// This is legacy code - tools/call-old is not a real endpoint
			return null
		}

		case 'tools/call': {
			// For tools that exist in both authenticated and non-authenticated handlers (like auth_status),
			// check authentication first to determine which handler to use
			const toolName = (params as ToolsCallParams)?.name
			const dualHandlerTools = ['auth_status', 'get_artist_info', 'get_track_info', 'get_album_info'] // Tools that exist in both handlers
			
			if (dualHandlerTools.includes(toolName) && httpRequest && jwtSecret) {
				// Check if user is authenticated first
				const session = await getConnectionSession(httpRequest, jwtSecret, env)
				
				if (session) {
					// User is authenticated, use authenticated handler
					try {
						const authenticatedResult = await handleAuthenticatedToolsCall(params, session, env, httpRequest)
						return hasId(request) ? createResponse(id!, authenticatedResult) : null
					} catch (authError) {
						const errorInfo = mapErrorToJSONRPC(authError)
						return hasId(request) ? createError(id!, errorInfo.code, errorInfo.message, errorInfo.data) : null
					}
				}
				// Fall through to non-authenticated handler if not authenticated
			}

			try {
				// Try non-authenticated tools
				const result = await handleToolsCall(params, httpRequest, env)
				return hasId(request) ? createResponse(id!, result) : null
			} catch (error) {
				// If it's an unknown tool error, it might be an authenticated tool
				if (error instanceof Error && error.message.includes('Unknown tool') && error.message.includes('authentication')) {
					console.log('Attempting authenticated tool call for:', params)

					// Check if we have authentication context
					if (!httpRequest || !jwtSecret) {
						console.log('Missing authentication context')
						return hasId(request) ? createError(id!, -32603, 'Internal error: Missing authentication context for authenticated tool') : null
					}

					console.log('Verifying authentication...')
					const session = await getConnectionSession(httpRequest, jwtSecret, env)
					console.log('Session verification result:', session ? 'SUCCESS' : 'FAILED')

					if (!session) {
						const authInstructions = generateAuthInstructions(httpRequest)
						return hasId(request)
							? createError(
									id!,
									MCPErrorCode.Unauthorized,
									`Authentication required. Please use the "auth_status" tool for detailed authentication instructions, or ${authInstructions}`,
								)
							: null
					}

					try {
						const authenticatedResult = await handleAuthenticatedToolsCall(params, session, env, httpRequest)
						return hasId(request) ? createResponse(id!, authenticatedResult) : null
					} catch (authError) {
						const errorInfo = mapErrorToJSONRPC(authError)
						return hasId(request) ? createError(id!, errorInfo.code, errorInfo.message, errorInfo.data) : null
					}
				}

				const errorInfo = mapErrorToJSONRPC(error)
				return hasId(request) ? createError(id!, errorInfo.code, errorInfo.message, errorInfo.data) : null
			}
		}

		case 'prompts/list': {
			try {
				const result = handlePromptsList(params)
				return hasId(request) ? createResponse(id!, result) : null
			} catch (error) {
				const errorInfo = mapErrorToJSONRPC(error)
				return hasId(request) ? createError(id!, errorInfo.code, errorInfo.message, errorInfo.data) : null
			}
		}

		case 'prompts/get': {
			try {
				const result = handlePromptsGet(params)
				return hasId(request) ? createResponse(id!, result) : null
			} catch (error) {
				const errorInfo = mapErrorToJSONRPC(error)
				return hasId(request) ? createError(id!, errorInfo.code, errorInfo.message, errorInfo.data) : null
			}
		}
	}

	// All other methods require authentication
	if (!httpRequest || !jwtSecret) {
		if (hasId(request)) {
			return createError(id!, -32603, 'Internal error: Missing authentication context')
		}
		return null
	}

	const session = await getConnectionSession(httpRequest, jwtSecret, env)

	if (!session) {
		if (hasId(request)) {
			const authInstructions = generateAuthInstructions(httpRequest)
			return createError(
				id!,
				MCPErrorCode.Unauthorized,
				`Authentication required. Please use the "auth_status" tool for detailed authentication instructions, or ${authInstructions}`,
			)
		}
		return null
	}

	// Route to appropriate handler for authenticated methods
	switch (method) {
		// Resources

		case 'resources/read': {
			try {
				const result = await handleResourcesRead(params, session, env)
				return hasId(request) ? createResponse(id!, result) : null
			} catch (error) {
				const errorInfo = mapErrorToJSONRPC(error)
				return hasId(request) ? createError(id!, errorInfo.code, errorInfo.message, errorInfo.data) : null
			}
		}

		// Tools (authenticated tools would go here in the future)

		default:
			if (hasId(request)) {
				const error = createMethodNotFoundError(method)
				return createError(id!, error.code, error.message, error.data)
			}
			return null
	}
}

/**
 * Reset initialization state (for testing)
 */
export function resetInitialization(): void {
	// No longer needed in stateless HTTP mode
	// State is managed per-request
}
