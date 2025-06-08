// KVNamespace is available globally in Cloudflare Workers runtime
declare global {
  interface KVNamespace {
    get(key: string): Promise<string | null>
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
    list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string }> }>
  }
}

export interface RateLimitConfig {
  requestsPerMinute: number
  requestsPerHour: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining?: number
  resetTime?: number
  errorCode?: number
  errorMessage?: string
}

export class RateLimiter {
  private kv: KVNamespace
  private config: RateLimitConfig

  constructor(kv: KVNamespace, config?: Partial<RateLimitConfig>) {
    this.kv = kv
    this.config = {
      requestsPerMinute: config?.requestsPerMinute ?? 60,
      requestsPerHour: config?.requestsPerHour ?? 1000
    }
  }

  async checkLimit(userId: string): Promise<RateLimitResult> {
    const now = Date.now()
    const minuteWindow = Math.floor(now / 60000) // 1-minute windows
    const hourWindow = Math.floor(now / 3600000) // 1-hour windows

    try {
      // Check minute limit
      const minuteResult = await this.checkWindow(
        userId,
        'minute',
        minuteWindow,
        this.config.requestsPerMinute
      )

      if (!minuteResult.allowed) {
        return minuteResult
      }

      // Check hour limit
      const hourResult = await this.checkWindow(
        userId,
        'hour',
        hourWindow,
        this.config.requestsPerHour
      )

      if (!hourResult.allowed) {
        return hourResult
      }

      // Both limits passed - increment counters
      await Promise.all([
        this.incrementCounter(userId, 'minute', minuteWindow, 60, (minuteResult.remaining || 0) + 1),
        this.incrementCounter(userId, 'hour', hourWindow, 3600, (hourResult.remaining || 0) + 1)
      ])

      return {
        allowed: true,
        remaining: Math.min(
          this.config.requestsPerMinute - (minuteResult.remaining || 0) - 1,
          this.config.requestsPerHour - (hourResult.remaining || 0) - 1
        )
      }
    } catch (error) {
      console.error('Rate limit check failed:', error)
      // Fail open - allow request if rate limiting is broken
      return { allowed: true }
    }
  }

  private async checkWindow(
    userId: string,
    window: 'minute' | 'hour',
    windowId: number,
    limit: number
  ): Promise<RateLimitResult> {
    const key = `rl:${userId}:${window}:${windowId}`
    const countStr = await this.kv.get(key)
    const currentCount = countStr ? parseInt(countStr, 10) : 0

    if (currentCount >= limit) {
      const resetTime = window === 'minute' 
        ? (windowId + 1) * 60000 
        : (windowId + 1) * 3600000

      return {
        allowed: false,
        remaining: 0,
        resetTime,
        errorCode: -32000, // JSON-RPC server error
        errorMessage: `Rate limit exceeded: ${currentCount}/${limit} requests per ${window}. Try again after ${new Date(resetTime).toISOString()}`
      }
    }

    return {
      allowed: true,
      remaining: currentCount
    }
  }

  private async incrementCounter(
    userId: string,
    window: 'minute' | 'hour',
    windowId: number,
    ttl: number,
    newCount: number
  ): Promise<void> {
    const key = `rl:${userId}:${window}:${windowId}`

    await this.kv.put(key, newCount.toString(), {
      expirationTtl: ttl
    })
  }

  async getRemainingRequests(userId: string): Promise<{
    minute: { remaining: number; resetTime: number }
    hour: { remaining: number; resetTime: number }
  }> {
    const now = Date.now()
    const minuteWindow = Math.floor(now / 60000)
    const hourWindow = Math.floor(now / 3600000)

    const [minuteCount, hourCount] = await Promise.all([
      this.getWindowCount(userId, 'minute', minuteWindow),
      this.getWindowCount(userId, 'hour', hourWindow)
    ])

    return {
      minute: {
        remaining: Math.max(0, this.config.requestsPerMinute - minuteCount),
        resetTime: (minuteWindow + 1) * 60000
      },
      hour: {
        remaining: Math.max(0, this.config.requestsPerHour - hourCount),
        resetTime: (hourWindow + 1) * 3600000
      }
    }
  }

  private async getWindowCount(
    userId: string,
    window: 'minute' | 'hour',
    windowId: number
  ): Promise<number> {
    const key = `rl:${userId}:${window}:${windowId}`
    const countStr = await this.kv.get(key)
    return countStr ? parseInt(countStr, 10) : 0
  }

  async resetUserLimits(userId: string): Promise<void> {
    // List all rate limit keys for this user
    const prefix = `rl:${userId}:`
    const result = await this.kv.list({ prefix, limit: 1000 })
    
    // Delete all keys (KV doesn't have bulk delete, so we'd need to delete individually)
    // For now, we'll just let them expire naturally
    console.log(`Would reset ${result.keys.length} rate limit entries for user ${userId}`)
  }
} 