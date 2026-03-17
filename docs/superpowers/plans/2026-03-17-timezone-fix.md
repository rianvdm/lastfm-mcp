# Timezone-Aware Date Formatting Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix date formatting on the Cloudflare Workers MCP server so track play times display in the user's local timezone instead of silently using UTC.

**Architecture:** A new `formatTimestamp` utility (locale-pinned `en-US`, `Intl.DateTimeFormat`) replaces all `.toLocaleDateString()` calls in both `authenticated.ts` and `handlers.ts`. The `get_recent_tracks` tool gains an optional `timezone` parameter (IANA string, default `'UTC'`); the handler validates it before use and shows a single top-level warning on invalid input. All other date sites (chart boundaries, registration date) always use UTC.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers (V8, full ICU, `Intl` available)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/dateFormat.ts` | **Create** | `formatTimestamp(unixSeconds, timezone?)` — pure formatting utility |
| `test/utils/dateFormat.test.ts` | **Create** | Unit tests for the utility |
| `src/mcp/tools/authenticated.ts` | **Modify** | Add `timezone` param + validation to `get_recent_tracks`; swap all `.toLocaleDateString()` |
| `src/protocol/handlers.ts` | **Modify** | Swap all `.toLocaleDateString()` with `formatTimestamp`; add `timezone` arg support to `get_recent_tracks` case |
| `test/protocol/tools.test.ts` | **Modify** | Add handler-level timezone tests for `get_recent_tracks` |

---

## Task 1: Create `formatTimestamp` utility (TDD)

**Files:**
- Create: `src/utils/dateFormat.ts`
- Create: `test/utils/dateFormat.test.ts`

- [ ] **Step 1.1: Write the failing unit tests**

Create `test/utils/dateFormat.test.ts`:

```typescript
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
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
npx vitest run test/utils/dateFormat.test.ts
```

Expected: FAIL — `Cannot find module '../../src/utils/dateFormat'`

- [ ] **Step 1.3: Implement `formatTimestamp`**

Create `src/utils/dateFormat.ts`:

```typescript
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
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```bash
npx vitest run test/utils/dateFormat.test.ts
```

Expected: 4 tests pass

- [ ] **Step 1.5: Commit**

```bash
git add src/utils/dateFormat.ts test/utils/dateFormat.test.ts
git commit -m "feat: add formatTimestamp utility with en-US locale and IANA timezone support"
```

---

## Task 2: Update `authenticated.ts` — `get_recent_tracks` timezone param

**Files:**
- Modify: `src/mcp/tools/authenticated.ts`

This task covers the primary MCP tool handler (used by the MCP server). There are 6 `.toLocaleDateString()` call sites; we replace all of them and add the timezone param to `get_recent_tracks`.

- [ ] **Step 2.1: Add the import at the top of `authenticated.ts`**

At the top of `src/mcp/tools/authenticated.ts`, add:

```typescript
import { formatTimestamp } from '../../utils/dateFormat'
```

(Place it with the other utility imports.)

- [ ] **Step 2.2: Add `timezone` param + validation to `get_recent_tracks`**

Find the `get_recent_tracks` tool definition (around line 195). The current schema is:

```typescript
{
  username: z.string().optional()...,
  limit: z.number()...,
  page: z.number()...,
  from: z.number().optional()...,
  to: z.number().optional()...,
}
```

Add `timezone` to the schema:

```typescript
timezone: z.string().optional().default('UTC')
  .describe('IANA timezone name (e.g. "America/New_York"). Defaults to UTC.'),
```

Update the handler signature from `async ({ username, limit, page, from, to })` to:

```typescript
async ({ username, limit, page, from, to, timezone })
```

- [ ] **Step 2.3: Add timezone validation and update track date formatting**

Inside the `get_recent_tracks` handler, after `const effectiveUsername = ...`, add:

```typescript
let effectiveTimezone = timezone
let timezoneWarning: string | undefined
try {
  Intl.DateTimeFormat('en-US', { timeZone: effectiveTimezone })
} catch {
  timezoneWarning = `⚠️ Unrecognized timezone "${effectiveTimezone}" — falling back to UTC.`
  effectiveTimezone = 'UTC'
}
```

Then replace the date formatting inside the `.map()`:

```typescript
// Before:
const date = track.date ? new Date(parseInt(track.date.uts) * 1000).toLocaleDateString() : ''

// After:
const date = track.date ? formatTimestamp(parseInt(track.date.uts), effectiveTimezone) : ''
```

Update the response text heading from:

```typescript
text: `🎵 **Recent Tracks for ${effectiveUsername}**
```

to:

```typescript
text: `${timezoneWarning ? timezoneWarning + '\n\n' : ''}🎵 **Recent Tracks for ${effectiveUsername}** (times in ${effectiveTimezone})
```

- [ ] **Step 2.4: Replace the remaining 4 `.toLocaleDateString()` call sites in `authenticated.ts`**

There are 5 more call sites. Replace each:

**`get_user_info` (around line 400):**
```typescript
// Before:
const registrationDate = new Date(parseInt(user.registered.unixtime) * 1000).toLocaleDateString()
// After:
const registrationDate = formatTimestamp(parseInt(user.registered.unixtime))
```

**`get_weekly_chart_list` (around lines 532–533):**
```typescript
// Before:
const fromDate = new Date(parseInt(chart.from) * 1000).toLocaleDateString()
const toDate = new Date(parseInt(chart.to) * 1000).toLocaleDateString()
// After:
const fromDate = formatTimestamp(parseInt(chart.from))
const toDate = formatTimestamp(parseInt(chart.to))
```

**`get_weekly_artist_chart` (around line 584):**
```typescript
// Before:
from && to ? `${new Date(from * 1000).toLocaleDateString()} to ${new Date(to * 1000).toLocaleDateString()}` : 'Most Recent Week'
// After:
from && to ? `${formatTimestamp(from)} to ${formatTimestamp(to)}` : 'Most Recent Week'
```

**`get_weekly_track_chart` (around line 634):**
```typescript
// Before:
from && to ? `${new Date(from * 1000).toLocaleDateString()} to ${new Date(to * 1000).toLocaleDateString()}` : 'Most Recent Week'
// After:
from && to ? `${formatTimestamp(from)} to ${formatTimestamp(to)}` : 'Most Recent Week'
```

- [ ] **Step 2.5: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass (no regressions)

- [ ] **Step 2.6: Commit**

```bash
git add src/mcp/tools/authenticated.ts
git commit -m "feat: add timezone param to get_recent_tracks, replace toLocaleDateString in authenticated.ts"
```

---

## Task 3: Update `handlers.ts` — replace `.toLocaleDateString()` and add `timezone` support

**Files:**
- Modify: `src/protocol/handlers.ts`

`handlers.ts` is the alternate protocol handler with the same 6 call sites. It reads args directly (no zod), so `timezone` is read as `(args?.timezone as string) || 'UTC'`.

- [ ] **Step 3.1: Add the import at the top of `handlers.ts`**

```typescript
import { formatTimestamp } from '../utils/dateFormat'
```

- [ ] **Step 3.2: Add `timezone` extraction and validation to the `get_recent_tracks` case**

Find `case 'get_recent_tracks':` (around line 965). After the existing arg extraction (`const from = ...`, `const to = ...`), add:

```typescript
const rawTimezone = (args?.timezone as string) || 'UTC'
let effectiveTimezone = rawTimezone
let timezoneWarning: string | undefined
try {
  Intl.DateTimeFormat('en-US', { timeZone: effectiveTimezone })
} catch {
  timezoneWarning = `⚠️ Unrecognized timezone "${rawTimezone}" — falling back to UTC.`
  effectiveTimezone = 'UTC'
}
```

Replace the date formatting in the `.map()` (around line 978):

```typescript
// Before:
const date = track.date ? new Date(parseInt(track.date.uts) * 1000).toLocaleDateString() : ''
// After:
const date = track.date ? formatTimestamp(parseInt(track.date.uts), effectiveTimezone) : ''
```

Update the response text heading to include the timezone note (find the line that starts `` `🎵 **Recent Tracks for ``):

```typescript
// Prepend warning if present, add timezone note to heading
text: `${timezoneWarning ? timezoneWarning + '\n\n' : ''}🎵 **Recent Tracks for ${username}** (times in ${effectiveTimezone})
```

- [ ] **Step 3.3: Replace the remaining `.toLocaleDateString()` call sites in `handlers.ts`**

**`get_user_info` (around line 1233):**
```typescript
// Before:
const registrationDate = new Date(parseInt(user.registered.unixtime) * 1000).toLocaleDateString()
// After:
const registrationDate = formatTimestamp(parseInt(user.registered.unixtime))
```

**`get_weekly_chart_list` (around lines 1373–1374):**
```typescript
// Before:
const fromDate = new Date(parseInt(chart.from) * 1000).toLocaleDateString()
const toDate = new Date(parseInt(chart.to) * 1000).toLocaleDateString()
// After:
const fromDate = formatTimestamp(parseInt(chart.from))
const toDate = formatTimestamp(parseInt(chart.to))
```

**`get_weekly_artist_chart` (around line 1409):**
```typescript
// Before:
from && to ? `${new Date(from * 1000).toLocaleDateString()} to ${new Date(to * 1000).toLocaleDateString()}` : 'Most Recent Week'
// After:
from && to ? `${formatTimestamp(from)} to ${formatTimestamp(to)}` : 'Most Recent Week'
```

**`get_weekly_track_chart` (around line 1445):**
```typescript
// Before:
from && to ? `${new Date(from * 1000).toLocaleDateString()} to ${new Date(to * 1000).toLocaleDateString()}` : 'Most Recent Week'
// After:
from && to ? `${formatTimestamp(from)} to ${formatTimestamp(to)}` : 'Most Recent Week'
```

- [ ] **Step 3.4: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 3.5: Commit**

```bash
git add src/protocol/handlers.ts
git commit -m "feat: replace toLocaleDateString in handlers.ts with formatTimestamp, add timezone support to get_recent_tracks"
```

---

## Task 4: Add handler-level tests for `get_recent_tracks` timezone behavior

**Files:**
- Modify: `test/protocol/tools.test.ts`

These tests exercise the `handlers.ts` `get_recent_tracks` case with timezone arguments. They use the existing mock setup (Vitest, mocked `lastfmClient`).

- [ ] **Step 4.1: Write the failing handler-level timezone tests**

In `test/protocol/tools.test.ts`, add a new `describe` block after the existing `get_user_recent_tracks` test:

```typescript
describe('get_recent_tracks timezone handling', () => {
  const mockRecentTracksData = {
    recenttracks: {
      track: [
        {
          name: 'Test Track',
          artist: { '#text': 'Test Artist' },
          album: { '#text': 'Test Album' },
          // Unix timestamp 1705359600 = 2024-01-15T23:00:00Z
          date: { uts: '1705359600', '#text': '15 Jan 2024, 23:00' },
        },
      ],
      '@attr': { page: '1', totalPages: '1', total: '1', perPage: '50' },
    },
  }

  beforeEach(async () => {
    resetInitialization()
    resetProtocolState()
    vi.clearAllMocks()
    mockLastfmClient.getRecentTracks = vi.fn().mockResolvedValue(mockRecentTracksData)

    await handleMethod({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Test', version: '1.0' } },
      id: 1,
    })
    await handleMethod({ jsonrpc: '2.0', method: 'initialized' })
  })

  it('shows "(times in UTC)" in header when no timezone is given', async () => {
    const response = await handleMethod(
      { jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_recent_tracks', arguments: {} }, id: 2 },
      await createMockAuthenticatedRequest(),
      mockJwtSecret,
    )
    const text = response?.result?.content?.[0]?.text ?? ''
    expect(text).toContain('(times in UTC)')
  })

  it('shows "(times in America/New_York)" and ET-formatted date when timezone is provided', async () => {
    const response = await handleMethod(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'get_recent_tracks', arguments: { timezone: 'America/New_York' } },
        id: 2,
      },
      await createMockAuthenticatedRequest(),
      mockJwtSecret,
    )
    const text = response?.result?.content?.[0]?.text ?? ''
    expect(text).toContain('(times in America/New_York)')
    // 2024-01-15T23:00:00Z = 6:00 PM EST
    expect(text).toContain('Jan 15, 2024')
    expect(text).toContain('6:00 PM')
  })

  it('shows a warning and falls back to UTC for an invalid timezone', async () => {
    const response = await handleMethod(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'get_recent_tracks', arguments: { timezone: 'Invalid/Zone' } },
        id: 2,
      },
      await createMockAuthenticatedRequest(),
      mockJwtSecret,
    )
    const text = response?.result?.content?.[0]?.text ?? ''
    expect(text).toContain('Unrecognized timezone "Invalid/Zone"')
    expect(text).toContain('falling back to UTC')
    expect(text).toContain('(times in UTC)')
  })
})
```

Note: `mockLastfmClient` needs `getRecentTracks` added to its mock definition at the top of the file if not already present. Check the mock object — if it only has `getUserRecentTracks`, add `getRecentTracks: vi.fn()` to the mock factory.

- [ ] **Step 4.2: Run the new tests to confirm they fail**

```bash
npx vitest run test/protocol/tools.test.ts
```

Expected: the 3 new tests FAIL (handler doesn't have timezone support yet — but wait, Task 3 already added it). If Tasks 2 and 3 are done first, these tests may already pass. Run to verify.

- [ ] **Step 4.3: Run full test suite to confirm everything passes**

```bash
npx vitest run
```

Expected: all tests pass including the 3 new timezone tests

- [ ] **Step 4.4: Commit**

```bash
git add test/protocol/tools.test.ts
git commit -m "test: add handler-level timezone tests for get_recent_tracks"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npx vitest run` — all tests green, including `test/utils/dateFormat.test.ts` (4 tests) and the 3 new timezone tests in `test/protocol/tools.test.ts`
- [ ] No remaining `.toLocaleDateString()` calls in `src/` — verify with: `grep -r "toLocaleDateString" src/` (should return empty)
- [ ] `get_recent_tracks` without `timezone` → header shows `(times in UTC)`, dates are in UTC
- [ ] `get_recent_tracks` with `timezone: "America/Los_Angeles"` → header shows `(times in America/Los_Angeles)`, dates in PT
- [ ] `get_recent_tracks` with `timezone: "Invalid/Zone"` → single warning line, `(times in UTC)` in header
- [ ] `get_weekly_chart_list` dates show UTC (e.g. `Jan 15, 2024, 12:00 AM UTC`) — not runtime-local
- [ ] `get_user_info` registration date shows UTC
