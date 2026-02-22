// ABOUTME: JSON-RPC 2.0 message parser and response/error builder functions.
// ABOUTME: Parses incoming JSON-RPC requests and constructs well-formed responses.

import { JSONRPCRequest, JSONRPCResponse, JSONRPCError, ErrorCode, isJSONRPCRequest } from '../types/jsonrpc'

/**
 * Parse and validate a JSON-RPC message from a string
 */
export function parseMessage(body: string): JSONRPCRequest {
	let parsed: unknown

	try {
		parsed = JSON.parse(body)
	} catch {
		throw createParseError()
	}

	if (!isJSONRPCRequest(parsed)) {
		throw createInvalidRequestError()
	}

	return parsed
}

/**
 * Create a successful JSON-RPC response
 */
export function createResponse(id: string | number | null, result: unknown): JSONRPCResponse {
	return {
		jsonrpc: '2.0',
		id,
		result,
	}
}

/**
 * Create an error JSON-RPC response
 */
export function createError(id: string | number | null, code: number, message: string, data?: unknown): JSONRPCResponse {
	const error: JSONRPCError = {
		code,
		message,
	}

	if (data !== undefined) {
		error.data = data
	}

	return {
		jsonrpc: '2.0',
		id,
		error,
	}
}

/**
 * Create a parse error (for invalid JSON)
 */
export function createParseError(): JSONRPCError {
	return {
		code: ErrorCode.ParseError,
		message: 'Parse error',
	}
}

/**
 * Create an invalid request error
 */
export function createInvalidRequestError(): JSONRPCError {
	return {
		code: ErrorCode.InvalidRequest,
		message: 'Invalid Request',
	}
}

/**
 * Create a method not found error
 */
export function createMethodNotFoundError(method: string): JSONRPCError {
	return {
		code: ErrorCode.MethodNotFound,
		message: 'Method not found',
		data: { method },
	}
}

/**
 * Create an invalid params error
 */
export function createInvalidParamsError(details?: string): JSONRPCError {
	return {
		code: ErrorCode.InvalidParams,
		message: 'Invalid params',
		data: details,
	}
}

/**
 * Create an internal error
 */
export function createInternalError(details?: unknown): JSONRPCError {
	return {
		code: ErrorCode.InternalError,
		message: 'Internal error',
		data: details,
	}
}

/**
 * Serialize a JSON-RPC response to string
 */
export function serializeResponse(response: JSONRPCResponse): string {
	return JSON.stringify(response)
}
