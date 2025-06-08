import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleInitialize, handleMethod, resetInitialization } from '../../src/protocol/handlers'
import { PROTOCOL_VERSION, SERVER_INFO, DEFAULT_CAPABILITIES } from '../../src/types/mcp'

// Mock authenticated request helper
function createMockAuthenticatedRequest(): Request {
	return new Request('http://localhost:8787/', {
		method: 'POST',
		headers: {
			'Cookie': 'session=mock.jwt.token'
		}
	})
}

// Mock JWT secret
const mockJwtSecret = 'test-secret'

// Mock the JWT verification to always return a valid session
vi.mock('../../src/auth/jwt', () => ({
	verifySessionToken: vi.fn().mockResolvedValue({
		userId: 'test-user',
		accessToken: 'test-token',
		accessTokenSecret: 'test-secret',
		iat: Math.floor(Date.now() / 1000),
		exp: Math.floor(Date.now() / 1000) + 3600
	})
}))

describe('MCP Protocol Handlers', () => {
	beforeEach(() => {
		// Reset initialization state before each test
		resetInitialization()
	})

	describe('handleInitialize', () => {
		it('should handle valid initialize request', () => {
			const params = {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: {
					name: 'TestClient',
					version: '1.0.0',
				},
			}

			const result = handleInitialize(params)

			expect(result).toEqual({
				protocolVersion: PROTOCOL_VERSION,
				capabilities: DEFAULT_CAPABILITIES,
				serverInfo: SERVER_INFO,
			})
		})

		it('should throw error for invalid params', () => {
			expect(() => handleInitialize({})).toThrow()
			expect(() => handleInitialize(null)).toThrow()
			expect(() => handleInitialize('invalid')).toThrow()
		})

		it('should accept different protocol versions', () => {
			const params = {
				protocolVersion: '2024-01-01', // Different version
				capabilities: {},
				clientInfo: {
					name: 'TestClient',
					version: '1.0.0',
				},
			}

			const result = handleInitialize(params)

			// Should still return our version
			expect(result.protocolVersion).toBe(PROTOCOL_VERSION)
		})
	})

	describe('handleMethod', () => {
		it('should handle initialize request', async () => {
			const request = {
				jsonrpc: '2.0' as const,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: {
						name: 'TestClient',
						version: '1.0.0',
					},
				},
				id: 1,
			}

			const response = await handleMethod(request)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 1,
				result: {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: DEFAULT_CAPABILITIES,
					serverInfo: SERVER_INFO,
				},
			})
		})

		it('should handle initialized notification', async () => {
			// First initialize
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			// Then send initialized notification
			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			// Notifications should return null
			expect(response).toBeNull()
		})

		it('should reject methods before initialization', async () => {
			const request = {
				jsonrpc: '2.0' as const,
				method: 'resources/list',
				id: 1,
			}

			const response = await handleMethod(request)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 1,
				error: {
					code: -32010,
					message: 'Server not initialized',
				},
			})
		})

		it('should allow list methods without authentication', async () => {
			// Initialize first
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			// resources/list should work without authentication
			const resourcesResponse = await handleMethod({
				jsonrpc: '2.0',
				method: 'resources/list',
				id: 2,
			})

			expect(resourcesResponse).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					resources: expect.arrayContaining([
						expect.objectContaining({
							uri: expect.stringMatching(/^discogs:\/\//),
							name: expect.any(String),
							mimeType: 'application/json'
						})
					])
				},
			})

			// tools/list should work without authentication
			const toolsResponse = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/list',
				id: 3,
			})

			expect(toolsResponse).toMatchObject({
				jsonrpc: '2.0',
				id: 3,
				result: { 
					tools: expect.arrayContaining([
						expect.objectContaining({
							name: 'ping',
							description: expect.any(String),
							inputSchema: expect.any(Object)
						}),
						expect.objectContaining({
							name: 'server_info',
							description: expect.any(String),
							inputSchema: expect.any(Object)
						})
					])
				},
			})

			// prompts/list should work without authentication
			const promptsResponse = await handleMethod({
				jsonrpc: '2.0',
				method: 'prompts/list',
				id: 4,
			})

			expect(promptsResponse).toMatchObject({
				jsonrpc: '2.0',
				id: 4,
				result: { 
					prompts: expect.arrayContaining([
						expect.objectContaining({
							name: 'browse_collection',
							description: expect.any(String)
						}),
						expect.objectContaining({
							name: 'find_music',
							description: expect.any(String),
							arguments: expect.arrayContaining([
								expect.objectContaining({
									name: 'query',
									required: true
								})
							])
						}),
						expect.objectContaining({
							name: 'collection_insights',
							description: expect.any(String)
						})
					])
				},
			})
		})

		it('should require authentication for data methods', async () => {
			// Initialize first
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			// resources/read should require authentication
			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'resources/read',
				params: { uri: 'discogs://collection' },
				id: 2,
			})

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				error: {
					code: -32603,
					message: 'Internal error: Missing authentication context',
				},
			})
		})

		it('should handle unknown methods', async () => {
			// First initialize
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			// Then call unknown method with authentication
			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'unknown/method',
				id: 2,
			}, createMockAuthenticatedRequest(), mockJwtSecret)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				error: {
					code: -32601,
					message: 'Method not found',
					data: { method: 'unknown/method' },
				},
			})
		})

		it('should return list methods with proper structure', async () => {
			// Initialize first
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			const mockRequest = createMockAuthenticatedRequest()

			// Test resources/list
			const resourcesResponse = await handleMethod({
				jsonrpc: '2.0',
				method: 'resources/list',
				id: 2,
			}, mockRequest, mockJwtSecret)

			expect(resourcesResponse).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: { 
					resources: expect.arrayContaining([
						expect.objectContaining({
							uri: expect.stringMatching(/^discogs:\/\//),
							name: expect.any(String),
							mimeType: 'application/json'
						})
					])
				},
			})

			// Test tools/list (now has ping and server_info tools)
			const toolsResponse = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/list',
				id: 3,
			}, mockRequest, mockJwtSecret)

			expect(toolsResponse).toMatchObject({
				jsonrpc: '2.0',
				id: 3,
				result: { 
					tools: expect.arrayContaining([
						expect.objectContaining({
							name: 'ping',
							description: expect.any(String),
							inputSchema: expect.any(Object)
						}),
						expect.objectContaining({
							name: 'server_info',
							description: expect.any(String),
							inputSchema: expect.any(Object)
						})
					])
				},
			})

			// Test prompts/list (now has actual prompts)
			const promptsResponse = await handleMethod({
				jsonrpc: '2.0',
				method: 'prompts/list',
				id: 4,
			}, mockRequest, mockJwtSecret)

			expect(promptsResponse).toMatchObject({
				jsonrpc: '2.0',
				id: 4,
				result: { 
					prompts: expect.arrayContaining([
						expect.objectContaining({
							name: 'browse_collection',
							description: expect.any(String)
						}),
						expect.objectContaining({
							name: 'find_music',
							description: expect.any(String),
							arguments: expect.arrayContaining([
								expect.objectContaining({
									name: 'query',
									required: true
								})
							])
						}),
						expect.objectContaining({
							name: 'collection_insights',
							description: expect.any(String)
						})
					])
				},
			})
		})
	})
})
