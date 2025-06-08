import { describe, it, expect, beforeEach, vi } from 'vitest'
import worker from '../../src/index'
import type { Env } from '../../src/types/env'

// Mock KV namespaces
const mockMCP_LOGS = {
	put: vi.fn(),
	get: vi.fn(),
	list: vi.fn(),
}

const mockMCP_RL = {
	put: vi.fn(),
	get: vi.fn(),
	list: vi.fn(),
}

const mockMCP_SESSIONS = {
	put: vi.fn(),
	get: vi.fn(),
	list: vi.fn(),
}

const mockEnv: Env = {
	DISCOGS_CONSUMER_KEY: 'test-key',
	DISCOGS_CONSUMER_SECRET: 'test-secret',
	JWT_SECRET: 'test-jwt-secret',
	MCP_LOGS: mockMCP_LOGS as any,
	MCP_RL: mockMCP_RL as any,
	MCP_SESSIONS: mockMCP_SESSIONS as any,
}

describe('Logging and Rate Limiting Integration', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Mock rate limiting to allow requests by default
		mockMCP_RL.get.mockResolvedValue(null)
		mockMCP_RL.put.mockResolvedValue(undefined)
		mockMCP_LOGS.put.mockResolvedValue(undefined)
	})

	it('should log successful MCP requests', async () => {
		const request = new Request('http://localhost:8787/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'TestClient', version: '1.0.0' },
				},
			}),
		})

		const response = await worker.fetch(request, mockEnv, {} as any)

		expect(response.status).toBe(200)

		// Verify logging was called
		expect(mockMCP_LOGS.put).toHaveBeenCalledOnce()

		const [logKey, logValue] = mockMCP_LOGS.put.mock.calls[0]
		expect(logKey).toMatch(/^log:anonymous:\d+:[a-z0-9]+$/)

		const logEntry = JSON.parse(logValue)
		expect(logEntry).toMatchObject({
			userId: 'anonymous',
			method: 'initialize',
			result: {
				status: 'success',
				latency: expect.any(Number),
			},
		})
		expect(logEntry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
	})

	it('should log parse errors', async () => {
		const request = new Request('http://localhost:8787/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'invalid json',
		})

		const response = await worker.fetch(request, mockEnv, {} as any)

		expect(response.status).toBe(200)

		// Verify error logging was called
		expect(mockMCP_LOGS.put).toHaveBeenCalledOnce()

		const [, logValue] = mockMCP_LOGS.put.mock.calls[0]
		const logEntry = JSON.parse(logValue)
		expect(logEntry).toMatchObject({
			userId: 'anonymous',
			method: 'unknown',
			result: {
				status: 'error',
				latency: expect.any(Number),
				errorCode: -32700,
				errorMessage: expect.stringContaining('Parse error'),
			},
		})
	})

	it('should apply rate limiting and log rate limit errors', async () => {
		// Mock rate limiting to return limit exceeded
		mockMCP_RL.get.mockResolvedValue('61') // Over the limit of 60

		const request = new Request('http://localhost:8787/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
				params: {},
			}),
		})

		const response = await worker.fetch(request, mockEnv, {} as any)

		expect(response.status).toBe(429)
		expect(response.headers.get('Retry-After')).toBeDefined()

		// Verify rate limit error was logged
		expect(mockMCP_LOGS.put).toHaveBeenCalledOnce()

		const [, logValue] = mockMCP_LOGS.put.mock.calls[0]
		const logEntry = JSON.parse(logValue)
		expect(logEntry).toMatchObject({
			userId: 'anonymous',
			method: 'tools/list',
			result: {
				status: 'error',
				latency: expect.any(Number),
				errorCode: -32000,
				errorMessage: expect.stringContaining('Rate limit exceeded'),
			},
		})
	})

	it('should skip rate limiting for initialize method', async () => {
		// Mock rate limiting to return limit exceeded
		mockMCP_RL.get.mockResolvedValue('61') // Over the limit

		const request = new Request('http://localhost:8787/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'TestClient', version: '1.0.0' },
				},
			}),
		})

		const response = await worker.fetch(request, mockEnv, {} as any)

		// Should succeed despite rate limit
		expect(response.status).toBe(200)

		// Rate limiting should not have been checked for initialize
		expect(mockMCP_RL.get).not.toHaveBeenCalled()

		// Should still log the successful request
		expect(mockMCP_LOGS.put).toHaveBeenCalledOnce()
		const [, logValue] = mockMCP_LOGS.put.mock.calls[0]
		const logEntry = JSON.parse(logValue)
		expect(logEntry.result.status).toBe('success')
	})

	it('should handle missing KV namespaces gracefully', async () => {
		const envWithoutKV: Env = {
			DISCOGS_CONSUMER_KEY: 'test-key',
			DISCOGS_CONSUMER_SECRET: 'test-secret',
			JWT_SECRET: 'test-jwt-secret',
			MCP_LOGS: undefined as any,
			MCP_RL: undefined as any,
			MCP_SESSIONS: undefined as any,
		}

		const request = new Request('http://localhost:8787/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'TestClient', version: '1.0.0' },
				},
			}),
		})

		const response = await worker.fetch(request, envWithoutKV, {} as any)

		// Should still work without KV namespaces
		expect(response.status).toBe(200)

		// No KV operations should have been attempted
		expect(mockMCP_LOGS.put).not.toHaveBeenCalled()
		expect(mockMCP_RL.get).not.toHaveBeenCalled()
	})

	it('should handle empty request body', async () => {
		const request = new Request('http://localhost:8787/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '',
		})

		const response = await worker.fetch(request, mockEnv, {} as any)

		expect(response.status).toBe(200)

		// Verify error logging was called
		expect(mockMCP_LOGS.put).toHaveBeenCalledOnce()

		const [, logValue] = mockMCP_LOGS.put.mock.calls[0]
		const logEntry = JSON.parse(logValue)
		expect(logEntry).toMatchObject({
			userId: 'anonymous',
			method: 'unknown',
			result: {
				status: 'error',
				latency: expect.any(Number),
				errorCode: -32600,
				errorMessage: 'Empty request body',
			},
		})
	})

	it('should measure request latency accurately', async () => {
		const request = new Request('http://localhost:8787/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'TestClient', version: '1.0.0' },
				},
			}),
		})

		const startTime = Date.now()
		await worker.fetch(request, mockEnv, {} as any)
		const endTime = Date.now()

		const [, logValue] = mockMCP_LOGS.put.mock.calls[0]
		const logEntry = JSON.parse(logValue)

		// Latency should be a non-negative number and reasonable (less than total test time + buffer)
		expect(logEntry.result.latency).toBeGreaterThanOrEqual(0)
		expect(logEntry.result.latency).toBeLessThan(endTime - startTime + 1000) // Add generous buffer for test overhead
		expect(typeof logEntry.result.latency).toBe('number')
	})
})
