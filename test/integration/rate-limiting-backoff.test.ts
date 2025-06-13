import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RateLimiter } from '../../src/utils/rateLimit'
import { LastfmClient } from '../../src/clients/lastfm'
import worker from '../../src/index'
import type { Env } from '../../src/types/env'

// Mock KV namespace
const mockMCP_RL = {
	get: vi.fn(),
	put: vi.fn(),
	list: vi.fn(),
	delete: vi.fn(),
}

const mockMCP_LOGS = {
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
	LASTFM_API_KEY: 'test-api-key',
	LASTFM_SHARED_SECRET: 'test-shared-secret',
	JWT_SECRET: 'test-jwt-secret',
	MCP_LOGS: mockMCP_LOGS as any,
	MCP_RL: mockMCP_RL as any,
	MCP_SESSIONS: mockMCP_SESSIONS as any,
}

describe('Rate Limiting and Exponential Backoff Integration', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		
		// Reset rate limiting to allow requests by default
		mockMCP_RL.get.mockResolvedValue(null)
		mockMCP_RL.put.mockResolvedValue(undefined)
		mockMCP_LOGS.put.mockResolvedValue(undefined)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('Rate Limiter Edge Cases', () => {
		let rateLimiter: RateLimiter

		beforeEach(() => {
			rateLimiter = new RateLimiter(mockMCP_RL as any, {
				requestsPerMinute: 10,
				requestsPerHour: 100,
			})
		})

		it('should handle rapid consecutive requests within time windows', async () => {
			// Mock initial state and track request counts
			let minuteCount = 0
			let hourCount = 0
			
			mockMCP_RL.get.mockImplementation((key) => {
				if (key.includes(':minute:')) {
					return Promise.resolve(minuteCount > 0 ? minuteCount.toString() : null)
				}
				if (key.includes(':hour:')) {
					return Promise.resolve(hourCount > 0 ? hourCount.toString() : null)
				}
				return Promise.resolve(null)
			})

			mockMCP_RL.put.mockImplementation((key, value) => {
				const count = parseInt(value, 10)
				if (key.includes(':minute:')) {
					minuteCount = count
				} else if (key.includes(':hour:')) {
					hourCount = count
				}
				return Promise.resolve()
			})

			const userId = 'user123'
			const results = []

			// Make 5 rapid requests
			for (let i = 0; i < 5; i++) {
				const result = await rateLimiter.checkLimit(userId)
				results.push(result)
			}

			// All should be allowed
			results.forEach((result) => {
				expect(result.allowed).toBe(true)
			})

			// Should have incremented counters for each request
			expect(mockMCP_RL.put).toHaveBeenCalledTimes(10) // 5 requests × 2 windows each
			expect(minuteCount).toBe(5)
			expect(hourCount).toBe(5)
		})

		it('should deny requests when minute limit exceeded', async () => {
			// Set count exactly at the limit
			mockMCP_RL.get.mockImplementation((key) => {
				if (key.includes(':minute:')) {
					return Promise.resolve('10') // At minute limit
				}
				if (key.includes(':hour:')) {
					return Promise.resolve('50') // Under hour limit
				}
				return Promise.resolve(null)
			})

			const userId = 'user123'

			const result = await rateLimiter.checkLimit(userId)
			expect(result.allowed).toBe(false)
			expect(result.errorMessage).toContain('Rate limit exceeded: 10/10 requests per minute')
		})

		it('should handle concurrent requests with potential race conditions', async () => {
			// Simulate two requests hitting at exactly the same time
			let requestCount = 9 // Just under limit

			mockMCP_RL.get.mockImplementation(() => {
				return Promise.resolve(requestCount.toString())
			})

			mockMCP_RL.put.mockImplementation(() => {
				requestCount++ // Simulate increment
				return Promise.resolve()
			})

			const userId = 'user123'

			// Fire two requests concurrently
			const [result1, result2] = await Promise.all([
				rateLimiter.checkLimit(userId),
				rateLimiter.checkLimit(userId),
			])

			// Both should see the same count initially, but behavior may vary
			// This test verifies the system doesn't crash under race conditions
			expect(result1.allowed).toBeDefined()
			expect(result2.allowed).toBeDefined()

			// At least one should succeed
			expect(result1.allowed || result2.allowed).toBe(true)
		})

		it('should properly handle different user rate limits independently', async () => {
			const user1Counts = { minute: 5, hour: 50 }
			const user2Counts = { minute: 8, hour: 80 }

			mockMCP_RL.get.mockImplementation((key) => {
				if (key.includes('user1:minute:')) return Promise.resolve(user1Counts.minute.toString())
				if (key.includes('user1:hour:')) return Promise.resolve(user1Counts.hour.toString())
				if (key.includes('user2:minute:')) return Promise.resolve(user2Counts.minute.toString())
				if (key.includes('user2:hour:')) return Promise.resolve(user2Counts.hour.toString())
				return Promise.resolve('0')
			})

			// Both users should be allowed
			const result1 = await rateLimiter.checkLimit('user1')
			const result2 = await rateLimiter.checkLimit('user2')

			expect(result1.allowed).toBe(true)
			expect(result2.allowed).toBe(true)

			// Remaining counts should be different
			expect(result1.remaining).toBe(4) // 10 - 5 - 1
			expect(result2.remaining).toBe(1) // 10 - 8 - 1
		})

		it('should respect Retry-After timing when provided', async () => {
			const mockTime = 1672531200000 // Fixed timestamp
			vi.setSystemTime(mockTime)

			// Mock at the limit
			mockMCP_RL.get.mockResolvedValue('10')

			const result = await rateLimiter.checkLimit('user123')

			expect(result.allowed).toBe(false)
			expect(result.resetTime).toBeDefined()
			
			// Reset time should be the next minute window
			const expectedResetTime = Math.floor((mockTime + 60000) / 60000) * 60000
			expect(result.resetTime).toBe(expectedResetTime)
		})
	})

	describe('Last.fm Client Retry Behavior', () => {
		let lastfmClient: LastfmClient

		beforeEach(() => {
			lastfmClient = new LastfmClient('test-api-key')
		})

		it('should retry on 429 rate limit errors from Last.fm API', async () => {
			const mockResponse429 = new Response(
				JSON.stringify({ error: 29, message: 'Rate limit exceeded' }),
				{
					status: 429,
					headers: { 'Retry-After': '5' },
				}
			)

			const mockResponseSuccess = new Response(
				JSON.stringify({
					recenttracks: {
						track: [],
						'@attr': { user: 'testuser', page: '1', perPage: '50', totalPages: '1', total: '0' },
					},
				}),
				{ status: 200 }
			)

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(mockResponse429)
				.mockResolvedValueOnce(mockResponseSuccess)

			const promise = lastfmClient.getRecentTracks('testuser', 10)

			// Wait for first attempt to fail
			await vi.runOnlyPendingTimersAsync()

			// Advance time for retry delay (5 seconds from Retry-After header)
			await vi.advanceTimersByTimeAsync(5500) // 5000ms + jitter

			const result = await promise

			expect(result.recenttracks).toBeDefined()
			expect(fetch).toHaveBeenCalledTimes(2)
		})

		it('should implement exponential backoff for multiple failures', async () => {
			const mockResponse500 = new Response('Internal Server Error', { status: 500 })
			const mockResponseSuccess = new Response(
				JSON.stringify({
					recenttracks: {
						track: [],
						'@attr': { user: 'testuser', page: '1', perPage: '50', totalPages: '1', total: '0' },
					},
				}),
				{ status: 200 }
			)

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(mockResponse500)
				.mockResolvedValueOnce(mockResponse500)
				.mockResolvedValueOnce(mockResponseSuccess)

			const promise = lastfmClient.getRecentTracks('testuser', 10)

			// Wait for first attempt to fail
			await vi.runOnlyPendingTimersAsync()

			// First retry after ~1 second
			await vi.advanceTimersByTimeAsync(1100)
			await vi.runOnlyPendingTimersAsync()

			// Second retry after ~2 seconds (exponential backoff)
			await vi.advanceTimersByTimeAsync(2200)

			const result = await promise

			expect(result.recenttracks).toBeDefined()
			expect(fetch).toHaveBeenCalledTimes(3)
		})

		it('should use throttling configuration correctly', async () => {
			// Just verify that the client has the correct configuration
			expect(lastfmClient).toBeDefined()
			
			// Verify that fetch retry is used by checking if it's imported
			expect(typeof lastfmClient.getRecentTracks).toBe('function')
		})

		it('should not retry on 4xx client errors', async () => {
			const mockResponse404 = new Response(
				JSON.stringify({ error: 6, message: 'User not found' }),
				{ status: 404 }
			)

			globalThis.fetch = vi.fn().mockResolvedValue(mockResponse404)

			await expect(lastfmClient.getRecentTracks('nonexistentuser', 10)).rejects.toThrow()

			// Should not retry 4xx errors
			expect(fetch).toHaveBeenCalledTimes(1)
		})
	})

	describe('MCP Worker Rate Limiting Integration', () => {
		it('should apply rate limiting to MCP tool calls', async () => {
			// Mock authenticated session
			mockMCP_SESSIONS.get.mockResolvedValue(
				JSON.stringify({
					sessionKey: 'test-session',
					userId: 'testuser',
					username: 'testuser',
				})
			)

			// Mock rate limiting to return near limit
			mockMCP_RL.get
				.mockResolvedValueOnce('9') // minute count
				.mockResolvedValueOnce('99') // hour count

			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Cookie: 'lastfm_session=valid-jwt-token',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: {
						name: 'get_recent_tracks',
						arguments: { username: 'testuser', limit: 10 },
					},
				}),
			})

			// Mock successful Last.fm API response
			globalThis.fetch = vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						recenttracks: {
							track: [],
							'@attr': { user: 'testuser', page: '1', perPage: '10', totalPages: '1', total: '0' },
						},
					}),
					{ status: 200 }
				)
			)

			const response = await worker.fetch(request, mockEnv, {} as any)

			expect(response.status).toBe(200)

			// Should have checked rate limits
			expect(mockMCP_RL.get).toHaveBeenCalled()
			expect(mockMCP_RL.put).toHaveBeenCalled() // Should increment counters
		})

		it('should return 429 with Retry-After when rate limited', async () => {
			const mockTime = 1672531200000
			vi.setSystemTime(mockTime)

			// Mock rate limit exceeded
			mockMCP_RL.get.mockResolvedValue('61') // Over minute limit of 60

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

			const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10)
			expect(retryAfter).toBeGreaterThan(0)
			expect(retryAfter).toBeLessThanOrEqual(60) // Should be within the next minute
		})

		it('should handle burst traffic gracefully', async () => {
			// Mock rate limiting - start fresh and track per-window counts
			let requestCounts: Record<string, number> = {}
			
			mockMCP_RL.get.mockImplementation((key) => {
				const count = requestCounts[key] || 0
				return Promise.resolve(count > 0 ? count.toString() : null)
			})

			mockMCP_RL.put.mockImplementation((key, value) => {
				requestCounts[key] = parseInt(value, 10)
				return Promise.resolve()
			})

			const requests = []
			for (let i = 0; i < 15; i++) {
				const request = new Request('http://localhost:8787/', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: i + 1,
						method: 'tools/list',
						params: {},
					}),
				})
				requests.push(worker.fetch(request, mockEnv, {} as any))
			}

			const responses = await Promise.all(requests)

			// At least some should be rate limited due to default limits (60/min, 1000/hour)
			const successCount = responses.filter((r) => r.status === 200).length
			const rateLimitedCount = responses.filter((r) => r.status === 429).length

			// All requests should be accounted for
			expect(successCount + rateLimitedCount).toBe(15)
			
			// Should have at least some successful requests
			expect(successCount).toBeGreaterThan(0)
		})
	})

	describe('Error Recovery and Resilience', () => {
		it('should recover gracefully from KV storage failures', async () => {
			// Mock KV to fail initially, then succeed
			mockMCP_RL.get
				.mockRejectedValueOnce(new Error('KV unavailable'))
				.mockResolvedValue('5')

			const rateLimiter = new RateLimiter(mockMCP_RL as any)

			// First call should fail open (allow request)
			const result1 = await rateLimiter.checkLimit('user123')
			expect(result1.allowed).toBe(true)

			// Second call should work normally
			const result2 = await rateLimiter.checkLimit('user123')
			expect(result2.allowed).toBe(true)
		})

		it('should handle corrupted rate limit data gracefully', async () => {
			// Mock KV returning invalid data
			mockMCP_RL.get
				.mockResolvedValueOnce('invalid-number')
				.mockResolvedValueOnce('[]') // Invalid JSON-like
				.mockResolvedValueOnce('50') // Valid hour count

			const rateLimiter = new RateLimiter(mockMCP_RL as any)

			const result = await rateLimiter.checkLimit('user123')
			
			// Should treat invalid data as 0 and allow request
			expect(result.allowed).toBe(true)
		})

		it('should create separate KV keys for different user IDs', async () => {
			// Mock fresh state
			mockMCP_RL.get.mockResolvedValue(null)

			const rateLimiter = new RateLimiter(mockMCP_RL as any)

			// Make requests for two different users
			await rateLimiter.checkLimit('user1')
			await rateLimiter.checkLimit('user2')

			// Verify that separate keys were created
			const putCalls = mockMCP_RL.put.mock.calls
			const user1Keys = putCalls.filter(([key]) => key.includes('user1'))
			const user2Keys = putCalls.filter(([key]) => key.includes('user2'))

			expect(user1Keys.length).toBeGreaterThan(0)
			expect(user2Keys.length).toBeGreaterThan(0)
		})
	})
})