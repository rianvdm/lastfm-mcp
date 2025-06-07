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
import { ErrorCode } from '../../src/types/jsonrpc'

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
})
