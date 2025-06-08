/**
 * MCP Protocol Compliance Validation
 * Ensures all messages and responses conform to the MCP specification
 */

import { JSONRPCRequest, JSONRPCResponse, ErrorCode } from '../types/jsonrpc'
import {
	InitializeParams,
	InitializeResult,
	PROTOCOL_VERSION,
	ClientCapabilities,
	ServerCapabilities,
	Resource,
	ResourcesReadParams,
	Prompt,
	PromptsGetParams,
	PromptArgument,
	PromptMessage,
} from '../types/mcp'

// Protocol state tracking
let protocolState: 'uninitialized' | 'initialized' = 'uninitialized'

/**
 * Reset protocol state (for testing)
 */
export function resetProtocolState(): void {
	protocolState = 'uninitialized'
}

/**
 * Get current protocol state
 */
export function getProtocolState(): string {
	return protocolState
}

/**
 * Validation error class
 */
export class ValidationError extends Error {
	constructor(
		message: string,
		public code: number = ErrorCode.InvalidParams,
	) {
		super(message)
		this.name = 'ValidationError'
	}
}

/**
 * Validate JSON-RPC message structure
 */
export function validateJSONRPCMessage(msg: unknown): asserts msg is JSONRPCRequest {
	if (typeof msg !== 'object' || msg === null) {
		throw new ValidationError('Message must be an object', ErrorCode.InvalidRequest)
	}

	const request = msg as Record<string, unknown>

	// Check required fields
	if (request.jsonrpc !== '2.0') {
		throw new ValidationError('Invalid or missing jsonrpc version', ErrorCode.InvalidRequest)
	}

	if (typeof request.method !== 'string' || request.method.length === 0) {
		throw new ValidationError('Method must be a non-empty string', ErrorCode.InvalidRequest)
	}

	// Validate ID if present (for requests, not notifications)
	if ('id' in request && request.id !== null && typeof request.id !== 'string' && typeof request.id !== 'number') {
		throw new ValidationError('ID must be a string, number, or null', ErrorCode.InvalidRequest)
	}

	// Validate params if present
	if ('params' in request && request.params !== null && typeof request.params !== 'object') {
		throw new ValidationError('Params must be an object or null', ErrorCode.InvalidRequest)
	}
}

/**
 * Validate MCP protocol flow
 */
export function validateProtocolFlow(method: string): void {
	switch (method) {
		case 'initialize':
			// Allow multiple initialize requests - this is common with proxies and reconnections
			// The handler will return the same initialization response
			break

		case 'initialized':
			// The initialized notification can be sent after initialize has been called
			// No validation needed here - it's just a notification
			break

		case 'tools/list':
		case 'tools/call':
		case 'resources/list':
		case 'resources/read':
		case 'prompts/list':
		case 'prompts/get':
			// For HTTP-based MCP servers (stateless), we don't enforce initialization state
			// The client (mcp-remote) handles the initialization flow properly
			// These methods can be called directly since each HTTP request is independent
			break

		default:
			// For unknown methods, we don't enforce initialization state in stateless mode
			// This allows the server to work with various MCP clients
			break
	}
}

/**
 * Mark server as initialized
 */
export function markInitialized(): void {
	protocolState = 'initialized'
}

/**
 * Validate initialize parameters
 */
export function validateInitializeParams(params: unknown): asserts params is InitializeParams {
	if (typeof params !== 'object' || params === null) {
		throw new ValidationError('Initialize params must be an object')
	}

	const p = params as Record<string, unknown>

	// Validate protocol version
	if (typeof p.protocolVersion !== 'string') {
		throw new ValidationError('protocolVersion must be a string')
	}

	// Validate client info
	if (typeof p.clientInfo !== 'object' || p.clientInfo === null) {
		throw new ValidationError('clientInfo must be an object')
	}

	const clientInfo = p.clientInfo as Record<string, unknown>
	if (typeof clientInfo.name !== 'string' || typeof clientInfo.version !== 'string') {
		throw new ValidationError('clientInfo must have name and version strings')
	}

	// Validate capabilities - make it optional
	if ('capabilities' in p && p.capabilities !== undefined) {
		if (typeof p.capabilities !== 'object' || p.capabilities === null) {
			throw new ValidationError('capabilities must be an object')
		}
		validateClientCapabilities(p.capabilities)
	}
}

/**
 * Validate client capabilities
 */
export function validateClientCapabilities(capabilities: unknown): asserts capabilities is ClientCapabilities {
	if (typeof capabilities !== 'object' || capabilities === null) {
		throw new ValidationError('Client capabilities must be an object')
	}

	const caps = capabilities as Record<string, unknown>

	// Validate roots capability if present
	if ('roots' in caps && caps.roots !== undefined) {
		if (typeof caps.roots !== 'object' || caps.roots === null) {
			throw new ValidationError('roots capability must be an object')
		}
		const roots = caps.roots as Record<string, unknown>
		if ('listChanged' in roots && typeof roots.listChanged !== 'boolean') {
			throw new ValidationError('roots.listChanged must be a boolean')
		}
	}

	// Validate sampling capability if present
	if ('sampling' in caps && caps.sampling !== undefined) {
		if (typeof caps.sampling !== 'object' || caps.sampling === null) {
			throw new ValidationError('sampling capability must be an object')
		}
	}

	// Validate experimental capability if present
	if ('experimental' in caps && caps.experimental !== undefined) {
		if (typeof caps.experimental !== 'object' || caps.experimental === null) {
			throw new ValidationError('experimental capability must be an object')
		}
	}
}

/**
 * Validate initialize result
 */
export function validateInitializeResult(result: unknown): asserts result is InitializeResult {
	if (typeof result !== 'object' || result === null) {
		throw new ValidationError('Initialize result must be an object')
	}

	const r = result as Record<string, unknown>

	// Validate protocol version
	if (r.protocolVersion !== PROTOCOL_VERSION) {
		throw new ValidationError(`protocolVersion must be ${PROTOCOL_VERSION}`)
	}

	// Validate server info
	if (typeof r.serverInfo !== 'object' || r.serverInfo === null) {
		throw new ValidationError('serverInfo must be an object')
	}

	const serverInfo = r.serverInfo as Record<string, unknown>
	if (typeof serverInfo.name !== 'string' || typeof serverInfo.version !== 'string') {
		throw new ValidationError('serverInfo must have name and version strings')
	}

	// Validate capabilities
	if (typeof r.capabilities !== 'object' || r.capabilities === null) {
		throw new ValidationError('capabilities must be an object')
	}

	validateServerCapabilities(r.capabilities)
}

/**
 * Validate server capabilities
 */
export function validateServerCapabilities(capabilities: unknown): asserts capabilities is ServerCapabilities {
	if (typeof capabilities !== 'object' || capabilities === null) {
		throw new ValidationError('Server capabilities must be an object')
	}

	const caps = capabilities as Record<string, unknown>

	// Validate prompts capability if present
	if ('prompts' in caps && caps.prompts !== undefined) {
		if (typeof caps.prompts !== 'object' || caps.prompts === null) {
			throw new ValidationError('prompts capability must be an object')
		}
		const prompts = caps.prompts as Record<string, unknown>
		if ('listChanged' in prompts && typeof prompts.listChanged !== 'boolean') {
			throw new ValidationError('prompts.listChanged must be a boolean')
		}
	}

	// Validate resources capability if present
	if ('resources' in caps && caps.resources !== undefined) {
		if (typeof caps.resources !== 'object' || caps.resources === null) {
			throw new ValidationError('resources capability must be an object')
		}
		const resources = caps.resources as Record<string, unknown>
		if ('subscribe' in resources && typeof resources.subscribe !== 'boolean') {
			throw new ValidationError('resources.subscribe must be a boolean')
		}
		if ('listChanged' in resources && typeof resources.listChanged !== 'boolean') {
			throw new ValidationError('resources.listChanged must be a boolean')
		}
	}

	// Validate tools capability if present
	if ('tools' in caps && caps.tools !== undefined) {
		if (typeof caps.tools !== 'object' || caps.tools === null) {
			throw new ValidationError('tools capability must be an object')
		}
		const tools = caps.tools as Record<string, unknown>
		if ('listChanged' in tools && typeof tools.listChanged !== 'boolean') {
			throw new ValidationError('tools.listChanged must be a boolean')
		}
	}

	// Validate logging capability if present
	if ('logging' in caps && caps.logging !== undefined) {
		if (typeof caps.logging !== 'object' || caps.logging === null) {
			throw new ValidationError('logging capability must be an object')
		}
	}

	// Validate experimental capability if present
	if ('experimental' in caps && caps.experimental !== undefined) {
		if (typeof caps.experimental !== 'object' || caps.experimental === null) {
			throw new ValidationError('experimental capability must be an object')
		}
	}
}

/**
 * Validate resource URI format
 */
export function validateResourceURI(uri: string): void {
	if (typeof uri !== 'string' || uri.length === 0) {
		throw new ValidationError('Resource URI must be a non-empty string')
	}

	// Basic URI validation - should start with a scheme
	if (!uri.includes('://') && !uri.startsWith('discogs:')) {
		throw new ValidationError('Resource URI must have a valid scheme')
	}
}

/**
 * Validate resource object
 */
export function validateResource(resource: unknown): asserts resource is Resource {
	if (typeof resource !== 'object' || resource === null) {
		throw new ValidationError('Resource must be an object')
	}

	const r = resource as Record<string, unknown>

	// Validate required fields
	if (typeof r.uri !== 'string') {
		throw new ValidationError('Resource uri must be a string')
	}
	validateResourceURI(r.uri)

	if (typeof r.name !== 'string') {
		throw new ValidationError('Resource name must be a string')
	}

	// Validate optional fields
	if ('description' in r && r.description !== undefined && typeof r.description !== 'string') {
		throw new ValidationError('Resource description must be a string')
	}

	if ('mimeType' in r && r.mimeType !== undefined && typeof r.mimeType !== 'string') {
		throw new ValidationError('Resource mimeType must be a string')
	}
}

/**
 * Validate resources/read parameters
 */
export function validateResourcesReadParams(params: unknown): asserts params is ResourcesReadParams {
	if (typeof params !== 'object' || params === null) {
		throw new ValidationError('resources/read params must be an object')
	}

	const p = params as Record<string, unknown>

	if (typeof p.uri !== 'string') {
		throw new ValidationError('uri parameter must be a string')
	}

	validateResourceURI(p.uri)
}

/**
 * Validate prompt argument
 */
export function validatePromptArgument(arg: unknown): asserts arg is PromptArgument {
	if (typeof arg !== 'object' || arg === null) {
		throw new ValidationError('Prompt argument must be an object')
	}

	const a = arg as Record<string, unknown>

	if (typeof a.name !== 'string') {
		throw new ValidationError('Prompt argument name must be a string')
	}

	if ('description' in a && a.description !== undefined && typeof a.description !== 'string') {
		throw new ValidationError('Prompt argument description must be a string')
	}

	if ('required' in a && a.required !== undefined && typeof a.required !== 'boolean') {
		throw new ValidationError('Prompt argument required must be a boolean')
	}
}

/**
 * Validate prompt object
 */
export function validatePrompt(prompt: unknown): asserts prompt is Prompt {
	if (typeof prompt !== 'object' || prompt === null) {
		throw new ValidationError('Prompt must be an object')
	}

	const p = prompt as Record<string, unknown>

	if (typeof p.name !== 'string') {
		throw new ValidationError('Prompt name must be a string')
	}

	if ('description' in p && p.description !== undefined && typeof p.description !== 'string') {
		throw new ValidationError('Prompt description must be a string')
	}

	if ('arguments' in p && p.arguments !== undefined) {
		if (!Array.isArray(p.arguments)) {
			throw new ValidationError('Prompt arguments must be an array')
		}
		p.arguments.forEach((arg, index) => {
			try {
				validatePromptArgument(arg)
			} catch (error) {
				throw new ValidationError(`Invalid prompt argument at index ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`)
			}
		})
	}
}

/**
 * Validate prompts/get parameters
 */
export function validatePromptsGetParams(params: unknown): asserts params is PromptsGetParams {
	if (typeof params !== 'object' || params === null) {
		throw new ValidationError('prompts/get params must be an object')
	}

	const p = params as Record<string, unknown>

	if (typeof p.name !== 'string') {
		throw new ValidationError('name parameter must be a string')
	}

	if ('arguments' in p && p.arguments !== undefined) {
		if (typeof p.arguments !== 'object' || p.arguments === null) {
			throw new ValidationError('arguments parameter must be an object')
		}
	}
}

/**
 * Validate prompt message
 */
export function validatePromptMessage(message: unknown): asserts message is PromptMessage {
	if (typeof message !== 'object' || message === null) {
		throw new ValidationError('Prompt message must be an object')
	}

	const m = message as Record<string, unknown>

	if (m.role !== 'user' && m.role !== 'assistant') {
		throw new ValidationError('Prompt message role must be "user" or "assistant"')
	}

	if (typeof m.content !== 'object' || m.content === null) {
		throw new ValidationError('Prompt message content must be an object')
	}

	const content = m.content as Record<string, unknown>
	if (content.type !== 'text') {
		throw new ValidationError('Prompt message content type must be "text"')
	}

	if (typeof content.text !== 'string') {
		throw new ValidationError('Prompt message content text must be a string')
	}
}

/**
 * Validate tool input schema
 */
export function validateToolInputSchema(schema: unknown): void {
	if (typeof schema !== 'object' || schema === null) {
		throw new ValidationError('Tool input schema must be an object')
	}

	const s = schema as Record<string, unknown>

	// Must be a JSON Schema object
	if (s.type !== 'object') {
		throw new ValidationError('Tool input schema type must be "object"')
	}

	if ('properties' in s && s.properties !== undefined) {
		if (typeof s.properties !== 'object' || s.properties === null) {
			throw new ValidationError('Tool input schema properties must be an object')
		}
	}

	if ('required' in s && s.required !== undefined) {
		if (!Array.isArray(s.required)) {
			throw new ValidationError('Tool input schema required must be an array')
		}
		if (!s.required.every((item) => typeof item === 'string')) {
			throw new ValidationError('Tool input schema required items must be strings')
		}
	}
}

/**
 * Validate tool arguments against schema
 */
export function validateToolArguments(args: unknown, schema: unknown): void {
	if (typeof schema !== 'object' || schema === null) {
		return // No schema to validate against
	}

	const s = schema as Record<string, unknown>

	// Check required parameters
	if (Array.isArray(s.required) && s.required.length > 0) {
		if (typeof args !== 'object' || args === null) {
			throw new ValidationError(`Missing required parameters: ${s.required.join(', ')}`)
		}

		const argObj = args as Record<string, unknown>
		for (const required of s.required) {
			if (typeof required === 'string' && !(required in argObj)) {
				throw new ValidationError(`Missing required parameter: ${required}`)
			}
		}
	}

	// Basic type validation for properties
	if (typeof s.properties === 'object' && s.properties !== null && typeof args === 'object' && args !== null) {
		const properties = s.properties as Record<string, unknown>
		const argObj = args as Record<string, unknown>

		for (const [key, value] of Object.entries(argObj)) {
			if (key in properties) {
				const propSchema = properties[key] as Record<string, unknown>
				if (typeof propSchema === 'object' && propSchema !== null && 'type' in propSchema) {
					const expectedType = propSchema.type
					const actualType = typeof value

					// Basic type checking
					if (expectedType === 'string' && actualType !== 'string') {
						throw new ValidationError(`Parameter ${key} must be a string`)
					}
					if (expectedType === 'number' && actualType !== 'number') {
						throw new ValidationError(`Parameter ${key} must be a number`)
					}
					if (expectedType === 'boolean' && actualType !== 'boolean') {
						throw new ValidationError(`Parameter ${key} must be a boolean`)
					}
				}
			}
		}
	}
}

/**
 * Validate JSON-RPC response structure
 */
export function validateJSONRPCResponse(response: unknown): asserts response is JSONRPCResponse {
	if (typeof response !== 'object' || response === null) {
		throw new ValidationError('Response must be an object', ErrorCode.InternalError)
	}

	const resp = response as Record<string, unknown>

	if (resp.jsonrpc !== '2.0') {
		throw new ValidationError('Response must have jsonrpc: "2.0"', ErrorCode.InternalError)
	}

	// Must have either result or error, but not both
	const hasResult = 'result' in resp
	const hasError = 'error' in resp

	if (!hasResult && !hasError) {
		throw new ValidationError('Response must have either result or error', ErrorCode.InternalError)
	}

	if (hasResult && hasError) {
		throw new ValidationError('Response cannot have both result and error', ErrorCode.InternalError)
	}

	// Validate ID (must match request ID)
	if ('id' in resp && resp.id !== null && typeof resp.id !== 'string' && typeof resp.id !== 'number') {
		throw new ValidationError('Response ID must be a string, number, or null', ErrorCode.InternalError)
	}

	// Validate error structure if present
	if (hasError) {
		const error = resp.error
		if (typeof error !== 'object' || error === null) {
			throw new ValidationError('Error must be an object', ErrorCode.InternalError)
		}

		const err = error as Record<string, unknown>
		if (typeof err.code !== 'number') {
			throw new ValidationError('Error code must be a number', ErrorCode.InternalError)
		}

		if (typeof err.message !== 'string') {
			throw new ValidationError('Error message must be a string', ErrorCode.InternalError)
		}
	}
}
