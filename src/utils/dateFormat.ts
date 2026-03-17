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
