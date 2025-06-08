/**
 * MCP Protocol Handlers
 * Implements the core MCP methods
 */

import { JSONRPCRequest, hasId } from '../types/jsonrpc'
import { createResponse, createError, createMethodNotFoundError, createInvalidParamsError } from './parser'
import { InitializeParams, InitializeResult, PROTOCOL_VERSION, SERVER_INFO, DEFAULT_CAPABILITIES, Resource, ResourcesListResult } from '../types/mcp'
import { verifySessionToken, SessionPayload } from '../auth/jwt'

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

	// Route to appropriate handler
	switch (method) {
		// Resources
		case 'resources/list': {
			const resourcesResult = handleResourcesList()
			return hasId(request) ? createResponse(id!, resourcesResult) : null
		}

		case 'resources/read':
			// TODO: Implement in E3
			return hasId(request) ? createError(id!, -32601, 'Not implemented yet') : null

		// Tools
		case 'tools/list':
			// TODO: Implement in F1
			return hasId(request) ? createResponse(id!, { tools: [] }) : null

		case 'tools/call':
			// TODO: Implement in F2-F4
			return hasId(request) ? createError(id!, -32601, 'Not implemented yet') : null

		// Prompts
		case 'prompts/list':
			// TODO: Implement in G1
			return hasId(request) ? createResponse(id!, { prompts: [] }) : null

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
