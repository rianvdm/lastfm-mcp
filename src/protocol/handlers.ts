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
	Resource,
	ResourcesListResult,
	ResourcesReadResult,
	Prompt,
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
import { LASTFM_RESOURCES, LASTFM_TOOLS, parseLastfmUri } from '../types/lastfm-mcp'
import { analyzeMoodQuery, hasMoodContent, generateMoodSearchTerms } from '../utils/moodMapping'
import { isConnectionAuthenticated } from '../transport/sse'

/**
 * Get cached Last.fm client instance
 */
function getCachedLastfmClient(env?: Env): CachedLastfmClient | null {
	if (!env?.LASTFM_API_KEY) {
		console.warn('No Last.fm API key available')
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
			accessToken: sessionData.accessToken,
			accessTokenSecret: sessionData.accessTokenSecret,
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
	const baseUrl = 'https://discogs-mcp-prod.rian-db8.workers.dev'
	
	if (connectionId) {
		// Connection-specific auth instructions
		return `visit ${baseUrl}/login?connection_id=${connectionId} to authenticate with your Discogs account`
	} else {
		// Generic auth instructions
		return `visit ${baseUrl}/login to authenticate with Discogs`
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

	const prompts: Prompt[] = [
		{
			name: 'browse_collection',
			description: 'Browse and explore your Discogs music collection',
		},
		{
			name: 'find_music',
			description: 'Find specific music in your collection',
			arguments: [
				{
					name: 'query',
					description: 'Search query for finding music (artist, album, track, etc.)',
					required: true,
				},
			],
		},
		{
			name: 'collection_insights',
			description: 'Get insights and statistics about your music collection',
		},
	]

	return { prompts }
}

/**
 * Handle prompts/get request
 */
export function handlePromptsGet(params: unknown): PromptsGetResult {
	// Validate params using comprehensive validation
	validatePromptsGetParams(params)

	const { name, arguments: args } = params

	switch (name) {
		case 'browse_collection': {
			return {
				description: 'Browse and explore your Discogs music collection',
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: 'Help me explore my Discogs music collection. Show me interesting insights, recommend albums to listen to, or help me discover patterns in my collection. You can use the available tools to search my collection, get detailed release information, view collection statistics, and get personalized recommendations.',
						},
					},
				],
			}
		}

		case 'find_music': {
			const query = args?.query as string
			if (!query) {
				throw new Error('find_music prompt requires a query argument')
			}
			return {
				description: 'Find specific music in your collection',
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Help me find music in my Discogs collection related to: "${query}". Search through my collection and provide detailed information about any matching releases. If you find multiple matches, help me understand the differences and recommend which ones might be most interesting.`,
						},
					},
				],
			}
		}

		case 'collection_insights': {
			return {
				description: 'Get insights about your music collection',
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: 'Analyze my Discogs music collection and provide interesting insights. Look at my collection statistics, identify patterns in genres, decades, formats, and artists. Help me understand what my collection says about my musical tastes and suggest areas where I might want to expand my collection.',
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
async function handleToolsCall(params: unknown, httpRequest?: Request): Promise<ToolCallResult> {
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
• Get detailed information about tracks, artists, and albums
• Discover similar music and get personalized recommendations
• Analyze your listening patterns and statistics

Your authentication will be secure and connection-specific - only you will have access to your listening data.

**Available without authentication:**
• \`ping\` - Test server connectivity
• \`server_info\` - Get server information
• \`auth_status\` - Check authentication status (this tool)`,
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
			
			try {
				const consumerKey = env?.DISCOGS_CONSUMER_KEY || ''
				const consumerSecret = env?.DISCOGS_CONSUMER_SECRET || ''

				// Try to get user profile to verify authentication
				const userProfile = await client.getUserProfile(session.accessToken, session.accessTokenSecret, consumerKey, consumerSecret)

				return {
					content: [
						{
							type: 'text',
							text: `✅ **Authentication Status: Authenticated**

🎵 **Connected Discogs Account:** ${userProfile.username}
🆔 **User ID:** ${userProfile.id}${connectionInfo}

You're all set! You can now use all collection tools:

**Available Tools:**
- **search_collection**: Search your Discogs collection with mood and contextual awareness
- **get_release**: Get detailed release information  
- **get_collection_stats**: Get collection statistics
- **get_recommendations**: Get personalized recommendations with mood support
- **ping**: Test server connectivity
- **server_info**: Get server information

**Examples to try:**
- "Search my collection for Beatles albums"
- "What are my collection stats?"
- "Recommend some mellow jazz for Sunday evening"
- "Find energetic workout music in my collection"
- "Show me melancholy music from the 1970s"

Your authentication is secure and tied to your specific session.`,
						},
					],
				}
			} catch (error) {
				const baseUrl = 'https://discogs-mcp-prod.rian-db8.workers.dev'
				const loginUrl = connectionId 
					? `${baseUrl}/login?connection_id=${connectionId}` 
					: `${baseUrl}/login`
				
				return {
					content: [
						{
							type: 'text',
							text: `🔐 **Authentication Status: Authentication Error**

There was an issue verifying your authentication: ${error instanceof Error ? error.message : 'Unknown error'}${connectionInfo}

**How to re-authenticate:**
1. Visit: ${loginUrl}
2. Click "Authorize" to allow access to your Discogs collection
3. You'll be redirected back and your session will be saved
4. Try again

If the problem persists, please check that your Discogs account is accessible.`,
						},
					],
				}
			}
		}

		case 'search_collection': {
			const query = args?.query as string
			if (!query) {
				throw new Error('search_collection requires a query parameter')
			}

			const perPage = Math.min(Math.max((args?.per_page as number) || 50, 1), 100)

			try {
				const consumerKey = env?.DISCOGS_CONSUMER_KEY || ''
				const consumerSecret = env?.DISCOGS_CONSUMER_SECRET || ''

				const userProfile = await client.getUserProfile(session.accessToken, session.accessTokenSecret, consumerKey, consumerSecret)

				// Check for temporal terms to provide better user feedback
				const queryWords = query.toLowerCase().split(/\s+/)
				const hasRecent = queryWords.some(word => ['recent', 'recently', 'new', 'newest', 'latest'].includes(word))
				const hasOld = queryWords.some(word => ['old', 'oldest', 'earliest'].includes(word))
				
				let temporalInfo = ''
				if (hasRecent) {
					temporalInfo = `\n**Search Strategy:** Interpreted "${query}" as searching for items with "recent" meaning "most recently added". Sorting by date added (newest first).\n`
				} else if (hasOld) {
					temporalInfo = `\n**Search Strategy:** Interpreted "${query}" as searching for items with "old/oldest" meaning "earliest added". Sorting by date added (oldest first).\n`
				}

				// Check if query contains mood/contextual language
				const searchQueries: string[] = [query] // Start with original query
				let moodInfo = ''

				if (hasMoodContent(query)) {
					const moodAnalysis = analyzeMoodQuery(query)
					if (moodAnalysis.confidence >= 0.3) {
						// Add mood-based search terms while preserving original query
						const moodTerms = generateMoodSearchTerms(query)
						if (moodTerms.length > 0) {
							searchQueries.push(...moodTerms.slice(0, 3)) // Add top 3 mood-based terms
							moodInfo = `\n**Mood Analysis:** Detected "${moodAnalysis.detectedMoods.join(', ')}" - searching for ${moodTerms.slice(0, 3).join(', ')}\n`
						}
					}
				}

				// Perform searches for all query variations and combine results
				const allResults: DiscogsCollectionItem[] = []
				const seenReleaseIds = new Set<string>()

				for (const searchQuery of searchQueries) {
					const searchResults = await client.searchCollection(
						userProfile.username,
						session.accessToken,
						session.accessTokenSecret,
						{
							query: searchQuery,
							per_page: perPage,
						},
						consumerKey,
						consumerSecret,
					)

					// Add unique results (avoid duplicates)
					for (const release of searchResults.releases) {
						const releaseKey = `${release.id}-${release.instance_id}`
						if (!seenReleaseIds.has(releaseKey)) {
							seenReleaseIds.add(releaseKey)
							allResults.push(release)
						}
					}
				}

				// Sort combined results by rating and date (unless temporal sorting was applied)
				if (!hasRecent && !hasOld) {
					allResults.sort((a: DiscogsCollectionItem, b: DiscogsCollectionItem) => {
						if (a.rating !== b.rating) {
							return b.rating - a.rating
						}
						return new Date(b.date_added).getTime() - new Date(a.date_added).getTime()
					})
				}

				// Limit to requested page size
				const finalResults = allResults.slice(0, perPage)

				const summary = `Found ${allResults.length} results for "${query}" in your collection (showing ${finalResults.length} items):`

				// Create concise formatted list with genres and styles
				const releaseList = finalResults
					.map((release: DiscogsCollectionItem) => {
						const info = release.basic_information
						const artists = info.artists.map((a: { name: string }) => a.name).join(', ')
						const formats = info.formats.map((f: { name: string }) => f.name).join(', ')
						const genres = info.genres?.length ? info.genres.join(', ') : 'Unknown'
						const styles = info.styles?.length ? ` | Styles: ${info.styles.join(', ')}` : ''
						const rating = release.rating > 0 ? ` ⭐${release.rating}` : ''

						return `• [ID: ${release.id}] ${artists} - ${info.title} (${info.year})\n  Format: ${formats} | Genre: ${genres}${styles}${rating}`
					})
					.join('\n\n')

				return {
					content: [
						{
							type: 'text',
							text: `${summary}${temporalInfo}${moodInfo}\n${releaseList}\n\n**Tip:** Use the release IDs with the get_release tool for detailed information about specific albums.`,
						},
					],
				}
			} catch (error) {
				throw new Error(`Failed to search collection: ${error instanceof Error ? error.message : 'Unknown error'}`)
			}
		}

		case 'get_release': {
			const releaseId = args?.release_id as string
			if (!releaseId) {
				throw new Error('get_release requires a release_id parameter')
			}

			try {
				const release = await client.getRelease(releaseId, session.accessToken, session.accessTokenSecret)

				const artists = (release.artists || []).map((a) => a.name).join(', ')
				const formats = (release.formats || []).map((f) => `${f.name} (${f.qty})`).join(', ')
				const genres = (release.genres || []).join(', ')
				const styles = (release.styles || []).join(', ')
				const labels = (release.labels || []).map((l) => `${l.name} (${l.catno})`).join(', ')

				let text = `**${artists} - ${release.title}**\n\n`
				text += `Year: ${release.year || 'Unknown'}\n`
				text += `Formats: ${formats}\n`
				text += `Genres: ${genres}\n`
				if (styles) text += `Styles: ${styles}\n`
				text += `Labels: ${labels}\n`
				if (release.country) text += `Country: ${release.country}\n`

				if (release.tracklist && release.tracklist.length > 0) {
					text += `\n**Tracklist:**\n`
					release.tracklist.forEach((track) => {
						text += `${track.position}. ${track.title}`
						if (track.duration) text += ` (${track.duration})`
						text += '\n'
					})
				}

				return {
					content: [
						{
							type: 'text',
							text,
						},
					],
				}
			} catch (error) {
				throw new Error(`Failed to get release: ${error instanceof Error ? error.message : 'Unknown error'}`)
			}
		}

		case 'get_collection_stats': {
			try {
				const consumerKey = env?.DISCOGS_CONSUMER_KEY || ''
				const consumerSecret = env?.DISCOGS_CONSUMER_SECRET || ''

				const userProfile = await client.getUserProfile(session.accessToken, session.accessTokenSecret, consumerKey, consumerSecret)
				const stats = await client.getCollectionStats(
					userProfile.username,
					session.accessToken,
					session.accessTokenSecret,
					consumerKey,
					consumerSecret,
				)

				let text = `**Collection Statistics for ${userProfile.username}**\n\n`
				text += `Total Releases: ${stats.totalReleases}\n`
				text += `Average Rating: ${stats.averageRating.toFixed(1)} (${stats.ratedReleases} rated releases)\n\n`

				text += `**Top Genres:**\n`
				const topGenres = Object.entries(stats.genreBreakdown)
					.sort(([, a], [, b]) => b - a)
					.slice(0, 5)
				topGenres.forEach(([genre, count]) => {
					text += `• ${genre}: ${count} releases\n`
				})

				text += `\n**By Decade:**\n`
				const topDecades = Object.entries(stats.decadeBreakdown)
					.sort(([, a], [, b]) => b - a)
					.slice(0, 5)
				topDecades.forEach(([decade, count]) => {
					text += `• ${decade}s: ${count} releases\n`
				})

				text += `\n**Top Formats:**\n`
				const topFormats = Object.entries(stats.formatBreakdown)
					.sort(([, a], [, b]) => b - a)
					.slice(0, 5)
				topFormats.forEach(([format, count]) => {
					text += `• ${format}: ${count} releases\n`
				})

				return {
					content: [
						{
							type: 'text',
							text,
						},
					],
				}
			} catch (error) {
				throw new Error(`Failed to get collection stats: ${error instanceof Error ? error.message : 'Unknown error'}`)
			}
		}

		case 'get_recommendations': {
			const limit = Math.min(Math.max((args?.limit as number) || 10, 1), 50)
			const genre = args?.genre as string
			const decade = args?.decade as string
			const similarTo = args?.similar_to as string
			const query = args?.query as string
			const format = args?.format as string

			// Type for release with relevance score
			type ReleaseWithRelevance = DiscogsCollectionItem & { relevanceScore?: number }

			// Analyze mood content in parameters to enhance filtering
			let moodGenres: string[] = []
			let moodStyles: string[] = []
			let moodInfo = ''

			// Check for mood content in query parameter
			if (query && hasMoodContent(query)) {
				const moodAnalysis = analyzeMoodQuery(query)
				if (moodAnalysis.confidence >= 0.3) {
					moodGenres = moodAnalysis.suggestedGenres
					moodStyles = moodAnalysis.suggestedStyles
					moodInfo = `\n**Mood Analysis:** Detected "${moodAnalysis.detectedMoods.join(', ')}"${moodAnalysis.contextualHints.length ? ` (${moodAnalysis.contextualHints.join(', ')})` : ''}\n`
				}
			}

			// Also check genre parameter for mood terms
			if (genre && hasMoodContent(genre)) {
				const genreMoodAnalysis = analyzeMoodQuery(genre)
				if (genreMoodAnalysis.confidence >= 0.3) {
					moodGenres = [...moodGenres, ...genreMoodAnalysis.suggestedGenres]
					moodStyles = [...moodStyles, ...genreMoodAnalysis.suggestedStyles]
					if (!moodInfo) {
						moodInfo = `\n**Mood Analysis:** Detected "${genreMoodAnalysis.detectedMoods.join(', ')}" in genre filter\n`
					}
				}
			}

			// Remove duplicates from mood mappings
			moodGenres = [...new Set(moodGenres)]
			moodStyles = [...new Set(moodStyles)]

			try {
				const consumerKey = env?.DISCOGS_CONSUMER_KEY || ''
				const consumerSecret = env?.DISCOGS_CONSUMER_SECRET || ''

				const userProfile = await client.getUserProfile(session.accessToken, session.accessTokenSecret, consumerKey, consumerSecret)

				// Get full collection for context-aware recommendations
				const fullCollection = await client.searchCollection(
					userProfile.username,
					session.accessToken,
					session.accessTokenSecret,
					{ per_page: 100 }, // Get all items
					consumerKey,
					consumerSecret,
				)

				// Get all collection items by paginating through all pages
				let allReleases = fullCollection.releases
				for (let page = 2; page <= fullCollection.pagination.pages; page++) {
					const pageResults = await client.searchCollection(
						userProfile.username,
						session.accessToken,
						session.accessTokenSecret,
						{ page, per_page: 100 },
						consumerKey,
						consumerSecret,
					)
					allReleases = allReleases.concat(pageResults.releases)
				}

				// Filter releases based on context parameters
				let filteredReleases = allReleases

				// Filter by genre (enhanced with mood mapping)
				if (genre || moodGenres.length > 0) {
					filteredReleases = filteredReleases.filter((release) => {
						const releaseGenres = release.basic_information.genres?.map((g) => g.toLowerCase()) || []
						const releaseStyles = release.basic_information.styles?.map((s) => s.toLowerCase()) || []

						// Original genre matching (if genre parameter provided)
						let genreMatch = false
						if (genre) {
							// Split genre parameter by common separators and check each one
							const genreTerms = genre.toLowerCase().split(/[\s,;|&]+/).filter(term => term.length > 0)
							genreMatch = genreTerms.some(term => 
								releaseGenres.some((g) => g.includes(term)) || 
								releaseStyles.some((s) => s.includes(term))
							)
						}

						// Mood-based genre matching
						let moodMatch = false
						if (moodGenres.length > 0 || moodStyles.length > 0) {
							const lowerMoodGenres = moodGenres.map((g) => g.toLowerCase())
							const lowerMoodStyles = moodStyles.map((s) => s.toLowerCase())

							moodMatch =
								releaseGenres.some((g) => lowerMoodGenres.some((mg) => g.includes(mg) || mg.includes(g))) ||
								releaseStyles.some((s) => lowerMoodStyles.some((ms) => s.includes(ms) || ms.includes(s)))
						}

						// Return true if either genre or mood criteria match (when applicable)
						if (genre && (moodGenres.length > 0 || moodStyles.length > 0)) {
							return genreMatch || moodMatch
						} else if (genre) {
							return genreMatch
						} else {
							return moodMatch
						}
					})
				}

				// Filter by decade
				if (decade) {
					const decadeNum = parseInt(decade.replace(/s$/, ''))
					if (!isNaN(decadeNum)) {
						filteredReleases = filteredReleases.filter((release) => {
							const year = release.basic_information.year
							return year && year >= decadeNum && year < decadeNum + 10
						})
					}
				}

				// Filter by format
				if (format) {
					filteredReleases = filteredReleases.filter((release) => {
						return release.basic_information.formats?.some((f) => f.name.toLowerCase().includes(format.toLowerCase()))
					})
				}

				// Filter by similarity to artist/album using musical characteristics
				if (similarTo) {
					// Step 1: Find reference release(s) that match the similarTo query
					const similarTerms = similarTo
						.toLowerCase()
						.split(/\s+/)
						.filter((term) => term.length > 2)
					const referenceReleases = filteredReleases.filter((release) => {
						const info = release.basic_information
						const searchableText = [
							...(info.artists?.map((artist) => artist.name) || []),
							info.title,
							...(info.genres || []),
							...(info.styles || []),
							...(info.labels?.map((label) => label.name) || []),
						]
							.join(' ')
							.toLowerCase()

						// Find releases that match the similarTo terms
						const matchingTerms = similarTerms.filter((term) => searchableText.includes(term)).length
						return matchingTerms >= Math.ceil(similarTerms.length * 0.5)
					})

					if (referenceReleases.length > 0) {
						// Step 2: Extract musical characteristics from reference releases
						const refGenres = new Set<string>()
						const refStyles = new Set<string>()
						const refArtists = new Set<string>()
						let refEraStart = Infinity
						let refEraEnd = 0

						referenceReleases.forEach((release) => {
							const info = release.basic_information
							info.genres?.forEach((g) => refGenres.add(g.toLowerCase()))
							info.styles?.forEach((s) => refStyles.add(s.toLowerCase()))
							info.artists?.forEach((a) => refArtists.add(a.name.toLowerCase()))
							if (info.year) {
								refEraStart = Math.min(refEraStart, info.year)
								refEraEnd = Math.max(refEraEnd, info.year)
							}
						})

						// Expand era window by ±5 years for similar releases
						const eraBuffer = 5
						refEraStart = refEraStart === Infinity ? 0 : refEraStart - eraBuffer
						refEraEnd = refEraEnd === 0 ? 9999 : refEraEnd + eraBuffer

						// Step 3: Find releases with similar musical characteristics
						filteredReleases = filteredReleases.filter((release) => {
							const info = release.basic_information
							let similarityScore = 0

							// Genre matching (highest weight)
							const releaseGenres = (info.genres || []).map((g) => g.toLowerCase())
							const genreMatches = releaseGenres.filter((g) => refGenres.has(g)).length
							if (genreMatches > 0) similarityScore += genreMatches * 3

							// Style matching (high weight)
							const releaseStyles = (info.styles || []).map((s) => s.toLowerCase())
							const styleMatches = releaseStyles.filter((s) => refStyles.has(s)).length
							if (styleMatches > 0) similarityScore += styleMatches * 2

							// Era matching (medium weight)
							const releaseYear = info.year || 0
							if (releaseYear >= refEraStart && releaseYear <= refEraEnd) {
								similarityScore += 1
							}

							// Artist collaboration (bonus points for shared artists)
							const releaseArtists = (info.artists || []).map((a) => a.name.toLowerCase())
							const artistMatches = releaseArtists.filter((a) => refArtists.has(a)).length
							if (artistMatches > 0) similarityScore += artistMatches * 1

							// Require minimum similarity score (at least genre or style match)
							return similarityScore >= 2
						})
					} else {
						// Fallback: if no reference releases found, keep all releases
						// This prevents returning empty results if similarTo doesn't match anything
					}
				}

				// Filter by general query with smart term matching
				if (query) {
					const queryTerms = query
						.toLowerCase()
						.split(/\s+/)
						.filter((term) => term.length > 2) // Split into words, ignore short words
					
					// Check if this looks like a genre/style/mood query
					const genreStyleTerms = [
						'ambient', 'drone', 'progressive', 'rock', 'jazz', 'blues', 'electronic', 'techno', 'house',
						'metal', 'punk', 'folk', 'country', 'classical', 'hip', 'hop', 'rap', 'soul', 'funk', 'disco',
						'reggae', 'ska', 'indie', 'alternative', 'psychedelic', 'experimental', 'avant-garde',
						'minimal', 'downtempo', 'chillout', 'trance', 'dubstep', 'garage', 'post-rock', 'post-punk',
						'new wave', 'synthpop', 'industrial', 'gothic', 'darkwave', 'shoegaze', 'grunge', 'hardcore',
						// Add mood terms as well
						'moody', 'melancholy', 'melancholic', 'introspective', 'sad', 'contemplative', 'somber', 'nostalgic',
						'energetic', 'upbeat', 'happy', 'cheerful', 'vibrant', 'mellow', 'chill', 'relaxing', 'peaceful',
						'dark', 'brooding', 'intense', 'romantic', 'intimate', 'sensual'
					]
					
					const isGenreStyleMoodQuery = queryTerms.some(term => genreStyleTerms.includes(term.toLowerCase()))
					
					filteredReleases = filteredReleases.filter((release) => {
						const info = release.basic_information

						// Create searchable text from all release information
						const searchableText = [
							...(info.artists?.map((artist) => artist.name) || []),
							info.title,
							...(info.genres || []),
							...(info.styles || []),
							...(info.labels?.map((label) => label.name) || []),
						]
							.join(' ')
							.toLowerCase()

						if (isGenreStyleMoodQuery) {
							// For genre/style/mood queries, use OR logic - at least one term must match
							const matchingTerms = queryTerms.filter((term) => searchableText.includes(term)).length
							return matchingTerms >= 1
						} else {
							// For other queries, require at least 50% of terms to match for relevance
							const matchingTerms = queryTerms.filter((term) => searchableText.includes(term)).length
							return matchingTerms >= Math.ceil(queryTerms.length * 0.5)
						}
					})
				}

				// Calculate relevance scores for query-based searches
				if (query) {
					const queryTerms = query
						.toLowerCase()
						.split(/\s+/)
						.filter((term) => term.length > 2)

					filteredReleases = filteredReleases
						.map((release): ReleaseWithRelevance => {
							const info = release.basic_information
							const searchableText = [
								...(info.artists?.map((artist) => artist.name) || []),
								info.title,
								...(info.genres || []),
								...(info.styles || []),
								...(info.labels?.map((label) => label.name) || []),
							]
								.join(' ')
								.toLowerCase()

							// Count matching terms for relevance scoring
							const matchingTerms = queryTerms.filter((term) => searchableText.includes(term)).length
							const relevanceScore = matchingTerms / queryTerms.length

							return { ...release, relevanceScore }
						})
						.sort((a, b) => {
							// Sort by relevance first, then rating, then date
							const aRelevance = a.relevanceScore || 0
							const bRelevance = b.relevanceScore || 0
							if (aRelevance !== bRelevance) {
								return bRelevance - aRelevance
							}
							if (a.rating !== b.rating) {
								return b.rating - a.rating
							}
							return new Date(b.date_added).getTime() - new Date(a.date_added).getTime()
						})
				} else {
					// Sort by rating (highest first) and then by date added (newest first)
					filteredReleases.sort((a, b) => {
						if (a.rating !== b.rating) {
							return b.rating - a.rating
						}
						return new Date(b.date_added).getTime() - new Date(a.date_added).getTime()
					})
				}

				// Limit results
				const recommendations = filteredReleases.slice(0, limit)

				// Build response
				let text = `**Context-Aware Music Recommendations**\n\n`

				if (genre || decade || similarTo || query || format || moodGenres.length > 0) {
					text += `**Filters Applied:**\n`
					if (genre) text += `• Genre: ${genre}\n`
					if (decade) text += `• Decade: ${decade}\n`
					if (format) text += `• Format: ${format}\n`
					if (similarTo) text += `• Similar to: ${similarTo}\n`
					if (query) text += `• Query: ${query}\n`
					if (moodGenres.length > 0) text += `• Mood-based genres: ${moodGenres.slice(0, 5).join(', ')}\n`
					text += `\n`
				}

				if (moodInfo) {
					text += moodInfo
				}

				text += `Found ${filteredReleases.length} matching releases in your collection (showing top ${recommendations.length}):\n\n`

				if (recommendations.length === 0) {
					text += `No releases found matching your criteria. Try:\n`
					text += `• Broadening your search terms\n`
					text += `• Using different genres or decades\n`
					text += `• Searching for specific artists you own\n`
					text += `• Using mood descriptors like "mellow", "energetic", "melancholy"\n`
					text += `• Trying contextual terms like "Sunday evening", "rainy day", "workout"\n`
				} else {
					recommendations.forEach((release, index) => {
						const info = release.basic_information
						const artists = info.artists.map((a) => a.name).join(', ')
						const formats = info.formats?.map((f) => f.name).join(', ') || 'Unknown'
						const genres = info.genres?.join(', ') || 'Unknown'
						const year = info.year || 'Unknown'
						const rating = release.rating > 0 ? ` ⭐${release.rating}` : ''
						const relevance =
							query && 'relevanceScore' in release ? ` (${Math.round((release as ReleaseWithRelevance).relevanceScore! * 100)}% match)` : ''

						text += `${index + 1}. **${artists} - ${info.title}** (${year})${rating}${relevance}\n`
						text += `   Format: ${formats} | Genres: ${genres}\n`
						if (info.styles && info.styles.length > 0) {
							text += `   Styles: ${info.styles.join(', ')}\n`
						}
						text += `   Release ID: ${release.id}\n\n`
					})

					text += `**Tip:** Use the get_release tool with any Release ID for detailed information about specific albums.`
				}

				return {
					content: [
						{
							type: 'text',
							text,
						},
					],
				}
			} catch (error) {
				throw new Error(`Failed to get recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`)
			}
		}

		case 'get_cache_stats': {
			try {
				if (!cachedClient) {
					return {
						content: [
							{
								type: 'text',
								text: '**Cache Statistics**\n\nCaching is not available - no KV storage configured. All requests go directly to the Discogs API.',
							},
						],
					}
				}

				const stats = await cachedClient.getCacheStats()
				
				let text = '**Cache Performance Statistics**\n\n'
				text += `📊 **Total Cache Entries:** ${stats.totalEntries}\n`
				text += `⏳ **Pending Requests:** ${stats.pendingRequests}\n\n`
				
				if (Object.keys(stats.entriesByType).length > 0) {
					text += '**Cached Data Types:**\n'
					for (const [type, count] of Object.entries(stats.entriesByType)) {
						text += `• ${type}: ${count} entries\n`
					}
				} else {
					text += '**No cached data** - Cache is empty or recently cleared\n'
				}
				
				text += '\n**Cache Benefits:**\n'
				text += '• Reduced API calls to Discogs\n'
				text += '• Faster response times\n'
				text += '• Better rate limit compliance\n'
				text += '• Request deduplication for concurrent users\n'

				return {
					content: [
						{
							type: 'text',
							text,
						},
					],
				}
			} catch (error) {
				throw new Error(`Failed to get cache stats: ${error instanceof Error ? error.message : 'Unknown error'}`)
			}
		}

		default:
			throw new Error(`Unknown authenticated tool: ${name}`)
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
			const legacyTools = [
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
			const dualHandlerTools = ['auth_status'] // Tools that exist in both handlers
			
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
				const result = await handleToolsCall(params, httpRequest)
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
