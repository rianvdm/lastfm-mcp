# Timezone-Aware Date Formatting

**Date:** 2026-03-17
**Status:** Approved

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

- Uses `Intl.DateTimeFormat` (available in Cloudflare Workers, no extra deps)
- Returns a human-readable string, e.g. `"Jan 15, 2024 at 11:00 PM EST"`
- On invalid timezone: catches the `Intl` error, falls back to UTC, appends a note: `(times in UTC — unrecognized timezone "Foobar/Invalid")`

Both `src/mcp/tools/authenticated.ts` and `src/protocol/handlers.ts` replace all `.toLocaleDateString()` calls with `formatTimestamp(...)` imports. This eliminates the duplication and ensures a single change point for future date formatting.

### 2. `timezone` parameter on `get_recent_tracks`

```typescript
timezone: z.string().optional().default('UTC')
  .describe('IANA timezone name (e.g. "America/New_York"). Defaults to UTC.')
```

- Passed into `formatTimestamp()` for each track's play date
- Response header notes the active timezone: `🎵 Recent Tracks for rian (times in America/New_York)`
- When Claude knows the user's timezone from context, it passes it; when unknown, UTC + visible note is the fallback

### 3. Edge cases

| Case | Handling |
|------|----------|
| Invalid timezone string | Catch `Intl` error, fall back to UTC, note in response |
| Now Playing track (no date) | Already skips date formatting — no change needed |
| `handlers.ts` duplication | Both files import shared utility; both fixed together |

## Files Changed

| File | Change |
|------|--------|
| `src/utils/dateFormat.ts` | **New** — `formatTimestamp` utility |
| `src/mcp/tools/authenticated.ts` | Add `timezone` param to `get_recent_tracks`; replace all `.toLocaleDateString()` with `formatTimestamp` |
| `src/protocol/handlers.ts` | Replace all `.toLocaleDateString()` with `formatTimestamp` |

## Verification

1. Call `get_recent_tracks` without `timezone` → dates show as `"Jan 15, 2024 at 11:00 PM UTC"`
2. Call with `timezone: "America/Los_Angeles"` → same track shows `"Jan 15, 2024 at 3:00 PM PST"`
3. Call with `timezone: "Invalid/Zone"` → fallback to UTC with note in response
4. Check `get_weekly_chart_list`, `get_user_info` — dates show explicit UTC, not runtime-local
5. Confirm `handlers.ts` also uses updated formatting
