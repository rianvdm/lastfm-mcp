import { describe, it, expect } from 'vitest'
import { formatTimestamp, getDayBoundsUTC } from '../../src/utils/dateFormat'

describe('formatTimestamp', () => {
  // Unix timestamp 1705359600 = 2024-01-15T23:00:00Z
  const KNOWN_TS = 1705359600

  it('formats a known timestamp in UTC by default', () => {
    const result = formatTimestamp(KNOWN_TS)
    expect(result).toBe('Jan 15, 2024, 11:00 PM UTC')
  })

  it('formats the same timestamp in a non-UTC timezone', () => {
    // 2024-01-15T23:00:00Z = 3:00 PM PST (UTC-8)
    const result = formatTimestamp(KNOWN_TS, 'America/Los_Angeles')
    expect(result).toContain('Jan 15, 2024')
    expect(result).toContain('3:00 PM')
    expect(result).toContain('PST')
  })

  it('falls back to UTC for an invalid timezone string', () => {
    const result = formatTimestamp(KNOWN_TS, 'Invalid/Zone')
    expect(result).toContain('UTC')
    expect(result).toContain('Jan 15, 2024')
  })

  it('formats the zero epoch timestamp without throwing', () => {
    const result = formatTimestamp(0)
    expect(result).toContain('Jan 1, 1970')
    expect(result).toContain('UTC')
  })
})

describe('getDayBoundsUTC', () => {
  it('returns correct UTC bounds for a UTC date', () => {
    const { from, to } = getDayBoundsUTC('2026-03-16', 'UTC')
    expect(from).toBe(Math.floor(Date.UTC(2026, 2, 16, 0, 0, 0) / 1000))
    expect(to).toBe(Math.floor(Date.UTC(2026, 2, 17, 0, 0, 0) / 1000) - 1)
  })

  it('returns correct UTC bounds for a PDT (UTC-7) date', () => {
    // 2026-03-16 in America/Los_Angeles is PDT (UTC-7) — DST started March 8, 2026
    // Midnight PDT = 07:00 UTC; next midnight = 07:00 UTC next day
    const { from, to } = getDayBoundsUTC('2026-03-16', 'America/Los_Angeles')
    expect(from).toBe(Math.floor(Date.UTC(2026, 2, 16, 7, 0, 0) / 1000))  // midnight PDT = 07:00 UTC
    expect(to).toBe(Math.floor(Date.UTC(2026, 2, 17, 7, 0, 0) / 1000) - 1)
  })

  it('spans exactly 86400 or 82800 seconds (handles DST transitions)', () => {
    const { from, to } = getDayBoundsUTC('2026-03-08', 'America/Los_Angeles')  // DST spring-forward
    const duration = to - from + 1
    expect([82800, 86400]).toContain(duration)  // 23h or 24h day
  })

  it('returns a full 24-hour day for a UTC+5:30 timezone (India)', () => {
    const { from, to } = getDayBoundsUTC('2026-03-16', 'Asia/Kolkata')
    expect(to - from + 1).toBe(86400)
  })
})
