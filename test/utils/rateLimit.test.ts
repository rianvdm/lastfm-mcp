import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RateLimiter, RateLimitConfig, RateLimitResult } from '../../src/utils/rateLimit'

// Mock KV namespace
const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
  list: vi.fn()
}

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter
  let mockDate: number

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Mock Date.now() to return a consistent timestamp
    mockDate = 1672531200000 // 2023-01-01 00:00:00 UTC
    vi.spyOn(Date, 'now').mockReturnValue(mockDate)
    
    rateLimiter = new RateLimiter(mockKV as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const limiter = new RateLimiter(mockKV as any)
      expect(limiter).toBeDefined()
    })

    it('should use custom config when provided', () => {
      const config: Partial<RateLimitConfig> = {
        requestsPerMinute: 30,
        requestsPerHour: 500
      }
      const limiter = new RateLimiter(mockKV as any, config)
      expect(limiter).toBeDefined()
    })
  })

  describe('checkLimit', () => {
    it('should allow request when under limits', async () => {
      // Mock KV to return no existing counts
      mockKV.get.mockResolvedValue(null)
      mockKV.put.mockResolvedValue(undefined)

      const result = await rateLimiter.checkLimit('user123')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBeDefined()
      
      // Should check both minute and hour windows
      expect(mockKV.get).toHaveBeenCalledTimes(2)
      expect(mockKV.get).toHaveBeenCalledWith('rl:user123:minute:27875520')
      expect(mockKV.get).toHaveBeenCalledWith('rl:user123:hour:464592')
      
      // Should increment both counters
      expect(mockKV.put).toHaveBeenCalledTimes(2)
      expect(mockKV.put).toHaveBeenCalledWith('rl:user123:minute:27875520', '1', { expirationTtl: 60 })
      expect(mockKV.put).toHaveBeenCalledWith('rl:user123:hour:464592', '1', { expirationTtl: 3600 })
    })

    it('should deny request when minute limit exceeded', async () => {
      // Mock KV to return count at limit
      mockKV.get
        .mockResolvedValueOnce('60') // minute limit reached
        .mockResolvedValueOnce('100') // hour count under limit

      const result = await rateLimiter.checkLimit('user123')

      expect(result.allowed).toBe(false)
      expect(result.errorCode).toBe(-32000)
      expect(result.errorMessage).toContain('Rate limit exceeded: 60/60 requests per minute')
      expect(result.resetTime).toBe(1672531260000) // Next minute
      
      // Should not increment counters when limit exceeded
      expect(mockKV.put).not.toHaveBeenCalled()
    })

    it('should deny request when hour limit exceeded', async () => {
      // Mock KV to return counts
      mockKV.get
        .mockResolvedValueOnce('30') // minute count under limit
        .mockResolvedValueOnce('1000') // hour limit reached

      const result = await rateLimiter.checkLimit('user123')

      expect(result.allowed).toBe(false)
      expect(result.errorCode).toBe(-32000)
      expect(result.errorMessage).toContain('Rate limit exceeded: 1000/1000 requests per hour')
      expect(result.resetTime).toBe(1672534800000) // Next hour
      
      // Should not increment counters when limit exceeded
      expect(mockKV.put).not.toHaveBeenCalled()
    })

    it('should handle existing counts correctly', async () => {
      // Mock KV to return existing counts
      mockKV.get
        .mockResolvedValueOnce('5') // minute count
        .mockResolvedValueOnce('50') // hour count
      mockKV.put.mockResolvedValue(undefined)

      const result = await rateLimiter.checkLimit('user123')

      expect(result.allowed).toBe(true)
      
      // Should increment existing counts
      expect(mockKV.put).toHaveBeenCalledWith('rl:user123:minute:27875520', '6', { expirationTtl: 60 })
      expect(mockKV.put).toHaveBeenCalledWith('rl:user123:hour:464592', '51', { expirationTtl: 3600 })
    })

    it('should fail open when KV operations fail', async () => {
      // Mock KV to throw error
      mockKV.get.mockRejectedValue(new Error('KV error'))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await rateLimiter.checkLimit('user123')

      expect(result.allowed).toBe(true)
      expect(consoleSpy).toHaveBeenCalledWith('Rate limit check failed:', expect.any(Error))
      
      consoleSpy.mockRestore()
    })

    it('should use custom limits when configured', async () => {
      const customLimiter = new RateLimiter(mockKV as any, {
        requestsPerMinute: 10,
        requestsPerHour: 100
      })

      mockKV.get
        .mockResolvedValueOnce('10') // at minute limit
        .mockResolvedValueOnce('50') // under hour limit

      const result = await customLimiter.checkLimit('user123')

      expect(result.allowed).toBe(false)
      expect(result.errorMessage).toContain('Rate limit exceeded: 10/10 requests per minute')
    })
  })

  describe('getRemainingRequests', () => {
    it('should return remaining requests for both windows', async () => {
      mockKV.get
        .mockResolvedValueOnce('15') // minute count
        .mockResolvedValueOnce('200') // hour count

      const result = await rateLimiter.getRemainingRequests('user123')

      expect(result).toEqual({
        minute: {
          remaining: 45, // 60 - 15
          resetTime: 1672531260000 // Next minute
        },
        hour: {
          remaining: 800, // 1000 - 200
          resetTime: 1672534800000 // Next hour
        }
      })
    })

    it('should handle zero remaining correctly', async () => {
      mockKV.get
        .mockResolvedValueOnce('60') // at minute limit
        .mockResolvedValueOnce('1000') // at hour limit

      const result = await rateLimiter.getRemainingRequests('user123')

      expect(result.minute.remaining).toBe(0)
      expect(result.hour.remaining).toBe(0)
    })

    it('should handle no existing counts', async () => {
      mockKV.get.mockResolvedValue(null)

      const result = await rateLimiter.getRemainingRequests('user123')

      expect(result.minute.remaining).toBe(60)
      expect(result.hour.remaining).toBe(1000)
    })
  })

  describe('resetUserLimits', () => {
    it('should list user rate limit keys', async () => {
      const mockKeys = [
        { name: 'rl:user123:minute:27875520' },
        { name: 'rl:user123:hour:464592' }
      ]
      mockKV.list.mockResolvedValue({ keys: mockKeys })

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await rateLimiter.resetUserLimits('user123')

      expect(mockKV.list).toHaveBeenCalledWith({ prefix: 'rl:user123:', limit: 1000 })
      expect(consoleSpy).toHaveBeenCalledWith('Would reset 2 rate limit entries for user user123')
      
      consoleSpy.mockRestore()
    })
  })

  describe('window calculations', () => {
    it('should calculate correct window IDs for different times', () => {
      // Test different timestamps
      const testCases = [
        { timestamp: 1672531200000, minuteWindow: 27875520, hourWindow: 464592 }, // 2023-01-01 00:00:00
        { timestamp: 1672531260000, minuteWindow: 27875521, hourWindow: 464592 }, // 2023-01-01 00:01:00
        { timestamp: 1672534800000, minuteWindow: 27875580, hourWindow: 464593 }, // 2023-01-01 01:00:00
      ]

      testCases.forEach(({ timestamp, minuteWindow, hourWindow }) => {
        vi.spyOn(Date, 'now').mockReturnValue(timestamp)
        
        const expectedMinuteWindow = Math.floor(timestamp / 60000)
        const expectedHourWindow = Math.floor(timestamp / 3600000)
        
        expect(expectedMinuteWindow).toBe(minuteWindow)
        expect(expectedHourWindow).toBe(hourWindow)
      })
    })
  })

  describe('edge cases', () => {
    it('should handle invalid count strings from KV', async () => {
      mockKV.get
        .mockResolvedValueOnce('invalid') // invalid minute count
        .mockResolvedValueOnce('50') // valid hour count
      mockKV.put.mockResolvedValue(undefined)

      const result = await rateLimiter.checkLimit('user123')

      // Should treat invalid count as 0 and allow request
      expect(result.allowed).toBe(true)
      
      // Should increment from 0 (NaN becomes 0)
      expect(mockKV.put).toHaveBeenCalledWith('rl:user123:minute:27875520', '1', { expirationTtl: 60 })
    })

    it('should handle concurrent requests correctly', async () => {
      // Simulate race condition where count changes between check and increment
      mockKV.get
        .mockResolvedValueOnce('59') // minute count just under limit
        .mockResolvedValueOnce('999') // hour count just under limit
      mockKV.put.mockResolvedValue(undefined)

      const result = await rateLimiter.checkLimit('user123')

      expect(result.allowed).toBe(true)
      
      // Should increment to exactly the limit
      expect(mockKV.put).toHaveBeenCalledWith('rl:user123:minute:27875520', '60', { expirationTtl: 60 })
      expect(mockKV.put).toHaveBeenCalledWith('rl:user123:hour:464592', '1000', { expirationTtl: 3600 })
    })
  })
}) 