/**
 * MCP Protocol Handlers
 * Implements the core MCP methods
 */

import { JSONRPCRequest, hasId } from '../types/jsonrpc'
import { createResponse, createError, createMethodNotFoundError, createInvalidParamsError } from './parser'
import { InitializeParams, InitializeResult, PROTOCOL_VERSION, SERVER_INFO, DEFAULT_CAPABILITIES, Resource, ResourcesListResult, ResourcesReadParams, ResourcesReadResult } from '../types/mcp'
import { verifySessionToken, SessionPayload } from '../auth/jwt'
import { discogsClient } from '../clients/discogs'

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
		const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
			const [key, value] = cookie.trim().split('=')
			if (key && value) {
				acc[key] = value
			}
			return acc
		}, {} as Record<string, string>)

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
	// Validate params
	if (!isInitializeParams(params)) {
		throw createInvalidParamsError('Invalid initialize params')
	}

	// Check protocol version compatibility
	// For now, we accept any version but return our version
	console.log(`Client protocol version: ${params.protocolVersion}`)
	console.log(`Client info: ${params.clientInfo.name} v${params.clientInfo.version}`)

	// Mark as initialized
	isInitialized = true

	// Return server capabilities
	return {
		protocolVersion: PROTOCOL_VERSION,
		capabilities: DEFAULT_CAPABILITIES,
		serverInfo: SERVER_INFO,
	}
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
			description: 'Search results from user\'s collection. Replace {query} with search terms.',
			mimeType: 'application/json',
		},
	]

	return { resources }
}

/**
 * Handle resources/read request
 */
export async function handleResourcesRead(params: unknown, session: SessionPayload): Promise<ResourcesReadResult> {
	// Validate params
	if (!isResourcesReadParams(params)) {
		throw createInvalidParamsError('Invalid resources/read params - uri is required')
	}

	const { uri } = params

	try {
		// Parse the URI to determine what resource is being requested
		if (uri === 'discogs://collection') {
			// Get user's complete collection
			const userProfile = await discogsClient.getUserProfile(session.accessToken)
			const collection = await discogsClient.searchCollection(userProfile.username, session.accessToken, {
				per_page: 100, // Start with first 100 items
			})

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

			const release = await discogsClient.getRelease(releaseId, session.accessToken)

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

			const userProfile = await discogsClient.getUserProfile(session.accessToken)
			const searchResults = await discogsClient.searchCollection(userProfile.username, session.accessToken, {
				query,
				per_page: 50,
			})

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

	switch (name) {
		case 'ping': {
			const message = args?.message || 'Hello from Discogs MCP!'
			return {
				content: [
					{
						type: 'text',
						text: `Pong! You said: ${message}`
					}
				]
			}
		}
		case 'server_info': {
			return {
				content: [
					{
						type: 'text',
						text: `Discogs MCP Server v1.0.0\n\nStatus: Running\nProtocol: MCP 2024-11-05\nFeatures:\n- Resources: Collection, Releases, Search\n- Authentication: OAuth 1.0a\n- Rate Limiting: Enabled\n\nTo get started, authenticate at http://localhost:8787/login`
					}
				]
			}
		}
		default:
			throw new Error(`Unknown tool: ${name}. This tool may require authentication.`)
	}
}

/**
 * Handle authenticated tools
 */
async function handleAuthenticatedToolsCall(params: unknown, session: SessionPayload): Promise<ToolCallResult> {
	// Validate params
	if (!isToolsCallParams(params)) {
		throw new Error('Invalid tools/call params - name and arguments are required')
	}

	const { name, arguments: args } = params

	switch (name) {
		case 'search_collection': {
			const query = args?.query as string
			if (!query) {
				throw new Error('search_collection requires a query parameter')
			}

			const perPage = Math.min(Math.max((args?.per_page as number) || 50, 1), 100)

			try {
				const userProfile = await discogsClient.getUserProfile(session.accessToken)
				const results = await discogsClient.searchCollection(userProfile.username, session.accessToken, {
					query,
					per_page: perPage,
				})

				const summary = `Found ${results.pagination.items} results for "${query}" in your collection (showing ${results.releases.length} items):`
				const releaseList = results.releases.map(release => {
					const info = release.basic_information
					const artists = info.artists.map(a => a.name).join(', ')
					const formats = info.formats.map(f => f.name).join(', ')
					return `• ${artists} - ${info.title} (${info.year}) [${formats}]`
				}).join('\n')

				return {
					content: [
						{
							type: 'text',
							text: `${summary}\n\n${releaseList}`
						}
					]
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
				const release = await discogsClient.getRelease(releaseId, session.accessToken)
				
				const artists = release.artists.map(a => a.name).join(', ')
				const formats = release.formats.map(f => `${f.name} (${f.qty})`).join(', ')
				const genres = release.genres.join(', ')
				const styles = release.styles.join(', ')
				const labels = release.labels.map(l => `${l.name} (${l.catno})`).join(', ')
				
				let text = `**${artists} - ${release.title}**\n\n`
				text += `Year: ${release.year || 'Unknown'}\n`
				text += `Formats: ${formats}\n`
				text += `Genres: ${genres}\n`
				if (styles) text += `Styles: ${styles}\n`
				text += `Labels: ${labels}\n`
				if (release.country) text += `Country: ${release.country}\n`
				
				if (release.tracklist && release.tracklist.length > 0) {
					text += `\n**Tracklist:**\n`
					release.tracklist.forEach(track => {
						text += `${track.position}. ${track.title}`
						if (track.duration) text += ` (${track.duration})`
						text += '\n'
					})
				}

				return {
					content: [
						{
							type: 'text',
							text
						}
					]
				}
			} catch (error) {
				throw new Error(`Failed to get release: ${error instanceof Error ? error.message : 'Unknown error'}`)
			}
		}

		case 'get_collection_stats': {
			try {
				const userProfile = await discogsClient.getUserProfile(session.accessToken)
				const stats = await discogsClient.getCollectionStats(userProfile.username, session.accessToken)

				let text = `**Collection Statistics for ${userProfile.username}**\n\n`
				text += `Total Releases: ${stats.totalReleases}\n`
				text += `Average Rating: ${stats.averageRating.toFixed(1)} (${stats.ratedReleases} rated releases)\n\n`

				text += `**Top Genres:**\n`
				const topGenres = Object.entries(stats.genreBreakdown)
					.sort(([,a], [,b]) => b - a)
					.slice(0, 5)
				topGenres.forEach(([genre, count]) => {
					text += `• ${genre}: ${count} releases\n`
				})

				text += `\n**By Decade:**\n`
				const topDecades = Object.entries(stats.decadeBreakdown)
					.sort(([,a], [,b]) => b - a)
					.slice(0, 5)
				topDecades.forEach(([decade, count]) => {
					text += `• ${decade}s: ${count} releases\n`
				})

				text += `\n**Top Formats:**\n`
				const topFormats = Object.entries(stats.formatBreakdown)
					.sort(([,a], [,b]) => b - a)
					.slice(0, 5)
				topFormats.forEach(([format, count]) => {
					text += `• ${format}: ${count} releases\n`
				})

				return {
					content: [
						{
							type: 'text',
							text
						}
					]
				}
			} catch (error) {
				throw new Error(`Failed to get collection stats: ${error instanceof Error ? error.message : 'Unknown error'}`)
			}
		}

		case 'get_recommendations': {
			const _limit = Math.min(Math.max((args?.limit as number) || 10, 1), 50)

			try {
				const userProfile = await discogsClient.getUserProfile(session.accessToken)
				const stats = await discogsClient.getCollectionStats(userProfile.username, session.accessToken)

				// Simple recommendation algorithm: suggest releases from top genres that user doesn't have
				const topGenres = Object.entries(stats.genreBreakdown)
					.sort(([,a], [,b]) => b - a)
					.slice(0, 3)
					.map(([genre]) => genre)

				let text = `**Music Recommendations Based on Your Collection**\n\n`
				text += `Based on your collection of ${stats.totalReleases} releases, here are some recommendations:\n\n`
				
				text += `**Your Top Genres:** ${topGenres.join(', ')}\n\n`
				text += `**Recommendations:**\n`
				text += `• Explore more releases from your favorite genres\n`
				text += `• Look for releases from the ${Object.keys(stats.decadeBreakdown).sort().reverse()[0]}s era\n`
				const topFormat = Object.entries(stats.formatBreakdown).sort(([,a], [,b]) => b - a)[0]?.[0] || 'vinyl'
				text += `• Consider adding more ${topFormat} releases\n`
				text += `• Search for releases from labels you already collect from\n\n`
				text += `Use the search_collection tool to find specific artists or albums you might want to add!`

				return {
					content: [
						{
							type: 'text',
							text
						}
					]
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
	return (
		typeof params === 'object' &&
		params !== null &&
		'name' in params &&
		typeof (params as Record<string, unknown>).name === 'string'
	)
}

/**
 * Type guard for ResourcesReadParams
 */
function isResourcesReadParams(params: unknown): params is ResourcesReadParams {
	return (
		typeof params === 'object' &&
		params !== null &&
		'uri' in params &&
		typeof (params as ResourcesReadParams).uri === 'string'
	)
}

/**
 * Main method router
 */
export async function handleMethod(request: JSONRPCRequest, httpRequest?: Request, jwtSecret?: string) {
	const { method, params, id } = request

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
			return createError(id!, -32002, 'Server not initialized')
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
								default: 'Hello from Discogs MCP!'
							}
						},
						required: []
					}
				},
				{
					name: 'server_info',
					description: 'Get information about the Discogs MCP server',
					inputSchema: {
						type: 'object',
						properties: {},
						required: []
					}
				},
				{
					name: 'search_collection',
					description: 'Search through the user\'s Discogs collection',
					inputSchema: {
						type: 'object',
						properties: {
							query: {
								type: 'string',
								description: 'Search query (artist, album, track, etc.)'
							},
							per_page: {
								type: 'number',
								description: 'Number of results per page (1-100)',
								default: 50,
								minimum: 1,
								maximum: 100
							}
						},
						required: ['query']
					}
				},
				{
					name: 'get_release',
					description: 'Get detailed information about a specific Discogs release',
					inputSchema: {
						type: 'object',
						properties: {
							release_id: {
								type: 'string',
								description: 'The Discogs release ID'
							}
						},
						required: ['release_id']
					}
				},
				{
					name: 'get_collection_stats',
					description: 'Get statistics about the user\'s collection',
					inputSchema: {
						type: 'object',
						properties: {},
						required: []
					}
				},
				{
					name: 'get_recommendations',
					description: 'Get music recommendations based on the user\'s collection',
					inputSchema: {
						type: 'object',
						properties: {
							limit: {
								type: 'number',
								description: 'Number of recommendations to return',
								default: 10,
								minimum: 1,
								maximum: 50
							}
						},
						required: []
					}
				}
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
					// Check if we have authentication context
					if (!httpRequest || !jwtSecret) {
						return hasId(request) ? createError(id!, -32603, 'Internal error: Missing authentication context for authenticated tool') : null
					}

					const session = await verifyAuthentication(httpRequest, jwtSecret)
					if (!session) {
						return hasId(request) ? createError(id!, -32001, 'Authentication required. Please visit /login to authenticate with Discogs.') : null
					}

					try {
						const authenticatedResult = await handleAuthenticatedToolsCall(params, session)
						return hasId(request) ? createResponse(id!, authenticatedResult) : null
					} catch (authError) {
						const message = authError instanceof Error ? authError.message : 'Failed to call authenticated tool'
						return hasId(request) ? createError(id!, -32603, message) : null
					}
				}

				const message = error instanceof Error ? error.message : 'Failed to call tool'
				return hasId(request) ? createError(id!, -32603, message) : null
			}
		}

		case 'prompts/list':
			// TODO: Implement in G1
			return hasId(request) ? createResponse(id!, { prompts: [] }) : null
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
			return createError(id!, -32001, 'Authentication required. Please visit /login to authenticate with Discogs.')
		}
		return null
	}

	// Route to appropriate handler for authenticated methods
	switch (method) {
		// Resources

		case 'resources/read': {
			try {
				const result = await handleResourcesRead(params, session)
				return hasId(request) ? createResponse(id!, result) : null
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Failed to read resource'
				return hasId(request) ? createError(id!, -32603, message) : null
			}
		}

		// Tools (authenticated tools would go here in the future)

		// Prompts
		case 'prompts/get':
			// TODO: Implement in G2-G3
			return hasId(request) ? createError(id!, -32601, 'Not implemented yet') : null

		default:
			if (hasId(request)) {
				const error = createMethodNotFoundError(method)
				return createError(id!, error.code, error.message, error.data)
			}
			return null
	}
}

/**
 * Type guard for InitializeParams
 */
function isInitializeParams(params: unknown): params is InitializeParams {
	return (
		typeof params === 'object' &&
		params !== null &&
		'protocolVersion' in params &&
		typeof (params as InitializeParams).protocolVersion === 'string' &&
		'capabilities' in params &&
		typeof (params as InitializeParams).capabilities === 'object' &&
		'clientInfo' in params &&
		typeof (params as InitializeParams).clientInfo === 'object'
	)
}

/**
 * Reset initialization state (for testing)
 */
export function resetInitialization(): void {
	isInitialized = false
}
