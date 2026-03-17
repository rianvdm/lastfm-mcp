import { describe, it, expect } from 'vitest'
import { formatTimestamp } from '../../src/utils/dateFormat'

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
