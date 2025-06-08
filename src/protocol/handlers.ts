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
import { discogsClient, type DiscogsCollectionItem } from '../clients/discogs'

// Track initialization state
let isInitialized = false

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
 * Handle initialize request
 */
export function handleInitialize(params: unknown): InitializeResult {
	// Validate params using comprehensive validation
	validateInitializeParams(params)

	// Check protocol version compatibility
	// For now, we accept any version but return our version
	console.log(`Client protocol version: ${params.protocolVersion}`)
	console.log(`Client info: ${params.clientInfo.name} v${params.clientInfo.version}`)

	// Mark as initialized in both places
	isInitialized = true
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
	const resources: Resource[] = [
		{
			uri: 'discogs://collection',
			name: 'User Collection',
			description: 'Complete Discogs collection for the authenticated user',
			mimeType: 'application/json',
		},
		{
			uri: 'discogs://release/{id}',
			name: 'Release Details',
			description: 'Detailed information about a specific Discogs release. Replace {id} with the release ID.',
			mimeType: 'application/json',
		},
		{
			uri: 'discogs://search?q={query}',
			name: 'Collection Search',
			description: "Search results from user's collection. Replace {query} with search terms.",
			mimeType: 'application/json',
		},
	]

	return { resources }
}

/**
 * Handle resources/read request
 */
export async function handleResourcesRead(params: unknown, session: SessionPayload, env?: Env): Promise<ResourcesReadResult> {
	// Validate params using comprehensive validation
	validateResourcesReadParams(params)

	const { uri } = params

	try {
		// Parse the URI to determine what resource is being requested
		if (uri === 'discogs://collection') {
			// Get user's complete collection
			const consumerKey = env?.DISCOGS_CONSUMER_KEY || ''
			const consumerSecret = env?.DISCOGS_CONSUMER_SECRET || ''

			const userProfile = await discogsClient.getUserProfile(session.accessToken, session.accessTokenSecret, consumerKey, consumerSecret)
			const collection = await discogsClient.searchCollection(
				userProfile.username,
				session.accessToken,
				session.accessTokenSecret,
				{
					per_page: 100, // Start with first 100 items
				},
				consumerKey,
				consumerSecret,
			)

			return {
				contents: [
					{
						uri,
						mimeType: 'application/json',
						text: JSON.stringify(collection, null, 2),
					},
				],
			}
		} else if (uri.startsWith('discogs://release/')) {
			// Get specific release details
			const releaseId = uri.replace('discogs://release/', '')
			if (!releaseId || releaseId.includes('{')) {
				throw new Error('Invalid release URI - must specify a release ID')
			}

			const release = await discogsClient.getRelease(releaseId, session.accessToken, session.accessTokenSecret)

			return {
				contents: [
					{
						uri,
						mimeType: 'application/json',
						text: JSON.stringify(release, null, 2),
					},
				],
			}
		} else if (uri.startsWith('discogs://search?q=')) {
			// Search user's collection
			const url = new URL(uri.replace('discogs://', 'https://example.com/'))
			const query = url.searchParams.get('q')

			if (!query) {
				throw new Error('Invalid search URI - query parameter is required')
			}

			const consumerKey = env?.DISCOGS_CONSUMER_KEY || ''
			const consumerSecret = env?.DISCOGS_CONSUMER_SECRET || ''

			const userProfile = await discogsClient.getUserProfile(session.accessToken, session.accessTokenSecret, consumerKey, consumerSecret)
			const searchResults = await discogsClient.searchCollection(
				userProfile.username,
				session.accessToken,
				session.accessTokenSecret,
				{
					query,
					per_page: 50,
				},
				consumerKey,
				consumerSecret,
			)

			return {
				contents: [
					{
						uri,
						mimeType: 'application/json',
						text: JSON.stringify(searchResults, null, 2),
					},
				],
			}
		} else {
			throw new Error(`Unsupported resource URI: ${uri}`)
		}
	} catch (error) {
		console.error('Error reading resource:', error)
		throw new Error(`Failed to read resource: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
async function handleToolsCall(params: unknown): Promise<ToolCallResult> {
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
			const message = args?.message || 'Hello from Discogs MCP!'
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
			return {
				content: [
					{
						type: 'text',
						text: `Discogs MCP Server v1.0.0\n\nStatus: Running\nProtocol: MCP 2024-11-05\nFeatures:\n- Resources: Collection, Releases, Search\n- Authentication: OAuth 1.0a\n- Rate Limiting: Enabled\n\nTo get started, authenticate at http://localhost:8787/login`,
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
async function handleAuthenticatedToolsCall(params: unknown, session: SessionPayload, env?: Env): Promise<ToolCallResult> {
	// Validate params
	if (!isToolsCallParams(params)) {
		throw new Error('Invalid tools/call params - name and arguments are required')
	}

	const { name, arguments: args } = params

	// Get tool schema for validation
	const toolSchemas: Record<string, unknown> = {
		search_collection: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				per_page: { type: 'number', minimum: 1, maximum: 100 },
			},
			required: ['query'],
		},
		get_release: {
			type: 'object',
			properties: {
				release_id: { type: 'string' },
			},
			required: ['release_id'],
		},
		get_collection_stats: {
			type: 'object',
			properties: {},
			required: [],
		},
		get_recommendations: {
			type: 'object',
			properties: {
				limit: { type: 'number', minimum: 1, maximum: 50 },
				genre: { type: 'string' },
				decade: { type: 'string' },
				similar_to: { type: 'string' },
				query: { type: 'string' },
			},
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
		case 'search_collection': {
			const query = args?.query as string
			if (!query) {
				throw new Error('search_collection requires a query parameter')
			}

			const perPage = Math.min(Math.max((args?.per_page as number) || 50, 1), 100)

			try {
				const consumerKey = env?.DISCOGS_CONSUMER_KEY || ''
				const consumerSecret = env?.DISCOGS_CONSUMER_SECRET || ''

				const userProfile = await discogsClient.getUserProfile(session.accessToken, session.accessTokenSecret, consumerKey, consumerSecret)
				const results = await discogsClient.searchCollection(
					userProfile.username,
					session.accessToken,
					session.accessTokenSecret,
					{
						query,
						per_page: perPage,
					},
					consumerKey,
					consumerSecret,
				)

				const summary = `Found ${results.pagination.items} results for "${query}" in your collection (showing ${results.releases.length} items):`

				// Create formatted list with release IDs
				const releaseList = results.releases
					.map((release) => {
						const info = release.basic_information
						const artists = info.artists.map((a) => a.name).join(', ')
						const formats = info.formats.map((f) => f.name).join(', ')
						return `• [ID: ${release.id}] ${artists} - ${info.title} (${info.year}) [${formats}]`
					})
					.join('\n')

				// Create structured data for programmatic use
				const structuredData = {
					query,
					total_results: results.pagination.items,
					page: results.pagination.page,
					per_page: results.pagination.per_page,
					total_pages: results.pagination.pages,
					releases: results.releases.map((release) => ({
						release_id: release.id,
						instance_id: release.instance_id,
						title: release.basic_information.title,
						artists: release.basic_information.artists.map((a) => ({ name: a.name, id: a.id })),
						year: release.basic_information.year,
						formats: release.basic_information.formats.map((f) => f.name),
						genres: release.basic_information.genres,
						styles: release.basic_information.styles,
						labels: release.basic_information.labels.map((l) => ({ name: l.name, catno: l.catno })),
						rating: release.rating,
						date_added: release.date_added,
						resource_url: release.basic_information.resource_url,
					})),
				}

				return {
					content: [
						{
							type: 'text',
							text: `${summary}\n\n${releaseList}\n\n**Tip:** Use the release IDs with the get_release tool for detailed information about specific albums.`,
						},
						{
							type: 'text',
							text: `\n**Structured Data:**\n\`\`\`json\n${JSON.stringify(structuredData, null, 2)}\n\`\`\``,
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
				const release = await discogsClient.getRelease(releaseId, session.accessToken, session.accessTokenSecret)

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

				const userProfile = await discogsClient.getUserProfile(session.accessToken, session.accessTokenSecret, consumerKey, consumerSecret)
				const stats = await discogsClient.getCollectionStats(
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

			// Type for release with relevance score
			type ReleaseWithRelevance = DiscogsCollectionItem & { relevanceScore?: number }

			try {
				const consumerKey = env?.DISCOGS_CONSUMER_KEY || ''
				const consumerSecret = env?.DISCOGS_CONSUMER_SECRET || ''

				const userProfile = await discogsClient.getUserProfile(session.accessToken, session.accessTokenSecret, consumerKey, consumerSecret)

				// Get full collection for context-aware recommendations
				const fullCollection = await discogsClient.searchCollection(
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
					const pageResults = await discogsClient.searchCollection(
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

				// Filter by genre
				if (genre) {
					filteredReleases = filteredReleases.filter(
						(release) =>
							release.basic_information.genres?.some((g) => g.toLowerCase().includes(genre.toLowerCase())) ||
							release.basic_information.styles?.some((s) => s.toLowerCase().includes(genre.toLowerCase())),
					)
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

				// Filter by similarity to artist/album
				if (similarTo) {
					const similarLower = similarTo.toLowerCase()
					filteredReleases = filteredReleases.filter((release) => {
						const info = release.basic_information
						const artistMatch = info.artists?.some((artist) => artist.name.toLowerCase().includes(similarLower))
						const titleMatch = info.title.toLowerCase().includes(similarLower)
						const genreMatch = info.genres?.some((g) => g.toLowerCase().includes(similarLower))
						const styleMatch = info.styles?.some((s) => s.toLowerCase().includes(similarLower))
						return artistMatch || titleMatch || genreMatch || styleMatch
					})
				}

				// Filter by general query with smart term matching
				if (query) {
					const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2) // Split into words, ignore short words
					filteredReleases = filteredReleases.filter((release) => {
						const info = release.basic_information
						
						// Create searchable text from all release information
						const searchableText = [
							...info.artists?.map(artist => artist.name) || [],
							info.title,
							...info.genres || [],
							...info.styles || [],
							...info.labels?.map(label => label.name) || []
						].join(' ').toLowerCase()
						
						// Check if any query terms match
						return queryTerms.some(term => searchableText.includes(term))
					})
				}

				// Calculate relevance scores for query-based searches
				if (query) {
					const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2)
					
					filteredReleases = filteredReleases.map((release): ReleaseWithRelevance => {
						const info = release.basic_information
						const searchableText = [
							...info.artists?.map(artist => artist.name) || [],
							info.title,
							...info.genres || [],
							...info.styles || [],
							...info.labels?.map(label => label.name) || []
						].join(' ').toLowerCase()
						
						// Count matching terms for relevance scoring
						const matchingTerms = queryTerms.filter(term => searchableText.includes(term)).length
						const relevanceScore = matchingTerms / queryTerms.length
						
						return { ...release, relevanceScore }
					}).sort((a, b) => {
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

				if (genre || decade || similarTo || query) {
					text += `**Filters Applied:**\n`
					if (genre) text += `• Genre: ${genre}\n`
					if (decade) text += `• Decade: ${decade}\n`
					if (similarTo) text += `• Similar to: ${similarTo}\n`
					if (query) text += `• Query: ${query}\n`
					text += `\n`
				}

				text += `Found ${filteredReleases.length} matching releases in your collection (showing top ${recommendations.length}):\n\n`

				if (recommendations.length === 0) {
					text += `No releases found matching your criteria. Try:\n`
					text += `• Broadening your search terms\n`
					text += `• Using different genres or decades\n`
					text += `• Searching for specific artists you own\n`
				} else {
					recommendations.forEach((release, index) => {
						const info = release.basic_information
						const artists = info.artists.map((a) => a.name).join(', ')
						const genres = info.genres?.join(', ') || 'Unknown'
						const year = info.year || 'Unknown'
						const rating = release.rating > 0 ? ` ⭐${release.rating}` : ''
						const relevance = query && 'relevanceScore' in release ? ` (${Math.round((release as ReleaseWithRelevance).relevanceScore! * 100)}% match)` : ''

						text += `${index + 1}. **${artists} - ${info.title}** (${year})${rating}${relevance}\n`
						text += `   Genres: ${genres}\n`
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

	// All other methods require initialization
	if (!isInitialized) {
		if (hasId(request)) {
			return createError(id!, MCPErrorCode.ServerNotInitialized, 'Server not initialized')
		}
		return null
	}

	// Some methods don't require authentication
	switch (method) {
		case 'resources/list': {
			const resourcesResult = handleResourcesList()
			return hasId(request) ? createResponse(id!, resourcesResult) : null
		}

		case 'tools/list': {
			// Return all available Discogs tools
			const tools = [
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
					name: 'search_collection',
					description: "Search through the user's Discogs collection",
					inputSchema: {
						type: 'object',
						properties: {
							query: {
								type: 'string',
								description: 'Search query (artist, album, track, etc.)',
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
					description: "Get context-aware music recommendations based on the user's collection",
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
								description: 'Filter recommendations by genre (e.g., "Jazz", "Rock", "Electronic")',
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
								description: 'General query for contextual recommendations (e.g., "hard bop albums from the 60s")',
							},
						},
						required: [],
					},
				},
			]
			return hasId(request) ? createResponse(id!, { tools }) : null
		}

		case 'tools/call': {
			try {
				// First try non-authenticated tools
				const result = await handleToolsCall(params)
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
					const session = await verifyAuthentication(httpRequest, jwtSecret)
					console.log('Session verification result:', session ? 'SUCCESS' : 'FAILED')

					if (!session) {
						return hasId(request)
							? createError(id!, MCPErrorCode.Unauthorized, 'Authentication required. Please visit /login to authenticate with Discogs.')
							: null
					}

					try {
						const authenticatedResult = await handleAuthenticatedToolsCall(params, session, env)
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

	const session = await verifyAuthentication(httpRequest, jwtSecret)
	if (!session) {
		if (hasId(request)) {
			return createError(id!, MCPErrorCode.Unauthorized, 'Authentication required. Please visit /login to authenticate with Discogs.')
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
	isInitialized = false
}
