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
