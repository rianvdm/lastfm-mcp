# History Query Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent answer "when did I first listen to X" in a handful of calls: artist filters and limits on the weekly charts, an artist-filtered scan on `get_recent_tracks`, no now-playing row in range queries, and session-aware public lookups.

**Architecture:** Two small helper modules under `src/mcp/tools/` (artist-name matching, and the capped recent-tracks scan) feed the existing tool handlers in `authenticated.ts`. `registerPublicTools` gains the same `getSession` accessor the authenticated tools already get.

**Tech Stack:** TypeScript (strict), Cloudflare Workers, MCP SDK v2 (`@modelcontextprotocol/server`), zod, vitest 4 + `@cloudflare/vitest-pool-workers`, Node 22.

**Spec:** `docs/superpowers/specs/2026-11-14-history-query-tools-design.md`

## Global Constraints

- Read `AGENTS.md` before starting. Tabs, no semicolons, single quotes, 140-char width.
- Every new file (source and test) opens with exactly two `// ABOUTME:` lines.
- Tests use `describe`/`it`, live under `test/` mirroring `src/`, and drive handlers through the stub-server pattern in `test/mcp/tools/recommendations-hints.test.ts` (parse args with the tool's own `inputSchema`).
- `import type` for type-only imports; no file extensions on relative imports.
- Chart `limit`: `min(1).max(1000)`, default `30`. Ignored when `artist` is set.
- Recent-tracks scan: Last.fm pages of `1000` scrobbles (verified: `user.getRecentTracks` returns 1,000 per page), at most `5` pages per call, so a call scans at most 5,000 scrobbles.
- Artist suggestions: at most `5`.
- Run `npx vitest run test/mcp/server.test.ts -u` only after reading the snapshot diff and confirming it shows nothing but this task's description and property changes.

## Review Focus

1. Last.fm returns a single chart row, or a single scrobble, as an object instead of an array. Filtering and the scan must still find it (use `toArray` from `src/mcp/tools/formatters.ts`).
2. A period with no plays at all (`artist` key missing or an empty array) with `artist` set: answer "doesn't appear in this period" with no suggestions, and don't crash.
3. The same name with different case, surrounding spaces, or Unicode composition (`Sigur Rós` precomposed vs decomposed) counts as a match.
4. A scan whose `page` starts past the range's last Last.fm page: report that nothing is left to scan. Don't say "No scrobbles by X in this range."
5. A Last.fm error partway through a scan: the whole call returns `toolError`. Never return the partial matches as if the scan were complete.

---

### Task 1: Artist matching helper and chart tool filters

**Files:**
- Create: `src/mcp/tools/artistMatch.ts`
- Modify: `src/mcp/tools/authenticated.ts` (`get_weekly_artist_chart` ~712-770, `get_weekly_track_chart` ~773-840)
- Modify: `src/mcp/server.ts:62` (instructions line for historical week-by-week)
- Test: `test/mcp/tools/artistMatch.test.ts`, `test/mcp/tools/weekly-chart-filters.test.ts`, snapshot `test/mcp/__snapshots__/server.test.ts.snap`

**Interfaces:**
- Produces: `normalizeArtistName(name: string): string`, which applies `.normalize('NFC').trim().toLowerCase()`
- Produces: `isSameArtist(a: string, b: string): boolean`
- Produces: `suggestArtistNames(names: string[], query: string, max = 5): string[]`. This returns distinct names in input order, where the normalized name contains the normalized query, or the normalized query contains a normalized name of 3 or more characters. Exact matches are excluded.

- [ ] **Step 1: Write failing helper tests** in `test/mcp/tools/artistMatch.test.ts`
  - `isSameArtist('The Paper Kites', '  the paper kites ')` is `true`
  - `isSameArtist('Sigur Rós', 'Sigur Rós')` is `true`
  - `isSameArtist('Slowdive', 'Slowdive Tribute')` is `false`
  - `suggestArtistNames(['The Paper Kites', 'Kites', 'Pink Floyd', 'The Paper Kites'], 'Paper Kites')` equals `['The Paper Kites', 'Kites']`
  - `suggestArtistNames(names, 'x')` returns no more than 5 items, and `[]` for an empty list

- [ ] **Step 2: Run** `npx vitest run test/mcp/tools/artistMatch.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the three functions in `src/mcp/tools/artistMatch.ts`.

- [ ] **Step 4: Write failing chart tests** in `test/mcp/tools/weekly-chart-filters.test.ts`. Stub `getWeeklyArtistChart` with 40 artists, `The Paper Kites` at position 35 with `playcount: '1'`, plus a stub `getWeeklyTrackChart`.
  - Artist chart, no args: output has 30 numbered rows and a "Showing top 30" note
  - Artist chart, `limit: 5`: 5 rows, note says top 5
  - Artist chart, `artist: 'the paper kites'`: output contains `#35 of 40` and `The Paper Kites (1 play)`, and lists no other artist
  - Artist chart, `artist: 'Paper Kites'` with no exact match: says it doesn't appear in this period and suggests `The Paper Kites`
  - Artist chart where Last.fm returns a single artist object (not an array) and `artist` matches it: found (Review Focus 1)
  - Artist chart with an empty period (`artist: []`, and the `artist` key missing): "doesn't appear", no suggestions (Review Focus 2)
  - Track chart, `artist: 'slowdive'`: lists every Slowdive track with its position and no other artist's tracks
  - `limit: 0` and `limit: 1001` fail schema parsing

- [ ] **Step 5: Run** `npx vitest run test/mcp/tools/weekly-chart-filters.test.ts`. Expected: FAIL.

- [ ] **Step 6: Implement in both chart tools.**
  - Add `artist` and `limit` to the input schemas, with the descriptions from spec §1.
  - Wrap the Last.fm array with `toArray`.
  - Positions are index + 1 in the full chart; the artist chart shows `#<pos> of <total>`.
  - Replace the hard-coded 30 with `limit`.
  - Use the spec §2 wording for `from`/`to`: any Unix range works (a week, a month, a year), and `get_weekly_chart_list` is one source of week boundaries.
  - Add to each tool description that `artist` finds an artist anywhere in the chart. Keep the existing "REQUIRES AUTHENTICATION" wording.
  - Update the `server.ts:62` instructions line to say any `from`/`to` range works and `artist` finds one artist in a chart.

- [ ] **Step 7: Run** `npx vitest run test/mcp/tools/`. Expected: PASS.

- [ ] **Step 8: Update the snapshot.** Run `npx vitest run test/mcp/server.test.ts`, read the diff (only the two chart tools' descriptions and properties should change), then rerun with `-u`.

- [ ] **Step 9: Run** `npm test && npm run lint && npm run format:check`. Expected: all pass.

- [ ] **Step 10: Commit** with `feat(tools): add artist filter and limit to the weekly chart tools`.

### Task 2: `get_recent_tracks` now-playing fix and artist scan

**Files:**
- Create: `src/mcp/tools/artistScan.ts`
- Modify: `src/mcp/tools/authenticated.ts` (`get_recent_tracks` ~118-235)
- Test: `test/mcp/tools/artistScan.test.ts`, `test/mcp/tools/recent-tracks.test.ts`, snapshot

**Interfaces:**
- Consumes: `isSameArtist` from Task 1
- Produces: `SCAN_PAGE_SIZE = 1000`, `SCAN_PAGES_PER_CALL = 5`, and:

```typescript
export interface ArtistScanResult {
	matches: LastfmTrack[] // newest first, now-playing rows removed
	scannedFrom: number // 1-based index of the first scrobble this call scanned (0 when nothing was scanned)
	scannedTo: number // 1-based index of the last scrobble this call scanned
	totalInRange: number // recenttracks['@attr'].total
	complete: boolean // true when this call reached the range's last Last.fm page
	nextPage: number | null // the scan block to pass as `page` next, or null when complete
}
export async function scanArtistScrobbles(
	client: CachedLastfmClient,
	username: string,
	artist: string,
	opts: { from?: number; to?: number; page: number },
): Promise<ArtistScanResult>
```

Scan block `page` covers Last.fm pages `(page - 1) * 5 + 1` to `page * 5`. Fetch them in order and stop after Last.fm's `totalPages`. Drop rows with `nowplaying` set. A thrown fetch propagates (Review Focus 5).

- [ ] **Step 1: Write failing scan tests** in `test/mcp/tools/artistScan.test.ts`. The stub `getRecentTracks(username, limit, from, to, page)` serves a range of 7 Last.fm pages.
  - Block 1 calls pages 1–5 with `limit` 1000 and the given `from`/`to`, and returns `complete: false, nextPage: 2`
  - Block 2 calls pages 6–7 only and returns `complete: true, nextPage: null`
  - Matches come from several pages in Last.fm order; a now-playing row by the same artist is excluded
  - A range of 1 page: one call, `complete: true`
  - A page that returns a single track object: still matched (Review Focus 1)
  - Block 3 of a 7-page range: no fetch past the end, `scannedFrom: 0`, `complete: true` (Review Focus 4). Fetching page 11 to learn `totalPages` is acceptable; the assertion is on the result.
  - A rejection on page 3 makes `scanArtistScrobbles` reject (Review Focus 5)

- [ ] **Step 2: Run** `npx vitest run test/mcp/tools/artistScan.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `scanArtistScrobbles` in `src/mcp/tools/artistScan.ts`.

- [ ] **Step 4: Write failing tool tests** in `test/mcp/tools/recent-tracks.test.ts`.
  - No `from`/`to`/`date`/`page`: a now-playing first row still shows `🎵 Now Playing`
  - With `from` and `to`, with `date`, and with `page: 2`: the now-playing row is absent, and "Showing N tracks" counts dated rows only
  - `artist: 'The Paper Kites'`, complete scan with 2 matches: lists both with dates and says the scan was complete (scanned X of X)
  - Complete scan with 0 matches: contains `No scrobbles by The Paper Kites in this range`
  - Incomplete scan with 0 matches: does not contain `No scrobbles by`; tells the agent to use `page: 2` or narrow `from`/`to`
  - Scan block past the end: says there is nothing left to scan in this range, and not `No scrobbles by`

- [ ] **Step 5: Run** `npx vitest run test/mcp/tools/recent-tracks.test.ts`. Expected: FAIL.

- [ ] **Step 6: Implement in `get_recent_tracks`.**
  - Add `artist`, with the spec §3 description.
  - Update the `page` description: with `artist`, it selects the 5,000-scrobble scan block.
  - Filter now-playing when `from !== undefined || to !== undefined || date !== undefined || page > 1`.
  - Without `artist`, behaviour is otherwise unchanged.
  - With `artist`, call `scanArtistScrobbles` (ignoring `limit`) and render a header from spec §3, using `scannedFrom`/`scannedTo`/`totalInRange` with thousands separators, followed by the matched rows in the existing row format and timezone handling.
  - Next steps stay as today.

- [ ] **Step 7: Run** `npx vitest run test/mcp/tools/`. Expected: PASS.

- [ ] **Step 8: Update the snapshot** the same way as Task 1 Step 8 (only `get_recent_tracks` changes).

- [ ] **Step 9: Run** `npm test && npm run lint && npm run format:check`. Expected: all pass.

- [ ] **Step 10: Commit** with `feat(tools): filter recent tracks by artist and drop now-playing from range queries`.

### Task 3: Public lookups default to the signed-in user

**Files:**
- Modify: `src/mcp/tools/public.ts` (signature at :17; `get_track_info` ~82-145, `get_artist_info` ~148-210, `get_album_info` ~212-280)
- Modify: `src/mcp/server.ts:86`
- Modify: `test/mcp/tools/recommendations-hints.test.ts:43`, `test/mcp/tools/public-listentomore-link.test.ts:56` (pass a session accessor)
- Test: `test/mcp/tools/public-session-defaults.test.ts`

**Interfaces:**
- Consumes: `AuthSession` type from `src/mcp/tools/authenticated.ts`
- Produces: `registerPublicTools(server: McpServer, client: CachedLastfmClient, getSession: () => AuthSession | null): void`

- [ ] **Step 1: Write failing tests** in `test/mcp/tools/public-session-defaults.test.ts`, covering each of `get_artist_info`, `get_album_info`, and `get_track_info`.
  - Signed in as `rj`, no `username`: the client is called with `'rj'`, the output shows `Your plays`, and it has no "Sign in to see" note
  - Signed in as `rj`, `username: 'someone'`: the client is called with `'someone'`
  - Signed out (`() => null`), no `username`: the client is called with `undefined`, and the "Sign in to see" note is present

- [ ] **Step 2: Run** `npx vitest run test/mcp/tools/public-session-defaults.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Add the `getSession` parameter.
  - In the three tools, the effective username is `username || getSession()?.username`. Use it for the client call, the `Your plays` line, and the sign-in note.
  - Update the `username` descriptions to say it defaults to the signed-in user.
  - Pass `getSession` at `server.ts:86`, and update the two existing tests' calls.

- [ ] **Step 4: Update the snapshot** the same way as Task 1 Step 8 (only the three `username` descriptions change, if the snapshot covers them).

- [ ] **Step 5: Run** `npm test && npm run lint && npm run format:check`. Expected: all pass.

- [ ] **Step 6: Commit** with `feat(tools): default public lookups to the signed-in user`.

### Task 4: Whole-branch verification and staging (controller)

- [ ] **Step 1: Run** `npm test && npm run lint && npm run format:check && npm run build`. Expected: all pass, and the dry-run deploy succeeds.
- [ ] **Step 2: Deploy to staging** with `npm run deploy`. Expected: the `lastfm-mcp` Worker deploys, and `/health` reports the deployed version.
- [ ] **Step 3: Live checks** through the `lastfm-staging` MCP connection (reconnect it to pick up the new schemas):
  - `get_weekly_artist_chart` for 2013 with `artist: "The Paper Kites"`
  - `get_recent_tracks` with a 2013 `from`/`to` (no now-playing row)
  - `get_recent_tracks` with `artist: "The Paper Kites"` over the found week
  - `get_artist_info` for `The Paper Kites` with no username (shows your plays)
