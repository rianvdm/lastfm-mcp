# History Query Fixes: Artist Filters, Chart Limits, Now-Playing, Session Defaults

**Date:** 2026-11-14
**Status:** In Review
**Follow-up:** [#75](https://github.com/rianvdm/lastfm-mcp/issues/75) (`get_artist_history`)

## Problem

Asked "when did I first listen to The Paper Kites?", Claude needed about 40 tool calls, scanned roughly 1,560 raw scrobbles by eye, and still couldn't rule out 2010–2011. The causes are in the tools:

- `get_weekly_artist_chart` and `get_weekly_track_chart` fetch the full Last.fm chart and then cut it to 30 rows (`authenticated.ts`, `.slice(0, 30)`). A 1-play artist almost never makes the cut in a busy week.
- `get_recent_tracks` can't filter by artist, so confirming one scrobble means reading every scrobble in the range.
- The `from`/`to` descriptions say to take values from `get_weekly_chart_list`, which shows only the latest 20 periods. Arbitrary ranges (a whole year, say) work, but nothing tells the agent that.
- Last.fm puts the now-playing track at the top of `user.getRecentTracks` even for a past range. The tool keeps it, so a 2013 query starts with an undated current track, and the count reads "426 out of 425."
- `get_artist_info`, `get_album_info`, and `get_track_info` are public tools that never see the session, so a signed-in user's play count only appears when the agent passes the username by hand.

## Goals

- An agent can find whether an artist appears in any date range in one call, whatever their rank.
- An agent can list one artist's scrobbles in a range without reading anyone else's.
- Range queries never include the now-playing row.
- Signed-in users get their own play counts on artist, album, and track lookups by default.

## Non-goals

- `get_artist_history` (first/last scrobble, plays per year). That's #75 and builds on this.
- A compact output mode for `get_recent_tracks`. The artist filter removes most of the need.
- Storing scrobble history anywhere. This is a public multi-user server; storing histories would change the privacy policy.

## Anti-goals

- An artist-filtered call that silently scans an unbounded number of Last.fm pages and burns the user's rate limit.
- A filtered result that says "no plays" when the server stopped scanning early. A partial scan must say it was partial.

## Approaches

1. **Artist filter on the chart tools only.** The agent narrows to a week with the filtered chart, then reads that week's raw scrobbles. Smallest change, but the last step is still reading a few hundred lines by eye, which is where the original session risked missing a line.
2. **Artist filter on the chart tools and `get_recent_tracks`, with a page cap (picked).** The server fetches the range's pages, keeps only that artist's scrobbles, and stops at a fixed cap with a clear "scan incomplete" note and how to continue. More code and more Last.fm calls per invocation, but it finishes the job without manual scanning.

Rian picked approach 2.

## Design

### 1. Weekly chart tools: `artist` and `limit`

Both `get_weekly_artist_chart` and `get_weekly_track_chart` gain:

```typescript
artist: z.string().optional().describe('Only show this artist (case-insensitive). Searches the whole chart, not just the top rows.')
limit: z.coerce.number().min(1).max(1000).optional().default(30).describe('Maximum rows to show (1-1000). Ignored when artist is set.')
```

- Without `artist`: show the first `limit` rows. The "Showing top N" note uses the actual limit.
- With `artist`: match case-insensitively on the trimmed name against the full chart before any cut. For the artist chart, show the matching row with its rank (`#212 of 1,480 · The Paper Kites (1 play)`). For the track chart, show every track by that artist with its rank.
- No exact match: say the artist doesn't appear in this period, and list up to 5 chart artists whose names contain the query as possible matches (catches "Paper Kites" vs "The Paper Kites"). **My call**; looser matching belongs to #75.

### 2. `from`/`to` descriptions and server instructions

The chart tools' `from`/`to` descriptions say any Unix range works (a week, a month, a year), with `get_weekly_chart_list` as one source of week boundaries. Update the matching line in the server instructions (`src/mcp/server.ts`) to mention arbitrary ranges and the `artist` filter.

Last.fm documents only chart-list boundaries. If Last.fm rejects or errors on a range, the existing `toolError` path reports it; no extra handling.

### 3. `get_recent_tracks`: now-playing and `artist`

**Now-playing:** drop rows with `nowplaying` set whenever `from`, `to`, `date`, or `page > 1` is given. With none of those (the plain "what am I playing" call), keep today's behaviour.

**Artist filter:**

```typescript
artist: z.string().optional().describe("Only return this artist's scrobbles (case-insensitive). Scans up to 5,000 scrobbles per call; use page to continue.")
```

- With `artist`, the server fetches Last.fm pages of 1,000 scrobbles (the tool's existing per-page maximum) for the range, up to **5 pages per call** (**my call** on the cap), and keeps matching rows only. Rows are in Last.fm's order (newest first).
- `page` means the scan block: page 1 scans scrobbles 1–5,000 of the range, page 2 scans 5,001–10,000, and so on. `limit` is ignored in this mode.
- The header states what was scanned: "Scanned 1,240 of 1,240 scrobbles in range (complete)", or "Scanned 5,000 of 18,400 (incomplete): use page: 2 to scan the next 5,000, or narrow from/to."
- Zero matches in a complete scan: "No scrobbles by X in this range." Zero matches in an incomplete scan must not say that.
- Stop early when Last.fm reports the last page.

### 4. Public lookup tools default to the signed-in user

`registerPublicTools` takes `getSession` (the same `() => AuthSession | null` the authenticated tools get). In `get_artist_info`, `get_album_info`, and `get_track_info`, the effective username is `username || getSession()?.username`. The "Sign in to see your personal listening stats" note shows only when neither exists. Lookups still work signed out.

### Tests

- Chart tools: artist filter finds a row past position 30; case-insensitive match; no-match suggestions; `limit` respected.
- Recent tracks: now-playing dropped for range and later-page calls, kept for the plain call; artist filter across multiple pages; cap reached reports incomplete with the next page; complete zero-match message.
- Public tools: signed-in session supplies the username; explicit username wins; signed-out output unchanged.
- Update the tool-catalogue snapshot (`test/mcp/__snapshots__/server.test.ts.snap`) for the new parameters and descriptions.

## Left to the builder

- Exact output wording beyond the messages above, matching the existing tool style.
- Whether to page through Last.fm sequentially or in small parallel batches (sequential is fine; stop at the last page).
- Confirming Last.fm accepts `limit=1000` on `user.getRecentTracks`. If it caps lower, keep the 5-page cap and scale the per-call scrobble count in the description to match.
