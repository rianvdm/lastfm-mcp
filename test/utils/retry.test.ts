import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withRetry, fetchWithRetry } from '../../src/utils/retry'

describe('Retry Utility', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('withRetry', () => {
		it('should succeed on first attempt', async () => {
			const fn = vi.fn().mockResolvedValue('success')
			
			const result = await withRetry(fn)
			
			expect(result.success).toBe(true)
			expect(result.data).toBe('success')
			expect(result.attempts).toBe(1)
			expect(fn).toHaveBeenCalledTimes(1)
		})

		it('should retry on failure and eventually succeed', async () => {
			const fn = vi.fn()
				.mockRejectedValueOnce(new Error('First failure'))
				.mockRejectedValueOnce(new Error('Second failure'))
				.mockResolvedValue('success')
			
			// Start the retry operation
			const promise = withRetry(fn, { 
				maxRetries: 3, 
				initialDelayMs: 100,
				shouldRetry: () => true // Always retry for this test
			})
			
			// Wait for first attempt to fail
			await vi.runOnlyPendingTimersAsync()
			
			// Advance time for first retry delay
			await vi.advanceTimersByTimeAsync(110) // 100ms + buffer for jitter
			
			// Wait for second attempt to fail
			await vi.runOnlyPendingTimersAsync()
			
			// Advance time for second retry delay
			await vi.advanceTimersByTimeAsync(220) // 200ms + buffer for jitter
			
			// Wait for third attempt to succeed
			await vi.runOnlyPendingTimersAsync()
			
			const result = await promise
			
			expect(result.success).toBe(true)
			expect(result.data).toBe('success')
			expect(result.attempts).toBe(3)
			expect(fn).toHaveBeenCalledTimes(3)
		})

		it('should fail after max retries', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('Always fails'))
			
			// Start the retry operation
			const promise = withRetry(fn, { 
				maxRetries: 2, 
				initialDelayMs: 100,
				shouldRetry: () => true // Always retry for this test
			})
			
			// Wait for first attempt to fail
			await vi.runOnlyPendingTimersAsync()
			
			// Advance time for first retry
			await vi.advanceTimersByTimeAsync(110) // 100ms + buffer
			await vi.runOnlyPendingTimersAsync()
			
			// Advance time for second retry
			await vi.advanceTimersByTimeAsync(220) // 200ms + buffer
			await vi.runOnlyPendingTimersAsync()
			
			const result = await promise
			
			expect(result.success).toBe(false)
			expect(result.error?.message).toBe('Always fails')
			expect(result.attempts).toBe(3) // Initial + 2 retries
			expect(fn).toHaveBeenCalledTimes(3)
		})

		it('should not retry if shouldRetry returns false', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('Non-retryable'))
			const shouldRetry = vi.fn().mockReturnValue(false)
			
			const result = await withRetry(fn, { shouldRetry })
			
			expect(result.success).toBe(false)
			expect(result.attempts).toBe(1)
			expect(fn).toHaveBeenCalledTimes(1)
			expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error), 1)
		})
	})

	describe('fetchWithRetry', () => {
		it('should retry on 429 status', async () => {
			const mockResponse429 = new Response('Rate limited', { 
				status: 429,
				headers: { 'Retry-After': '2' }
			})
			const mockResponseOk = new Response('Success', { status: 200 })
			
			globalThis.fetch = vi.fn()
				.mockResolvedValueOnce(mockResponse429)
				.mockResolvedValueOnce(mockResponseOk)
			
			const promise = fetchWithRetry('https://api.example.com/test', {}, {
				initialDelayMs: 100
			})
			
			// Wait for first attempt to fail
			await vi.runOnlyPendingTimersAsync()
			
			// Fast-forward through retry delay (2 seconds from Retry-After)
			await vi.advanceTimersByTimeAsync(2200) // 2000ms + jitter
			await vi.runOnlyPendingTimersAsync()
			
			const result = await promise
			
			expect(result.status).toBe(200)
			expect(fetch).toHaveBeenCalledTimes(2)
		})

		it('should parse Retry-After header in seconds', async () => {
			const mockResponse429 = new Response('Rate limited', { 
				status: 429,
				headers: { 'Retry-After': '5' }
			})
			const mockResponseOk = new Response('Success', { status: 200 })
			
			globalThis.fetch = vi.fn()
				.mockResolvedValueOnce(mockResponse429)
				.mockResolvedValueOnce(mockResponseOk)
			
			const promise = fetchWithRetry('https://api.example.com/test')
			
			// Wait for first attempt
			await vi.runOnlyPendingTimersAsync()
			
			// Should wait approximately 5 seconds
			await vi.advanceTimersByTimeAsync(5500) // 5000ms + jitter
			await vi.runOnlyPendingTimersAsync()
			
			const result = await promise
			
			expect(result.status).toBe(200)
		})

		it('should parse Retry-After header as HTTP date', async () => {
			const futureDate = new Date(Date.now() + 3000) // 3 seconds from now
			const mockResponse429 = new Response('Rate limited', { 
				status: 429,
				headers: { 'Retry-After': futureDate.toUTCString() }
			})
			const mockResponseOk = new Response('Success', { status: 200 })
			
			globalThis.fetch = vi.fn()
				.mockResolvedValueOnce(mockResponse429)
				.mockResolvedValueOnce(mockResponseOk)
			
			const promise = fetchWithRetry('https://api.example.com/test')
			
			// Wait for first attempt
			await vi.runOnlyPendingTimersAsync()
			
			// Should wait approximately 3 seconds
			await vi.advanceTimersByTimeAsync(3300) // 3000ms + jitter
			await vi.runOnlyPendingTimersAsync()
			
			const result = await promise
			
			expect(result.status).toBe(200)
		})

		it('should throw error for non-retryable status codes', async () => {
			const mockResponse400 = new Response('Bad request', { status: 400 })
			
			globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse400)
			
			await expect(fetchWithRetry('https://api.example.com/test')).rejects.toThrow('HTTP 400: Bad Request')
			
			expect(fetch).toHaveBeenCalledTimes(1)
		})

		it('should retry on 5xx errors', async () => {
			const mockResponse500 = new Response('Server error', { status: 500 })
			const mockResponseOk = new Response('Success', { status: 200 })
			
			globalThis.fetch = vi.fn()
				.mockResolvedValueOnce(mockResponse500)
				.mockResolvedValueOnce(mockResponseOk)
			
			const promise = fetchWithRetry('https://api.example.com/test', {}, {
				initialDelayMs: 100
			})
			
			// Wait for first attempt to fail
			await vi.runOnlyPendingTimersAsync()
			
			// Fast-forward through retry delay
			await vi.advanceTimersByTimeAsync(150)
			await vi.runOnlyPendingTimersAsync()
			
			const result = await promise
			
			expect(result.status).toBe(200)
			expect(fetch).toHaveBeenCalledTimes(2)
		})
	})
}) 