/**
 * JSON-RPC 2.0 Type Definitions
 * Based on https://www.jsonrpc.org/specification
 */

export interface JSONRPCRequest {
	jsonrpc: '2.0'
	method: string
	params?: unknown
	id?: string | number | null
}

export interface JSONRPCResponse {
	jsonrpc: '2.0'
	id: string | number | null
	result?: unknown
	error?: JSONRPCError
}

export interface JSONRPCError {
	code: number
	message: string
	data?: unknown
}

export interface JSONRPCNotification {
	jsonrpc: '2.0'
	method: string
	params?: unknown
}

// Standard JSON-RPC error codes
export enum ErrorCode {
	ParseError = -32700,
	InvalidRequest = -32600,
	MethodNotFound = -32601,
	InvalidParams = -32602,
	InternalError = -32603,
}

// MCP-specific error codes (must be above -32000)
export enum MCPErrorCode {
	Unauthorized = -32001,
	RateLimited = -32002,
	ResourceNotFound = -32003,
	InvalidResource = -32004,
	ToolNotFound = -32005,
	ToolExecutionError = -32006,
	PromptNotFound = -32007,
	DiscogsAPIError = -32008,
	AuthenticationFailed = -32009,
	ServerNotInitialized = -32010,
}

// Type guards
export function isJSONRPCRequest(msg: unknown): msg is JSONRPCRequest {
	return (
		typeof msg === 'object' &&
		msg !== null &&
		'jsonrpc' in msg &&
		msg.jsonrpc === '2.0' &&
		'method' in msg &&
		typeof (msg as JSONRPCRequest).method === 'string'
	)
}

export function isJSONRPCNotification(msg: unknown): msg is JSONRPCNotification {
	return isJSONRPCRequest(msg) && !('id' in msg)
}

export function hasId(msg: JSONRPCRequest): msg is JSONRPCRequest & { id: string | number } {
	return 'id' in msg && msg.id !== null && msg.id !== undefined
}

/**
 * Map different error types to appropriate JSON-RPC error codes
 */
export function mapErrorToJSONRPC(error: unknown): { code: number; message: string; data?: unknown } {
	if (error instanceof Error) {
		const message = error.message

		// Authentication errors
		if (message.includes('Authentication required') || message.includes('Unauthorized')) {
			return {
				code: MCPErrorCode.Unauthorized,
				message: 'Authentication required',
				data: { originalMessage: message },
			}
		}

		// Rate limiting errors
		if (message.includes('Rate limit') || message.includes('Too many requests')) {
			return {
				code: MCPErrorCode.RateLimited,
				message: 'Rate limit exceeded',
				data: { originalMessage: message },
			}
		}

		// Discogs API errors
		if (message.includes('Failed to fetch') || message.includes('Discogs')) {
			return {
				code: MCPErrorCode.DiscogsAPIError,
				message: 'Discogs API error',
				data: { originalMessage: message },
			}
		}

		// Prompt errors (check before generic "not found")
		if (message.includes('Prompt not found') || message.includes('Unknown prompt')) {
			return {
				code: MCPErrorCode.PromptNotFound,
				message: 'Prompt not found',
				data: { originalMessage: message },
			}
		}

		// Tool errors
		if (message.includes('Unknown tool') || message.includes('Tool not found')) {
			return {
				code: MCPErrorCode.ToolNotFound,
				message: 'Tool not found',
				data: { originalMessage: message },
			}
		}

		if (message.includes('Tool execution') || message.includes('Failed to call')) {
			return {
				code: MCPErrorCode.ToolExecutionError,
				message: 'Tool execution failed',
				data: { originalMessage: message },
			}
		}

		// Parameter validation errors
		if (message.includes('requires a') || message.includes('parameter')) {
			return {
				code: ErrorCode.InvalidParams,
				message: message,
				data: { originalMessage: message },
			}
		}

		// Resource errors (check after more specific errors)
		if (message.includes('Resource not found') || message.includes('not found')) {
			return {
				code: MCPErrorCode.ResourceNotFound,
				message: 'Resource not found',
				data: { originalMessage: message },
			}
		}

		// Server initialization errors
		if (message.includes('not initialized')) {
			return {
				code: MCPErrorCode.ServerNotInitialized,
				message: 'Server not initialized',
				data: { originalMessage: message },
			}
		}

		// Generic internal error
		return {
			code: ErrorCode.InternalError,
			message: 'Internal error',
			data: { originalMessage: message },
		}
	}

	// Unknown error type
	return {
		code: ErrorCode.InternalError,
		message: 'Internal error',
		data: { error: String(error) },
	}
}
