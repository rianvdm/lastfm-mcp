import { describe, it, expect } from 'vitest'
import {
	parseMessage,
	createResponse,
	createError,
	createParseError,
	createInvalidRequestError,
	createMethodNotFoundError,
	serializeResponse,
} from '../../src/protocol/parser'
import { ErrorCode, mapErrorToJSONRPC, MCPErrorCode } from '../../src/types/jsonrpc'

describe('JSON-RPC Parser', () => {
	describe('parseMessage', () => {
		it('should parse valid JSON-RPC request', () => {
			const body = JSON.stringify({
				jsonrpc: '2.0',
				method: 'test',
				params: { foo: 'bar' },
				id: 1,
			})

			const result = parseMessage(body)
			expect(result).toEqual({
				jsonrpc: '2.0',
				method: 'test',
				params: { foo: 'bar' },
				id: 1,
			})
		})

		it('should parse valid JSON-RPC notification', () => {
			const body = JSON.stringify({
				jsonrpc: '2.0',
				method: 'notify',
				params: { data: 'test' },
			})

			const result = parseMessage(body)
			expect(result).toEqual({
				jsonrpc: '2.0',
				method: 'notify',
				params: { data: 'test' },
			})
			expect(result.id).toBeUndefined()
		})

		it('should throw parse error for invalid JSON', () => {
			expect(() => parseMessage('invalid json')).toThrow()

			try {
				parseMessage('invalid json')
			} catch (error) {
				expect(error).toEqual(createParseError())
			}
		})

		it('should throw invalid request for missing jsonrpc field', () => {
			const body = JSON.stringify({
				method: 'test',
				id: 1,
			})

			expect(() => parseMessage(body)).toThrow()
		})

		it('should throw invalid request for wrong jsonrpc version', () => {
			const body = JSON.stringify({
				jsonrpc: '1.0',
				method: 'test',
				id: 1,
			})

			expect(() => parseMessage(body)).toThrow()
		})

		it('should throw invalid request for missing method', () => {
			const body = JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
			})

			expect(() => parseMessage(body)).toThrow()
		})
	})

	describe('createResponse', () => {
		it('should create successful response', () => {
			const response = createResponse(1, { result: 'success' })
			expect(response).toEqual({
				jsonrpc: '2.0',
				id: 1,
				result: { result: 'success' },
			})
		})

		it('should handle null id', () => {
			const response = createResponse(null, 'test')
			expect(response).toEqual({
				jsonrpc: '2.0',
				id: null,
				result: 'test',
			})
		})

		it('should handle string id', () => {
			const response = createResponse('abc-123', true)
			expect(response).toEqual({
				jsonrpc: '2.0',
				id: 'abc-123',
				result: true,
			})
		})
	})

	describe('createError', () => {
		it('should create error response', () => {
			const response = createError(1, ErrorCode.MethodNotFound, 'Method not found')
			expect(response).toEqual({
				jsonrpc: '2.0',
				id: 1,
				error: {
					code: ErrorCode.MethodNotFound,
					message: 'Method not found',
				},
			})
		})

		it('should include error data when provided', () => {
			const response = createError(1, ErrorCode.InvalidParams, 'Invalid params', {
				details: 'Missing required field',
			})
			expect(response).toEqual({
				jsonrpc: '2.0',
				id: 1,
				error: {
					code: ErrorCode.InvalidParams,
					message: 'Invalid params',
					data: { details: 'Missing required field' },
				},
			})
		})
	})

	describe('error creators', () => {
		it('should create parse error', () => {
			const error = createParseError()
			expect(error.code).toBe(ErrorCode.ParseError)
			expect(error.message).toBe('Parse error')
		})

		it('should create invalid request error', () => {
			const error = createInvalidRequestError()
			expect(error.code).toBe(ErrorCode.InvalidRequest)
			expect(error.message).toBe('Invalid Request')
		})

		it('should create method not found error', () => {
			const error = createMethodNotFoundError('unknown_method')
			expect(error.code).toBe(ErrorCode.MethodNotFound)
			expect(error.message).toBe('Method not found')
			expect(error.data).toEqual({ method: 'unknown_method' })
		})
	})

	describe('serializeResponse', () => {
		it('should serialize response to JSON string', () => {
			const response = createResponse(1, { test: true })
			const serialized = serializeResponse(response)
			const parsed = JSON.parse(serialized)
			expect(parsed).toEqual(response)
		})
	})

	describe('mapErrorToJSONRPC', () => {
		it('should map authentication errors correctly', () => {
			const error = new Error('Authentication required')
			const result = mapErrorToJSONRPC(error)
			
			expect(result.code).toBe(MCPErrorCode.Unauthorized)
			expect(result.message).toBe('Authentication required')
			expect(result.data).toEqual({ originalMessage: 'Authentication required' })
		})

		it('should map rate limit errors correctly', () => {
			const error = new Error('Rate limit exceeded')
			const result = mapErrorToJSONRPC(error)
			
			expect(result.code).toBe(MCPErrorCode.RateLimited)
			expect(result.message).toBe('Rate limit exceeded')
			expect(result.data).toEqual({ originalMessage: 'Rate limit exceeded' })
		})

		it('should map Discogs API errors correctly', () => {
			const error = new Error('Failed to fetch release 123: 404 Not Found')
			const result = mapErrorToJSONRPC(error)
			
			expect(result.code).toBe(MCPErrorCode.DiscogsAPIError)
			expect(result.message).toBe('Discogs API error')
			expect(result.data).toEqual({ originalMessage: 'Failed to fetch release 123: 404 Not Found' })
		})

		it('should map resource not found errors correctly', () => {
			const error = new Error('Resource not found')
			const result = mapErrorToJSONRPC(error)
			
			expect(result.code).toBe(MCPErrorCode.ResourceNotFound)
			expect(result.message).toBe('Resource not found')
			expect(result.data).toEqual({ originalMessage: 'Resource not found' })
		})

		it('should map tool errors correctly', () => {
			const error = new Error('Unknown tool: invalid_tool')
			const result = mapErrorToJSONRPC(error)
			
			expect(result.code).toBe(MCPErrorCode.ToolNotFound)
			expect(result.message).toBe('Tool not found')
			expect(result.data).toEqual({ originalMessage: 'Unknown tool: invalid_tool' })
		})

		it('should map tool execution errors correctly', () => {
			const error = new Error('Tool execution failed: timeout')
			const result = mapErrorToJSONRPC(error)
			
			expect(result.code).toBe(MCPErrorCode.ToolExecutionError)
			expect(result.message).toBe('Tool execution failed')
			expect(result.data).toEqual({ originalMessage: 'Tool execution failed: timeout' })
		})

		it('should map prompt errors correctly', () => {
			const error = new Error('Prompt not found: invalid_prompt')
			const result = mapErrorToJSONRPC(error)
			
			expect(result.code).toBe(MCPErrorCode.PromptNotFound)
			expect(result.message).toBe('Prompt not found')
			expect(result.data).toEqual({ originalMessage: 'Prompt not found: invalid_prompt' })
		})

		it('should map server initialization errors correctly', () => {
			const error = new Error('Server not initialized')
			const result = mapErrorToJSONRPC(error)
			
			expect(result.code).toBe(MCPErrorCode.ServerNotInitialized)
			expect(result.message).toBe('Server not initialized')
			expect(result.data).toEqual({ originalMessage: 'Server not initialized' })
		})

		it('should map generic errors to internal error', () => {
			const error = new Error('Some unexpected error')
			const result = mapErrorToJSONRPC(error)
			
			expect(result.code).toBe(ErrorCode.InternalError)
			expect(result.message).toBe('Internal error')
			expect(result.data).toEqual({ originalMessage: 'Some unexpected error' })
		})

		it('should handle non-Error objects', () => {
			const error = 'string error'
			const result = mapErrorToJSONRPC(error)
			
			expect(result.code).toBe(ErrorCode.InternalError)
			expect(result.message).toBe('Internal error')
			expect(result.data).toEqual({ error: 'string error' })
		})

		it('should handle null/undefined errors', () => {
			const result = mapErrorToJSONRPC(null)
			
			expect(result.code).toBe(ErrorCode.InternalError)
			expect(result.message).toBe('Internal error')
			expect(result.data).toEqual({ error: 'null' })
		})
	})
})
