import { describe, it, expect, beforeEach, vi } from 'vitest'
import { KVLogger, LogEntry } from '../../src/utils/kvLogger'

// Mock KV namespace
const mockKV = {
	put: vi.fn(),
	get: vi.fn(),
	list: vi.fn(),
}

describe('KVLogger', () => {
	let logger: KVLogger

	beforeEach(() => {
		vi.clearAllMocks()
		logger = new KVLogger(mockKV as any)
	})

	describe('log', () => {
		it('should store log entry with correct format', async () => {
			const userId = 'user123'
			const method = 'tools/call'
			const params = { name: 'search_collection', arguments: { query: 'test' } }
			const result = { status: 'success' as const, latency: 150 }

			await logger.log(userId, method, params, result)

			expect(mockKV.put).toHaveBeenCalledOnce()

			const [key, value, options] = mockKV.put.mock.calls[0]

			// Check key format
			expect(key).toMatch(/^log:user123:\d+:[a-z0-9]+$/)

			// Check value format
			const logEntry: LogEntry = JSON.parse(value)
			expect(logEntry).toMatchObject({
				userId: 'user123',
				method: 'tools/call',
				params: { name: 'search_collection', arguments: { query: 'test' } },
				result: { status: 'success', latency: 150 },
			})
			expect(logEntry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

			// Check TTL (30 days)
			expect(options).toEqual({ expirationTtl: 2592000 })
		})

		it('should handle error results', async () => {
			const result = {
				status: 'error' as const,
				latency: 50,
				errorCode: -32602,
				errorMessage: 'Invalid params',
			}

			await logger.log('user456', 'tools/call', {}, result)

			const [, value] = mockKV.put.mock.calls[0]
			const logEntry: LogEntry = JSON.parse(value)

			expect(logEntry.result).toEqual({
				status: 'error',
				latency: 50,
				errorCode: -32602,
				errorMessage: 'Invalid params',
			})
		})
	})

	describe('getLogs', () => {
		it('should retrieve and parse logs for a user', async () => {
			const mockLogs = [
				{
					name: 'log:user123:1672531200000:abc123',
					metadata: null,
				},
				{
					name: 'log:user123:1672531300000:def456',
					metadata: null,
				},
			]

			const logEntry1: LogEntry = {
				timestamp: '2023-01-01T00:00:00.000Z',
				userId: 'user123',
				method: 'tools/call',
				params: { name: 'search_collection' },
				result: { status: 'success', latency: 100 },
			}

			const logEntry2: LogEntry = {
				timestamp: '2023-01-01T00:01:40.000Z',
				userId: 'user123',
				method: 'resources/read',
				params: { uri: 'lastfm://user/testuser/recent' },
				result: { status: 'success', latency: 200 },
			}

			mockKV.list.mockResolvedValue({ keys: mockLogs })
			mockKV.get.mockResolvedValueOnce(JSON.stringify(logEntry1)).mockResolvedValueOnce(JSON.stringify(logEntry2))

			const logs = await logger.getLogs('user123')

			expect(mockKV.list).toHaveBeenCalledWith({ prefix: 'log:user123:', limit: 100 })
			expect(mockKV.get).toHaveBeenCalledTimes(2)
			expect(logs).toHaveLength(2)

			// Should be sorted by timestamp descending (newest first)
			expect(logs[0].timestamp).toBe('2023-01-01T00:01:40.000Z')
			expect(logs[1].timestamp).toBe('2023-01-01T00:00:00.000Z')
		})

		it('should handle custom limit', async () => {
			mockKV.list.mockResolvedValue({ keys: [] })

			await logger.getLogs('user123', 50)

			expect(mockKV.list).toHaveBeenCalledWith({ prefix: 'log:user123:', limit: 50 })
		})

		it('should handle malformed log entries gracefully', async () => {
			const mockLogs = [
				{ name: 'log:user123:1672531200000:abc123', metadata: null },
				{ name: 'log:user123:1672531300000:def456', metadata: null },
			]

			mockKV.list.mockResolvedValue({ keys: mockLogs })
			mockKV.get.mockResolvedValueOnce('invalid json').mockResolvedValueOnce(
				JSON.stringify({
					timestamp: '2023-01-01T00:01:40.000Z',
					userId: 'user123',
					method: 'tools/call',
					params: {},
					result: { status: 'success', latency: 100 },
				}),
			)

			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

			const logs = await logger.getLogs('user123')

			expect(logs).toHaveLength(1)
			expect(consoleSpy).toHaveBeenCalledWith('Failed to parse log entry:', expect.any(Error))

			consoleSpy.mockRestore()
		})

		it('should handle null values from KV', async () => {
			const mockLogs = [{ name: 'log:user123:1672531200000:abc123', metadata: null }]

			mockKV.list.mockResolvedValue({ keys: mockLogs })
			mockKV.get.mockResolvedValueOnce(null)

			const logs = await logger.getLogs('user123')

			expect(logs).toHaveLength(0)
		})
	})
})
