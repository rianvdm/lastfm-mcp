/**
 * MCP Protocol Handlers
 * Implements the core MCP methods
 */

import { JSONRPCRequest, hasId } from '../types/jsonrpc'
import { createResponse, createError, createMethodNotFoundError, createInvalidParamsError } from './parser'
import { InitializeParams, InitializeResult, PROTOCOL_VERSION, SERVER_INFO, DEFAULT_CAPABILITIES } from '../types/mcp'

// Track initialization state
let isInitialized = false

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
 * Main method router
 */
export async function handleMethod(request: JSONRPCRequest) {
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

	// Route to appropriate handler
	switch (method) {
		// Resources
		case 'resources/list':
			// TODO: Implement in E2
			return hasId(request) ? createResponse(id!, { resources: [] }) : null

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
