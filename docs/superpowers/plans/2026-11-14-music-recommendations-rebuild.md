# Music Recommendations Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `get_music_recommendations` so it recommends new-to-the-user artists with cited reasons and starter tracks, protects Last.fm with a per-call budget, deadline and concurrency cap, and gets chosen by agents.

**Architecture:** A per-call Last.fm request policy (AsyncLocalStorage, like `CacheTally`) enforces budget, deadline, concurrency and a short retry policy at `LastfmClient.makeRequest`, and every tool call now counts real Last.fm HTTP requests into analytics. A new `src/recommendations/` module has pure scoring, an engine that builds a per-user ranked candidate list (cached 1 hour, never containing `exclude`) and a read path that applies `exclude`/`limit` and fetches starters, plus a formatter. The tool, its description, the server instructions, Next-steps hints and the `music_discovery` prompt are rewritten around it.

**Tech Stack:** TypeScript (strict), Cloudflare Workers (workerd, `nodejs_compat`), MCP SDK v2 (`@modelcontextprotocol/server`), zod, vitest 4 with `@cloudflare/vitest-pool-workers` 0.22, Node 22.

**Spec:** `docs/superpowers/specs/2026-11-14-music-recommendations-rebuild-design.md`

## Global Constraints

- Every new or changed source and test file opens with exactly two `// ABOUTME:` lines (what it is; its purpose or scope).
- Prettier: tabs, no semicolons, single quotes, 140-char width. Imports: external, blank line, relative; `import type` for types; no file extensions on relative imports.
- Tests use `describe`/`it`, live under `test/` mirroring `src/`. Tool failures return `toolError('get_music_recommendations', error)`.
- Stringify caught errors with `error instanceof Error ? error.message : 'Unknown error'`.
- Tool inputs: `username` optional string; `limit` 1–15, default 8; `genre` optional string; `exclude` optional array of up to 50 artist names, matched case-insensitively after trimming.
- Request policy for the recommendations tool: at most 4 Last.fm requests in flight; budget 40 Last.fm HTTP requests per tool call, retries included; 8-second wall-clock deadline; at most 1 retry, with retry delay capped (no waiting out long `Retry-After`). Other tools keep `maxRetries: 3`, `maxDelayMs: 15000`.
- Seeds: `7day`, `1month`, `12month` top artists and `overall` with page size 1000 (confirm Last.fm's maximum in Task 3; use it if lower). Starting weights 7day 3, 1month 2, 12month 1, overall-only 0.5. Up to 12 fan-out seeds. Similar-artist `limit` 30 (the `get_similar_artists` tool default, so cache entries are shared). Starter lookups use limit 10 (the `get_artist_top_tracks`/`get_artist_top_albums` tool defaults).
- Caching: ranked candidate list per user and lowercased `genre`, TTL 1 hour, key carries a `v2` prefix; `exclude` never appears in any KV key or value. Tag top artists TTL 7 days, shared. Partial candidate lists are not cached.
- Analytics: `ToolCallEvent` gains `lastfmRequests`, written as `double2`. No user identifier in any event.
- A merge to `main` deploys production. Release bumps `package.json`, `package-lock.json` and `SERVER_VERSION` in `src/mcp/protocol.ts` from 2.8.0 to 2.9.0.

## Review Focus

1. **A user with thin history** (new account; empty `7day` window; empty `overall`). Expect picks from whatever windows have data, and a plain "not enough listening history yet" message when all four are empty, not an error. Test in Task 5.
2. **Name variants across Last.fm lists** ("The National" vs "the national ", or the same artist in two windows). Expect library and `exclude` matching on the normalised name and one candidate per artist. Test in Task 4.
3. **One seed's similar-artist lookup fails** (Last.fm error 6, artist not found). Expect that seed skipped, the rest used, and the result not marked partial. Test in Task 5.
4. **Everything filtered out** (heavy listener plus a long `exclude`). Expect a message suggesting a genre or a shorter exclude list, not an empty heading. Test in Task 6.
5. **Genre casing and spacing** ("Post Rock" vs "post rock"). Expect one cache entry and the same picks. Test in Task 3 (cache key) and Task 5.

---

### Task 1: Count Last.fm HTTP requests per tool call (`double2`)

**Files:**
- Modify: `src/utils/cacheTally.ts` (add `requests`, `countLastfmRequest`)
- Modify: `src/utils/retry.ts` (add `onAttempt` to `RetryOptions`)
- Modify: `src/clients/lastfm.ts` (`makeRequest` counts each attempt)
- Modify: `src/analytics/toolEvents.ts`, `src/mcp/instrumentation.ts`
- Test: `test/utils/retry.test.ts`, `test/clients/lastfm.test.ts`, `test/analytics/toolEvents.test.ts`, `test/mcp/instrumentation.test.ts`

**Interfaces:**
- Produces: `CacheTally { hits: number; misses: number; requests: number }`; `countLastfmRequest(): void`; `RetryOptions.onAttempt?: (attempt: number) => void`; `ToolCallEvent.lastfmRequests: number`; data point `doubles: [durationMs, lastfmRequests]`.

- [ ] **Step 1: Write failing tests**
  - `retry.test.ts` › `it('should call onAttempt before every attempt, retries included')`: a fn that rejects with a 429 `Response` once then resolves; `withRetry(fn, { maxRetries: 2, initialDelayMs: 1, onAttempt })` → `onAttempt` called with `1` then `2`.
  - `retry.test.ts` › `it('should stop without retrying when onAttempt throws a non-retryable error')`: `onAttempt` throws `new Error('budget')` → rejects/fails with `'budget'`, fn never called.
  - `lastfm.test.ts` › `it('should count every HTTP attempt into the current tally')`: `globalThis.fetch` returns a 429 then a 200 JSON; inside `runWithCacheTally(tally, …)` call any client method → `tally.requests === 2`.
  - `toolEvents.test.ts`: `toDataPoint({ …, lastfmRequests: 7 }, …).doubles` equals `[durationMs, 7]`.
  - `instrumentation.test.ts`: a tool whose handler calls `countLastfmRequest()` three times reports `lastfmRequests: 3`; a tool making none reports `0`.
- [ ] **Step 2: Run them, expect failures**
  Run: `npx vitest run test/utils/retry.test.ts test/clients/lastfm.test.ts test/analytics/toolEvents.test.ts test/mcp/instrumentation.test.ts`
  Expected: FAIL (`onAttempt`, `requests`, `lastfmRequests` missing).
- [ ] **Step 3: Implement**
  - `withRetry` calls `onAttempt?.(attempt)` inside the `try`, before `fn()`, so a throw from it goes through `shouldRetry` (and is not retried unless retryable).
  - `makeRequest` passes `onAttempt: () => countLastfmRequest()` merged into `lastfmRetryOptions`.
  - Every `{ hits: 0, misses: 0 }` construction becomes `{ hits: 0, misses: 0, requests: 0 }` (grep `src` and `test`).
  - Update the layout comment in `toolEvents.ts`: `double1 = duration in ms, double2 = Last.fm HTTP requests (retries included)`.
- [ ] **Step 4: Run the same tests, then the full suite**
  Run: `npx vitest run` — Expected: all PASS (update any test that constructs a tally).
- [ ] **Step 5: Commit**
  `git commit -m "feat(analytics): record Last.fm HTTP requests per tool call as double2"`

### Task 2: Per-call Last.fm request policy (budget, deadline, concurrency, short retries)

**Files:**
- Create: `src/utils/lastfmRequestPolicy.ts`
- Modify: `src/clients/lastfm.ts` (`makeRequest` runs under the current policy)
- Test: `test/utils/lastfmRequestPolicy.test.ts`, `test/clients/lastfm.test.ts`

**Interfaces:**
- Consumes: `RetryOptions.onAttempt` (Task 1).
- Produces:
  - `interface RequestPolicy { maxRequests: number; deadlineMs: number; maxConcurrent: number; maxRetries: number; maxRetryDelayMs: number }`
  - `const RECOMMENDATION_POLICY: Omit<RequestPolicy, 'deadlineMs'> & { timeoutMs: number }` = `{ maxRequests: 40, timeoutMs: 8000, maxConcurrent: 4, maxRetries: 1, maxRetryDelayMs: 2000 }`
  - `runWithRequestPolicy<T>(policy: RequestPolicy, fn: () => Promise<T>): Promise<T>`
  - `class RequestBudgetExceeded extends Error` (`reason: 'budget' | 'deadline'`)
  - `isRateLimited(error: unknown): boolean` — true for a 429 `ResponseError`/`HTTP 429` message or `Last.fm API error 29`.
  - Internal to the client: `withPolicy<T>(send: (retry: Partial<RetryOptions>) => Promise<T>): Promise<T>` — acquires a concurrency slot, throws `RequestBudgetExceeded` before any attempt once the budget or deadline is spent, and passes retry overrides (`maxRetries`, `maxDelayMs`) plus an `onAttempt` that charges the budget.

- [ ] **Step 1: Write failing tests** (`lastfmRequestPolicy.test.ts`)
  - `it('should never run more than maxConcurrent requests at once')`: 10 sends that each await a manual promise; peak in-flight count `=== 4`.
  - `it('should throw RequestBudgetExceeded with reason budget once maxRequests attempts are spent')`: `maxRequests: 3`, four sends → fourth rejects, `reason === 'budget'`.
  - `it('should count a retry against the budget')`: `maxRequests: 2`, one send that retries once → budget spent, next send rejects.
  - `it('should throw with reason deadline after deadlineMs')` using `vi.useFakeTimers()`.
  - `it('should leave requests outside a policy unrestricted')`: no `runWithRequestPolicy` → 10 concurrent sends all start immediately, default retry options untouched.
  - `it('should keep concurrent policies separate')`: two `runWithRequestPolicy` calls in `Promise.all` each with `maxRequests: 2` both succeed with 2 sends.
  - `isRateLimited`: true for `new Error('HTTP 429: Too Many Requests')` and `new Error('Last.fm API error 29: Rate limit exceeded')`; false for `'Last.fm API error 6: …'`.
  - `lastfm.test.ts` › `it('should retry at most once under a policy')`: fetch always 429; under a policy with `maxRetries: 1` → fetch called 2 times, rejects; `isRateLimited(error) === true`.
- [ ] **Step 2: Run, expect failures**
  Run: `npx vitest run test/utils/lastfmRequestPolicy.test.ts test/clients/lastfm.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/utils/lastfmRequestPolicy.ts` with an `AsyncLocalStorage<PolicyState>` (`used`, `inFlight`, a FIFO of waiters), and wrap `makeRequest`'s `fetchWithRetry` call in it. A waiter that wakes after the deadline rejects with `reason: 'deadline'`. Release the slot in `finally`.
- [ ] **Step 4: Run the full suite** — `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(client): per-call Last.fm request policy with budget, deadline and concurrency cap"`

### Task 3: Tag lookup and candidate cache plumbing

**Files:**
- Modify: `src/clients/lastfm.ts` (`getTagTopArtists`, `LastfmTagTopArtistsResponse`)
- Modify: `src/clients/cachedLastfm.ts` (`getTagTopArtists`, `getRecommendationCandidates`; delete `getMusicRecommendations`)
- Modify: `src/utils/cache.ts` (`tagTopArtists` type 7 days; `userRecommendations` TTL 1 hour in both `DEFAULT_CACHE_CONFIG` and `createLastfmCache`; `getOrFetch` option `shouldCache?: (value: T) => boolean`; `CacheKeys.tagTopArtists`, `CacheKeys.recommendationCandidates`)
- Test: `test/utils/cache.test.ts`, `test/clients/cachedLastfm.test.ts`, `test/clients/lastfm.test.ts`

**Interfaces:**
- Produces:
  - `LastfmClient.getTagTopArtists(tag: string, limit = 500): Promise<LastfmTagTopArtistsResponse>` (`method: 'tag.getTopArtists'`; response `{ topartists: { artist: Array<LastfmArtist & { '@attr'?: { rank: string } }> } }`).
  - `CachedLastfmClient.getTagTopArtists(tag: string, limit = 500)`.
  - `CacheKeys.tagTopArtists(tag, limit) => \`${encodeURIComponent(tag.trim().toLowerCase())}:${limit}\``.
  - `CacheKeys.recommendationCandidates(username, genre?) => \`v2:${username}:${genre ? encodeURIComponent(genre.trim().toLowerCase()) : 'all'}\``.
  - `CachedLastfmClient.getRecommendationCandidates(username: string, genre: string | undefined, build: () => Promise<CandidateList>): Promise<CandidateList>` — `getOrFetch('userRecommendations', …, build, { shouldCache: (list) => !list.partial })`. (`CandidateList` is defined in Task 4; import the type.)

- [ ] **Step 1: Write failing tests**
  - `cache.test.ts`: `CacheKeys.recommendationCandidates('u', 'Post Rock') === CacheKeys.recommendationCandidates('u', ' post rock ')`; key starts with `v2:`; `getOrFetch(…, { shouldCache: () => false })` returns the value and makes no `put`; the `userRecommendations` TTL is `3600` in both configs; replace the old `userRecommendations` key test.
  - `cachedLastfm.test.ts`: two `getTagTopArtists('Shoegaze')` / `('shoegaze')` calls → raw client called once. `getRecommendationCandidates` with a `build` returning `{ partial: true, … }` → `build` runs again on the next call; with `partial: false` → cached.
  - `lastfm.test.ts`: `getTagTopArtists('shoegaze', 500)` requests `method=tag.getTopArtists&tag=shoegaze&limit=500`.
- [ ] **Step 2: Run, expect failures** — `npx vitest run test/utils/cache.test.ts test/clients` — FAIL.
- [ ] **Step 3: Implement.** Also confirm against the live API (one `curl` with the staging key from `.dev.vars`) the maximum `limit` for `user.getTopArtists` and `tag.getTopArtists`; record the confirmed values as constants in Task 5 (`LIBRARY_PAGE_SIZE`, `TAG_PAGE_SIZE`) and note them in the commit message. Delete `getMusicRecommendations` and its now-unused types; the tool keeps compiling until Task 6 by temporarily returning a `toolError` stub — or do Tasks 3 and 6 removal together if simpler; the build must pass at the end of this task.
- [ ] **Step 4: Run the full suite and build** — `npx vitest run && npm run build` — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(client): tag top artists and a 1-hour recommendation candidate cache"`

### Task 4: Pure scoring

**Files:**
- Create: `src/recommendations/types.ts`, `src/recommendations/scoring.ts`
- Test: `test/recommendations/scoring.test.ts`

**Interfaces:**
- Produces (in `types.ts`):
  - `type Window = '7day' | '1month' | '12month' | 'overall'`
  - `interface SeedRef { name: string; window: Window; rank: number }`
  - `interface Candidate { name: string; score: number; seeds: SeedRef[]; source: 'similar' | 'tag'; tagRank?: number }`
  - `interface CandidateList { candidates: Candidate[]; libraryComplete: boolean; libraryPageSize: number; partial: boolean; genreNotFound: boolean; emptyHistory: boolean }`
- Produces (in `scoring.ts`):
  - `const WINDOW_WEIGHTS: Record<Window, number> = { '7day': 3, '1month': 2, '12month': 1, overall: 0.5 }`
  - `const MAX_FANOUT_SEEDS = 12`
  - `normaliseArtist(name: string): string` — trim, lowercase.
  - `selectSeeds(windows: Partial<Record<Window, string[]>>): SeedRef[]` — dedupe by normalised name keeping the most recent window (best weight) and its rank; order by weight desc then rank asc; at most `MAX_FANOUT_SEEDS`. Overall contributes only its top 10.
  - `rankCandidates(seeds: SeedRef[], similar: Map<string, Array<{ name: string; match: number }>>, library: Set<string>): Candidate[]` — key `similar` by normalised seed name; score = Σ `WINDOW_WEIGHTS[seed.window] × match`; drop normalised names in `library`; sort score desc, then seed count desc, then name asc.
  - `applyGenre(candidates: Candidate[], tagArtists: string[], library: Set<string>, limit: number): Candidate[]` — keep candidates whose normalised name is in `tagArtists`; append tag artists (in tag rank order, not in library, not already present) as `source: 'tag'` with `tagRank` until the list reaches `limit`.
  - `applyExclude(candidates: Candidate[], exclude: string[], limit: number): Candidate[]`.

- [ ] **Step 1: Write failing tests**
  - `it('should weigh recent windows above older ones')`: seed A in `7day` and seed B in `12month` both point to X (match 1) and Y (match 1) respectively → X before Y; X score `3`, Y score `1`.
  - `it('should sum evidence from several seeds')`: X from two seeds outranks Y from one stronger seed when the sum is larger; ties broken by seed count then name.
  - `it('should treat name variants as the same artist')`: library has `'The National'`; candidate `'the national '` is removed; a seed in both `7day` and `12month` appears once, as `7day` with its `7day` rank.
  - `it('should cap fan-out seeds at 12 and use only the top 10 overall')`.
  - `it('should keep only tag artists and top up in tag order')`: limit 3, one surviving similar candidate → two `source: 'tag'` additions with `tagRank` 1 and 2, skipping a library artist.
  - `it('should drop excluded artists case-insensitively and then apply limit')`.
- [ ] **Step 2: Run, expect failure** — `npx vitest run test/recommendations/scoring.test.ts` — FAIL.
- [ ] **Step 3: Implement** to the signatures above.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(recommendations): pure candidate scoring, genre and exclude filters"`

### Task 5: Engine: build candidates and read picks

**Files:**
- Create: `src/recommendations/engine.ts`
- Test: `test/recommendations/engine.test.ts`

**Interfaces:**
- Consumes: Task 2 `runWithRequestPolicy`, `RECOMMENDATION_POLICY`, `RequestBudgetExceeded`, `isRateLimited`; Task 3 client methods; Task 4 scoring.
- Produces:
  - `const LIBRARY_PAGE_SIZE` (confirmed in Task 3, expected 1000), `TAG_PAGE_SIZE` (expected 500), `SEED_LIMITS = { '7day': 10, '1month': 10, '12month': 15 }`, `SIMILAR_LIMIT = 30`, `STARTER_LIMIT = 10`.
  - `interface Pick { name: string; seeds: SeedRef[]; source: 'similar' | 'tag'; tagRank?: number; album?: string; tracks: string[] }`
  - `interface RecommendationResult { username: string; genre?: string; picks: Pick[]; partial: boolean; genreNotFound: boolean; emptyHistory: boolean; libraryComplete: boolean; libraryPageSize: number }`
  - `findRecommendations(client: CachedLastfmClient, username: string, options: { limit: number; genre?: string; exclude: string[] }): Promise<RecommendationResult>` — runs the whole call under one `runWithRequestPolicy` built from `RECOMMENDATION_POLICY` (deadline = now + `timeoutMs`).

Flow inside `findRecommendations`:
1. `client.getRecommendationCandidates(username, genre, build)` where `build`:
   - fetches the four windows concurrently; if all fail, rethrow (the tool returns `toolError`); if all are empty, return `emptyHistory: true`.
   - library = normalised names from all four lists; `libraryComplete` = overall `@attr.total` ≤ `LIBRARY_PAGE_SIZE`.
   - fan-out `getSimilarArtists(seed, SIMILAR_LIMIT)` for `selectSeeds(…)` with `Promise.allSettled`; a `RequestBudgetExceeded` or `isRateLimited` rejection marks `partial: true`; any other rejection (for example error 6) just skips that seed.
   - if `genre`: `getTagTopArtists(genre, TAG_PAGE_SIZE)`; error 6 or an empty list → `genreNotFound: true`; otherwise `applyGenre(…, limit = 15)`.
2. `applyExclude(candidates, exclude, limit)`.
3. For each pick, `getArtistTopAlbums(name, STARTER_LIMIT)` and `getArtistTopTracks(name, STARTER_LIMIT)` via `allSettled`; take the first album and first two tracks; a budget/deadline/rate-limit rejection sets `partial: true` and leaves the pick without starters.

- [ ] **Step 1: Write failing tests** (stub `CachedLastfmClient` with `vi.fn()`s; `getRecommendationCandidates` stub calls `build` directly)
  - `it('should return picks with seeds, one album and two tracks')`.
  - `it('should skip a seed whose similar lookup fails with error 6 and not mark partial')`.
  - `it('should mark partial and keep earlier picks when Last.fm rate-limits mid-way')`: one similar lookup rejects with `Last.fm API error 29` → `partial: true`, picks from the other seeds present.
  - `it('should return picks without starters when the budget runs out')`: starter stubs reject with `RequestBudgetExceeded` → picks present, `tracks: []`, `partial: true`.
  - `it('should report emptyHistory when every window is empty')` and `it('should use whatever windows have data')` (empty `7day`, populated `overall`).
  - `it('should report genreNotFound for an unknown tag')`.
  - `it('should give the same candidates for "Post Rock" and "post rock"')`: both calls pass the same lowercased genre to `getTagTopArtists`.
  - `it('should never pass exclude into the candidate cache')`: assert `getRecommendationCandidates` is called with `(username, genre, fn)` only, and an excluded artist is absent from picks.
- [ ] **Step 2: Run, expect failure** — `npx vitest run test/recommendations/engine.test.ts` — FAIL.
- [ ] **Step 3: Implement** to the interfaces and flow above.
- [ ] **Step 4: Run the full suite** — `npx vitest run` — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(recommendations): engine with cached candidates, starters and partial results"`

### Task 6: Formatter and the rebuilt tool

**Files:**
- Create: `src/recommendations/format.ts`
- Modify: `src/mcp/tools/authenticated.ts:587-640` (the `get_music_recommendations` registration)
- Test: `test/recommendations/format.test.ts`, `test/mcp/tools/recommendations-tool.test.ts`

**Interfaces:**
- Consumes: `findRecommendations`, `RecommendationResult` (Task 5); `buildListenToMoreLine`, `buildNextSteps`.
- Produces: `formatRecommendations(result: RecommendationResult): string`.

Output copy (exact where quoted):
- Heading: `🎯 **New music for ${username}**`, plus ` · ${genre}` when set.
- Per pick, numbered: `**${n}. ${name}**`, then the reason line:
  - `source: 'similar'`: `Similar to ` + up to three seeds as `${seed} (#${rank} ${label})` joined with `, ` and a final ` and `, where labels are `this week` / `this month` / `this year` / `all time`; then `. Not in your top ${libraryPageSize}.`, or `. Not in your library.` when `libraryComplete`.
  - `source: 'tag'`: `One of Last.fm's top artists tagged ${genre} (#${tagRank}). Not in your top ${libraryPageSize}.` (same library rule).
  - `Start with: *${album}* · "${track1}" · "${track2}"` (omit missing parts; omit the line if there are none).
  - `buildListenToMoreLine({ type: 'artist', artist: name })`.
- Partial note, when `partial`: `_Some lookups were skipped to keep this fast, so this list may be shorter or missing starter tracks. Ask again in a minute for the full set._`
- `emptyHistory`: `There isn't enough listening history on this Last.fm account yet to base recommendations on. Scrobble a few days of listening and try again.`
- `genreNotFound`: `Last.fm has no artists tagged "${genre}". Try a broader or differently spelled genre.`
- No picks otherwise: `Everything that matched is already in your library or excluded. Try a genre, or a shorter exclude list.`
- Next steps (`buildNextSteps`): `get_music_recommendations` with `exclude=[…these pick names as JSON…]` — "different picks"; `get_artist_info` with `artist=<first pick>` — "expand the top pick"; `get_similar_artists` with `artist=<first pick>` — "fan out from a pick".

Tool registration:
- Input schema per Global Constraints (`limit: z.coerce.number().int().min(1).max(15).optional().default(8)`, `exclude: z.array(z.string().trim().min(1)).max(50).optional().default([])`).
- Description (exact): `Find new music for the signed-in user: artists they don't already listen to, ranked by how strongly their recent and long-term listening points to them, each with the reason from their own Last.fm data plus a starter album and tracks. Use this for "what should I listen to?", "recommend something", "find me new music" or "like X but new to me", instead of chaining get_similar_artists calls. Optional genre filter; pass exclude with earlier picks to get different ones. REQUIRES AUTHENTICATION`
- Handler: auth check as today → `findRecommendations(client, username || session.username, { limit, genre, exclude })` → text from `formatRecommendations`; catch → `toolError('get_music_recommendations', error)`.

- [ ] **Step 1: Write failing tests**
  - `format.test.ts`: one test per copy case above, asserting the exact reason line `Similar to Slowdive (#2 this week), Mojave 3 (#5 this month) and Cocteau Twins (#14 this year). Not in your top 1000.`; the `tag` line; the partial note; the three empty-state messages (Review Focus 4: picks empty, not partial → the "already in your library or excluded" message); the Next-steps block carries the pick names in `exclude`.
  - `recommendations-tool.test.ts` (stub server pattern from `test/mcp/tools/public-listentomore-link.test.ts`): `limit: 16` is rejected by the schema; defaults are `limit 8`, `exclude []`; no session → text starts with `AUTH_REQUIRED_HEADING`; engine throw → `toolError` text.
- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run` (update `test/mcp/__snapshots__/server.test.ts.snap` with `npx vitest run test/mcp/server.test.ts -u` and check the diff shows only this tool's schema and description) — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tools): rebuild get_music_recommendations on the new engine"`

### Task 7: Get agents to choose it

**Files:**
- Modify: `src/mcp/tools/catalog.ts` (summary), `src/mcp/server.ts` (instructions line), `src/mcp/tools/authenticated.ts` (Next steps in `get_recent_tracks`, `get_top_artists`; existing hints' wording), `src/mcp/tools/public.ts` (Next steps in `get_similar_artists`), `src/mcp/prompts/analysis.ts` (`music_discovery`)
- Test: `test/mcp/server.test.ts` (+ snapshot), `test/pages/*` if the `/llms.txt` test pins tool summaries

**Interfaces:**
- Consumes: the tool name and inputs from Task 6.

Exact copy:
- Catalog summary: `Find new-to-you artists with reasons and starter tracks`.
- Instructions line (replaces `- Personalized picks (auth required): …`): ``- "What should I listen to?" / new music (auth required): `get_music_recommendations` returns new-to-the-user artists with reasons and starter tracks; use it instead of chaining `get_similar_artists`.``
- Next-steps hint, everywhere it appears or is added: `{ tool: 'get_music_recommendations', args: '', hint: 'new-to-you artists based on your listening, with starter tracks' }`. Add it to `get_recent_tracks`, `get_top_artists` and `get_similar_artists`; reword the existing two.
- `music_discovery` prompt: `argsSchema: z.object({ genre: z.string().optional().describe('Optional genre, as a Last.fm tag') })`; message text: `Find new music for me${genre ? ` in ${genre}` : ''}. Call get_music_recommendations${genre ? ` with genre="${genre}"` : ''}. Present each pick with its reason and starter tracks, keeping the reasons grounded in my listening data. If I reject a pick, call the tool again with it in exclude.`

- [ ] **Step 1: Write failing tests**: `server.test.ts` asserts the instructions contain `get_music_recommendations\` returns new-to-the-user artists`, and that the `music_discovery` prompt advertises only `genre`.
- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement**; update the snapshot with `-u` and check the diff only touches these strings.
- [ ] **Step 4: Run** `npx vitest run && npm run lint && npm run format:check && npm run build` — all pass.
- [ ] **Step 5: Commit** `git commit -m "feat: point agents and the music_discovery prompt at get_music_recommendations"`

### Task 8: Release bump and staging check

**Files:**
- Modify: `package.json`, `package-lock.json` (`version` 2.8.0 → 2.9.0, both top-level and `packages[""]`), `src/mcp/protocol.ts` (`SERVER_VERSION = '2.9.0'`)

- [ ] **Step 1:** Bump the three versions by hand (don't run `npm install`; it churns the lockfile's libc fields on this Mac). `git diff package-lock.json` shows only the two version lines.
- [ ] **Step 2:** `npx vitest run && npm run lint && npm run format:check && npm run build` — all pass.
- [ ] **Step 3: Commit** `git commit -m "chore: release 2.9.0"`
- [ ] **Step 4:** Ask Rian before deploying, then `npm run deploy` (staging). From a client connected to staging, call the tool: default; `genre="shoegaze"`; with `exclude` set to the first call's picks; `genre="notarealgenre123"`. Expected: picks with reasons and starters, different picks with `exclude`, the genre-not-found message, and no `toolError`.
- [ ] **Step 5:** Pull `double2` for the staging calls: `SELECT blob1, double2, double1 FROM lastfm_mcp_tool_events_staging WHERE blob1 = 'get_music_recommendations' ORDER BY timestamp DESC LIMIT 10` — cold calls ≤ 40 requests and ≤ ~8000 ms; warm calls far fewer. Report the numbers in the PR body.
