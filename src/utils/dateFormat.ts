/**
 * Compute UTC start/end Unix timestamps for a full calendar day in the given timezone.
 *
 * Uses noon-UTC offset sampling to handle DST boundaries correctly.
 * e.g. getDayBoundsUTC("2026-03-16", "America/Los_Angeles") returns the UTC
 * timestamps for midnight-to-midnight PDT on March 16.
 */
export function getDayBoundsUTC(dateStr: string, timezone: string): { from: number; to: number } {
  const [y, m, d] = dateStr.split('-').map(Number)

  // Sample the UTC offset at noon on the start day and noon on the next day.
  // This avoids DST edge cases at midnight itself.
  const getOffsetMs = (noonUtcMs: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(noonUtcMs))
    const o = Object.fromEntries(parts.map(p => [p.type, p.value]))
    const localMs = Date.UTC(+o.year, +o.month - 1, +o.day, o.hour === '24' ? 0 : +o.hour, +o.minute, +o.second)
    return localMs - noonUtcMs  // positive = timezone ahead of UTC
  }

  const startNoonUtc = Date.UTC(y, m - 1, d, 12, 0, 0)
  const endNoonUtc = Date.UTC(y, m - 1, d + 1, 12, 0, 0)

  // local midnight UTC = UTC midnight - offset
  const from = Math.floor((Date.UTC(y, m - 1, d) - getOffsetMs(startNoonUtc)) / 1000)
  const to = Math.floor((Date.UTC(y, m - 1, d + 1) - getOffsetMs(endNoonUtc)) / 1000) - 1

  return { from, to }
}

/**
 * Format a Unix timestamp as a human-readable datetime string.
 *
 * Locale is pinned to en-US for consistent output on Cloudflare Workers.
 * Falls back to UTC silently if the timezone string is invalid.
 */
export function formatTimestamp(unixSeconds: number, timezone = 'UTC'): string {
  let tz = timezone
  try {
    // Validate the timezone — Intl throws RangeError on unknown values
    Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    tz = 'UTC'
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: tz,
  }).format(new Date(unixSeconds * 1000))
}
