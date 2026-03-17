# Timezone-Aware Date Formatting

**Date:** 2026-03-17
**Status:** In Review

## Problem

The MCP server runs on Cloudflare Workers, which executes entirely in UTC. All date formatting uses `.toLocaleDateString()`, which on Workers always produces UTC-formatted dates regardless of the user's actual timezone. A track played at 11pm Pacific (UTC-8) shows as the *next day*, causing Claude to say "yesterday" when it was today, or confuse morning/evening.

## Goals

- Track play times in `get_recent_tracks` display in the user's local timezone when known
- All other date formatting is unambiguous (explicit UTC, not runtime-local)
- Eliminate duplicated date formatting logic between `authenticated.ts` and `handlers.ts`
- Graceful fallback to UTC when timezone is unknown or invalid

## Design

### 1. Shared utility: `src/utils/dateFormat.ts`

New file exporting one function:

```typescript
export function formatTimestamp(unixSeconds: number, timezone = 'UTC'): string
```

- Uses `Intl.DateTimeFormat` with **locale pinned to `en-US`** for consistent output across all Cloudflare Worker environments
- Returns a human-readable string in the format `"Jan 15, 2024, 11:00 PM EST"` (locale-stable)
- Does **not** throw or return a warning on invalid timezone — it simply formats in UTC. Timezone validation is the caller's responsibility (see Section 2)

Both `src/mcp/tools/authenticated.ts` and `src/protocol/handlers.ts` replace all `.toLocaleDateString()` calls with imports of this function. This eliminates the duplication and ensures a single change point for future date formatting.

**Chart boundary dates** (`get_weekly_chart_list`, `get_weekly_artist_chart`, `get_weekly_track_chart`) are called with no timezone argument — they always render in UTC. These are week-boundary identifiers, not user-local play events, so local timezone is not meaningful here.

**Registration date** in `get_user_info` is also always formatted in UTC for the same reason.

### 2. `timezone` parameter on `get_recent_tracks`

```typescript
timezone: z.string().optional().default('UTC')
  .describe('IANA timezone name (e.g. "America/New_York"). Defaults to UTC.')
```

The tool handler validates the timezone **before** calling `formatTimestamp`. Because the zod schema uses `.default('UTC')`, `timezone` is never `undefined` at runtime:

```typescript
let effectiveTimezone = timezone  // zod default('UTC') already applied
let timezoneWarning: string | undefined
try {
  Intl.DateTimeFormat(undefined, { timeZone: effectiveTimezone })
} catch {
  timezoneWarning = `Unrecognized timezone "${effectiveTimezone}" — falling back to UTC.`
  effectiveTimezone = 'UTC'
}
```

If invalid, a single warning line appears at the top of the response. All track dates then format in UTC. This keeps `formatTimestamp` pure (no error state) and avoids polluting every track line with a repeated warning.

Response header notes the active timezone inline on the heading line:
```
🎵 **Recent Tracks for rian** (times in America/New_York)
🎵 **Recent Tracks for rian** (times in UTC)   ← default / fallback case
```

When Claude knows the user's timezone from context, it passes it; when unknown, UTC + visible note is the fallback.

### 3. Edge cases

| Case | Handling |
|------|----------|
| Invalid timezone string | Tool handler validates, falls back to UTC, shows single top-level warning |
| Now Playing track (no date) | Already skips date formatting — no change needed |
| Chart boundary dates | Always UTC — `formatTimestamp` called without timezone arg |
| Registration date in `get_user_info` | Always UTC — same as chart boundaries |
| `handlers.ts` duplication | Both files import shared utility; both fixed together |

## Files Changed

| File | Change |
|------|--------|
| `src/utils/dateFormat.ts` | **New** — `formatTimestamp(unixSeconds, timezone?)` utility, locale pinned to `en-US` |
| `src/mcp/tools/authenticated.ts` | Add `timezone` param + validation to `get_recent_tracks`; replace all `.toLocaleDateString()` with `formatTimestamp`; registration date in `get_user_info` uses `formatTimestamp` in UTC |
| `src/protocol/handlers.ts` | Replace all `.toLocaleDateString()` with `formatTimestamp` (UTC for all call sites) |
| `test/utils/dateFormat.test.ts` | **New** — unit tests for `formatTimestamp` |

## Tests

**`test/utils/dateFormat.test.ts`** (new) — unit tests for `formatTimestamp`:
- UTC (default) — known Unix timestamp → expected `en-US` formatted string
- Valid non-UTC timezone (e.g. `"America/Los_Angeles"`) — same timestamp → correct local time
- Invalid timezone string — confirm function does **not** throw (it silently uses UTC; the warning and fallback live in the tool handler, not here)
- Zero-value Unix timestamp (epoch) — does not throw

**`test/protocol/tools.test.ts`** (extend existing) — handler-level tests for `get_recent_tracks`:
- Pass `timezone: "Invalid/Zone"` → confirm warning string appears at top of response and all track dates render in UTC
- Pass `timezone: "America/New_York"` → confirm header shows `(times in America/New_York)` and dates are formatted in ET
- Omit `timezone` → confirm header shows `(times in UTC)` and dates are in UTC

**Now Playing path** — no date field present; existing test coverage sufficient, no change needed.

## Verification

1. Call `get_recent_tracks` without `timezone` → dates show as `"Jan 15, 2024, 11:00 PM UTC"`; header shows `(times in UTC)`
2. Call with `timezone: "America/Los_Angeles"` → same track shows correct PST/PDT time; header shows `(times in America/Los_Angeles)`
3. Call with `timezone: "Invalid/Zone"` → single warning at top of response, all dates in UTC
4. Call `get_weekly_chart_list` → chart boundary dates show UTC, no timezone param accepted
5. Call `get_user_info` → registration date shows UTC
6. Confirm `handlers.ts` call sites also use `formatTimestamp` (not `.toLocaleDateString()`)
7. Unit tests pass: `npm test` (or equivalent) with `dateFormat.test.ts` green
