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

  it('does not throw for an invalid timezone string', () => {
    expect(() => formatTimestamp(KNOWN_TS, 'Invalid/Zone')).not.toThrow()
  })

  it('does not throw for the zero epoch timestamp', () => {
    expect(() => formatTimestamp(0)).not.toThrow()
  })
})
