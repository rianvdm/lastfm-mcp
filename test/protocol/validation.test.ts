import { describe, it, expect, beforeEach } from 'vitest'
import {
	validateJSONRPCMessage,
	validateProtocolFlow,
	validateInitializeParams,
	validateResourcesReadParams,
	validatePromptsGetParams,
	validateToolArguments,
	validateJSONRPCResponse,
	markInitialized,
	resetProtocolState,
	getProtocolState,
	ValidationError,
} from '../../src/protocol/validation'
import { ErrorCode } from '../../src/types/jsonrpc'

describe('MCP Protocol Validation', () => {
	beforeEach(() => {
		resetProtocolState()
	})

	describe('validateJSONRPCMessage', () => {
		it('should validate valid JSON-RPC request', () => {
			const validRequest = {
				jsonrpc: '2.0',
				method: 'test',
				params: { foo: 'bar' },
				id: 1,
			}

			expect(() => validateJSONRPCMessage(validRequest)).not.toThrow()
		})

		it('should validate valid JSON-RPC notification', () => {
			const validNotification = {
				jsonrpc: '2.0',
				method: 'test',
				params: { foo: 'bar' },
			}

			expect(() => validateJSONRPCMessage(validNotification)).not.toThrow()
		})

		it('should reject non-object messages', () => {
			expect(() => validateJSONRPCMessage('invalid')).toThrow(ValidationError)
			expect(() => validateJSONRPCMessage(null)).toThrow(ValidationError)
			expect(() => validateJSONRPCMessage(123)).toThrow(ValidationError)
		})

		it('should reject missing jsonrpc field', () => {
			const invalidRequest = {
				method: 'test',
				id: 1,
			}

			expect(() => validateJSONRPCMessage(invalidRequest)).toThrow(ValidationError)
		})

		it('should reject wrong jsonrpc version', () => {
			const invalidRequest = {
				jsonrpc: '1.0',
				method: 'test',
				id: 1,
			}

			expect(() => validateJSONRPCMessage(invalidRequest)).toThrow(ValidationError)
		})

		it('should reject missing method', () => {
			const invalidRequest = {
				jsonrpc: '2.0',
				id: 1,
			}

			expect(() => validateJSONRPCMessage(invalidRequest)).toThrow(ValidationError)
		})

		it('should reject empty method', () => {
			const invalidRequest = {
				jsonrpc: '2.0',
				method: '',
				id: 1,
			}

			expect(() => validateJSONRPCMessage(invalidRequest)).toThrow(ValidationError)
		})

		it('should reject invalid ID types', () => {
			const invalidRequest = {
				jsonrpc: '2.0',
				method: 'test',
				id: {},
			}

			expect(() => validateJSONRPCMessage(invalidRequest)).toThrow(ValidationError)
		})

		it('should reject invalid params types', () => {
			const invalidRequest = {
				jsonrpc: '2.0',
				method: 'test',
				params: 'invalid',
				id: 1,
			}

			expect(() => validateJSONRPCMessage(invalidRequest)).toThrow(ValidationError)
		})
	})

	describe('validateProtocolFlow', () => {
		it('should allow initialize when uninitialized', () => {
			expect(getProtocolState()).toBe('uninitialized')
			expect(() => validateProtocolFlow('initialize')).not.toThrow()
		})

		it('should reject initialize when already initialized', () => {
			markInitialized()
			expect(() => validateProtocolFlow('initialize')).toThrow(ValidationError)
		})

		it('should reject other methods when uninitialized', () => {
			expect(() => validateProtocolFlow('tools/list')).toThrow(ValidationError)
			expect(() => validateProtocolFlow('resources/list')).toThrow(ValidationError)
			expect(() => validateProtocolFlow('prompts/list')).toThrow(ValidationError)
		})

		it('should allow other methods when initialized', () => {
			markInitialized()
			expect(() => validateProtocolFlow('tools/list')).not.toThrow()
			expect(() => validateProtocolFlow('resources/list')).not.toThrow()
			expect(() => validateProtocolFlow('prompts/list')).not.toThrow()
		})

		it('should handle initialized notification correctly', () => {
			markInitialized()
			expect(() => validateProtocolFlow('initialized')).not.toThrow()
		})
	})

	describe('validateInitializeParams', () => {
		it('should validate valid initialize params', () => {
			const validParams = {
				protocolVersion: '2024-11-05',
				capabilities: {
					roots: { listChanged: true },
					sampling: {},
					experimental: {},
				},
				clientInfo: {
					name: 'Test Client',
					version: '1.0.0',
				},
			}

			expect(() => validateInitializeParams(validParams)).not.toThrow()
		})

		it('should reject non-object params', () => {
			expect(() => validateInitializeParams(null)).toThrow(ValidationError)
			expect(() => validateInitializeParams('invalid')).toThrow(ValidationError)
		})

		it('should reject missing protocolVersion', () => {
			const invalidParams = {
				capabilities: {},
				clientInfo: { name: 'Test', version: '1.0' },
			}

			expect(() => validateInitializeParams(invalidParams)).toThrow(ValidationError)
		})

		it('should reject invalid clientInfo', () => {
			const invalidParams = {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: { name: 'Test' }, // missing version
			}

			expect(() => validateInitializeParams(invalidParams)).toThrow(ValidationError)
		})

		it('should reject invalid capabilities', () => {
			const invalidParams = {
				protocolVersion: '2024-11-05',
				capabilities: 'invalid',
				clientInfo: { name: 'Test', version: '1.0' },
			}

			expect(() => validateInitializeParams(invalidParams)).toThrow(ValidationError)
		})
	})

	describe('validateResourcesReadParams', () => {
		it('should validate valid params', () => {
			const validParams = {
				uri: 'discogs://collection',
			}

			expect(() => validateResourcesReadParams(validParams)).not.toThrow()
		})

		it('should reject non-object params', () => {
			expect(() => validateResourcesReadParams(null)).toThrow(ValidationError)
			expect(() => validateResourcesReadParams('invalid')).toThrow(ValidationError)
		})

		it('should reject missing uri', () => {
			const invalidParams = {}

			expect(() => validateResourcesReadParams(invalidParams)).toThrow(ValidationError)
		})

		it('should reject invalid uri format', () => {
			const invalidParams = {
				uri: 'invalid-uri',
			}

			expect(() => validateResourcesReadParams(invalidParams)).toThrow(ValidationError)
		})
	})

	describe('validatePromptsGetParams', () => {
		it('should validate valid params', () => {
			const validParams = {
				name: 'test_prompt',
				arguments: { query: 'test' },
			}

			expect(() => validatePromptsGetParams(validParams)).not.toThrow()
		})

		it('should validate params without arguments', () => {
			const validParams = {
				name: 'test_prompt',
			}

			expect(() => validatePromptsGetParams(validParams)).not.toThrow()
		})

		it('should reject non-object params', () => {
			expect(() => validatePromptsGetParams(null)).toThrow(ValidationError)
			expect(() => validatePromptsGetParams('invalid')).toThrow(ValidationError)
		})

		it('should reject missing name', () => {
			const invalidParams = {
				arguments: { query: 'test' },
			}

			expect(() => validatePromptsGetParams(invalidParams)).toThrow(ValidationError)
		})

		it('should reject invalid arguments type', () => {
			const invalidParams = {
				name: 'test_prompt',
				arguments: 'invalid',
			}

			expect(() => validatePromptsGetParams(invalidParams)).toThrow(ValidationError)
		})
	})

	describe('validateToolArguments', () => {
		it('should validate arguments against schema', () => {
			const schema = {
				type: 'object',
				properties: {
					query: { type: 'string' },
					limit: { type: 'number' },
				},
				required: ['query'],
			}

			const validArgs = {
				query: 'test',
				limit: 10,
			}

			expect(() => validateToolArguments(validArgs, schema)).not.toThrow()
		})

		it('should reject missing required parameters', () => {
			const schema = {
				type: 'object',
				properties: {
					query: { type: 'string' },
				},
				required: ['query'],
			}

			const invalidArgs = {}

			expect(() => validateToolArguments(invalidArgs, schema)).toThrow(ValidationError)
		})

		it('should validate parameter types', () => {
			const schema = {
				type: 'object',
				properties: {
					query: { type: 'string' },
					limit: { type: 'number' },
					enabled: { type: 'boolean' },
				},
				required: [],
			}

			// Valid types
			expect(() => validateToolArguments({ query: 'test' }, schema)).not.toThrow()
			expect(() => validateToolArguments({ limit: 10 }, schema)).not.toThrow()
			expect(() => validateToolArguments({ enabled: true }, schema)).not.toThrow()

			// Invalid types
			expect(() => validateToolArguments({ query: 123 }, schema)).toThrow(ValidationError)
			expect(() => validateToolArguments({ limit: 'invalid' }, schema)).toThrow(ValidationError)
			expect(() => validateToolArguments({ enabled: 'invalid' }, schema)).toThrow(ValidationError)
		})

		it('should handle schemas without validation', () => {
			expect(() => validateToolArguments({ anything: 'goes' }, null)).not.toThrow()
			expect(() => validateToolArguments({ anything: 'goes' }, undefined)).not.toThrow()
		})
	})

	describe('validateJSONRPCResponse', () => {
		it('should validate valid success response', () => {
			const validResponse = {
				jsonrpc: '2.0',
				id: 1,
				result: { success: true },
			}

			expect(() => validateJSONRPCResponse(validResponse)).not.toThrow()
		})

		it('should validate valid error response', () => {
			const validResponse = {
				jsonrpc: '2.0',
				id: 1,
				error: {
					code: -32602,
					message: 'Invalid params',
				},
			}

			expect(() => validateJSONRPCResponse(validResponse)).not.toThrow()
		})

		it('should reject non-object responses', () => {
			expect(() => validateJSONRPCResponse(null)).toThrow(ValidationError)
			expect(() => validateJSONRPCResponse('invalid')).toThrow(ValidationError)
		})

		it('should reject missing jsonrpc field', () => {
			const invalidResponse = {
				id: 1,
				result: { success: true },
			}

			expect(() => validateJSONRPCResponse(invalidResponse)).toThrow(ValidationError)
		})

		it('should reject responses with both result and error', () => {
			const invalidResponse = {
				jsonrpc: '2.0',
				id: 1,
				result: { success: true },
				error: { code: -32602, message: 'Invalid params' },
			}

			expect(() => validateJSONRPCResponse(invalidResponse)).toThrow(ValidationError)
		})

		it('should reject responses with neither result nor error', () => {
			const invalidResponse = {
				jsonrpc: '2.0',
				id: 1,
			}

			expect(() => validateJSONRPCResponse(invalidResponse)).toThrow(ValidationError)
		})

		it('should reject invalid error structure', () => {
			const invalidResponse = {
				jsonrpc: '2.0',
				id: 1,
				error: {
					code: 'invalid', // should be number
					message: 'Invalid params',
				},
			}

			expect(() => validateJSONRPCResponse(invalidResponse)).toThrow(ValidationError)
		})
	})

	describe('protocol state management', () => {
		it('should start uninitialized', () => {
			expect(getProtocolState()).toBe('uninitialized')
		})

		it('should mark as initialized', () => {
			markInitialized()
			expect(getProtocolState()).toBe('initialized')
		})

		it('should reset state', () => {
			markInitialized()
			expect(getProtocolState()).toBe('initialized')

			resetProtocolState()
			expect(getProtocolState()).toBe('uninitialized')
		})
	})
})
