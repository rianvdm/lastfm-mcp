# Usage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private dashboard at `stats.lastfm-mcp.com`, behind Cloudflare Access, showing lastfm-mcp sign-ins, clients, traffic and per-tool usage, fed partly by new anonymous tool-call events.

**Architecture:** The MCP Worker writes one Workers Analytics Engine data point per tool call (no user identifier). A separate `lastfm-mcp-stats` Worker in `dashboard/` builds an hourly grant summary from production `OAUTH_KV`, which it reads over the KV REST API with a read-only token, and stores the summary in its own KV namespace. On each page view it queries GraphQL and Analytics Engine SQL (cached 5 minutes) and renders one server-side HTML page. Access sits in front, and the Worker also verifies the Access JWT.

**Tech Stack:** TypeScript on Cloudflare Workers (workerd), Wrangler 4 (pinned in this repo), Vitest 4 + `@cloudflare/vitest-pool-workers` 0.22, Node 22, `jose` 6.x for JWT verification, Workers Analytics Engine, Cloudflare GraphQL Analytics API.

**Spec:** `docs/superpowers/specs/2026-11-12-usage-dashboard-design.md`

## Global Constraints

- Every source and test file opens with exactly two `// ABOUTME:` lines (repo AGENTS.md).
- Prettier: tabs, no semicolons, single quotes, 140-char width. ESLint with no unused vars; prefix unused ones with `_`.
- Relative imports without file extensions; `import type` for type-only imports; no path aliases.
- Tool-call events carry **no user identifier of any kind** (no username, no hash), no tool arguments, no session keys.
- Recording an event must never fail a tool call or delay its response: write inside `ctx.waitUntil`, catch everything.
- The dashboard never writes production `OAUTH_KV`. It reads it only through the KV REST API with a token scoped to Account Analytics Read + Workers KV Storage Read.
- The dashboard is reachable only through Access: `workers_dev = false`, `preview_urls = false`, and the Worker fails closed (403) without a valid Access JWT, including when `ACCESS_AUD` is unset.
- The Access app uses the existing rule group **Elezea** (`282d056b-0d72-49cf-95b7-a0b0228386a6`). Team domain: `elezea.cloudflareaccess.com`.
- IDs: account `db8ef1f4b492e4727e7fab0e12907871`; prod `OAUTH_KV` `8c3a19a93165452b9ab0215bdb3daa71`; prod script `lastfm-mcp-prod`; zone `lastfm-mcp.com`.
- Analytics Engine datasets: `lastfm_mcp_tool_events` (production), `lastfm_mcp_tool_events_staging` (default env). Binding name `TOOL_EVENTS`.
- A merge to `main` is a production deploy of the MCP Worker. The dashboard deploys only by hand.
- Do not merge PR A (Tasks 2–4) until the elezea.com privacy PR (Task 1) is live.

## Review Focus

1. **Attacker-controlled client names.** Client registration is open, so a DCR `clientName` can be `<script>…`. Every label must be HTML-escaped on the page (test in Task 8), and labels are trimmed and capped at 40 characters (Task 2).
2. **Analytics failure during a tool call.** A missing binding, a throwing `writeDataPoint`, or a failing client-name lookup must leave the tool result byte-identical (tests in Tasks 3 and 4).
3. **One upstream API failing.** GraphQL 403/429, Analytics Engine SQL errors, or a missing grant summary must render that panel as "couldn't load: <reason>" while the other panels still render (test in Task 8).
4. **Access edge cases.** A missing JWT, a malformed one, an expired one, one with a different AUD, or an unset `ACCESS_AUD` → 403 (tests in Task 5).
5. **No tool data yet.** Before the first event, or for a tool with zero cache lookups, the page shows "no data yet" or "—", never `NaN`, `Infinity` or `undefined` (test in Task 8).

---

## PR 0 — elezea.com privacy notice (separate repo)

### Task 1: Privacy notice line

**Files:**
- Modify: `/Users/rian/git/elezea.com/src/content/pages/privacy.md` (the "What's stored on the server" list under `## Last.fm MCP Server`)

- [ ] **Step 1:** Read `/Users/rian/git/elezea.com/AGENTS.md` (or `CLAUDE.md`), check status/branch, pull `main` with `--ff-only`, and create branch `privacy/lastfm-mcp-usage-counts`.
- [ ] **Step 2:** Add this bullet after the "request counter" bullet. Rian approves the wording before the PR:

```markdown
- **Anonymous usage counts**: which tool was called, which AI app called it, whether it worked, and how long it took. These records don't include your username or anything you asked for, and they're kept for about three months.
```

- [ ] **Step 3:** Run that repo's build/check command (from its AGENTS.md); expect success.
- [ ] **Step 4:** Commit, push, open the PR with a problem → outcome body, and stop for Rian to merge and deploy. Record the PR URL in the PR A body.

## PR A — instrumentation in the MCP Worker (branch `feat/usage-dashboard`)

### Task 2: Event schema, client labels, binding

**Files:**
- Create: `src/analytics/clientLabel.ts`, `src/analytics/toolEvents.ts`
- Modify: `wrangler.toml` (add `[[analytics_engine_datasets]]` for the default env and `[[env.production.analytics_engine_datasets]]`), `src/types/env.ts` (add `TOOL_EVENTS?: AnalyticsEngineDataset`)
- Test: `test/analytics/clientLabel.test.ts`, `test/analytics/toolEvents.test.ts`

**Interfaces:**
- Produces:
  - `labelForClient(clientId: string | undefined, clientName?: string): string`
  - `type ToolOutcome = 'ok' | 'error' | 'auth_required'`
  - `type CacheOutcome = 'hit' | 'miss' | 'none'`
  - `interface ToolCallEvent { tool: string; outcome: ToolOutcome; cache: CacheOutcome; durationMs: number }`
  - `toDataPoint(event: ToolCallEvent, clientLabel: string, serverVersion: string): AnalyticsEngineDataPoint`
  - Layout (the dashboard's SQL depends on it): `indexes: [tool]`, `blobs: [tool, clientLabel, outcome, cache, serverVersion]` (blob1..blob5), `doubles: [durationMs]` (double1).

- [ ] **Step 1: Write failing tests.** `labelForClient`:
  - `'https://claude.ai/oauth/mcp-oauth-client-metadata'` → `'Claude'`
  - `'https://claude.ai/oauth/claude-code-client-metadata'` → `'Claude Code'`
  - `'https://chatgpt.com/oauth/client.json'` → `'ChatGPT'`
  - `'https://chatgpt.com/oauth/codex/client.json'` → `'Codex'`
  - `'https://opencode.ai/oauth/opencode/client.json'` → `'OpenCode'`
  - `'https://sesameai.app/api/oauth/external-mcp/client.json'` → `'sesameai.app'` (any other URL → hostname)
  - `('KcJrP3y-PHlwIp3v', '  oh-my-pi  ')` → `'oh-my-pi'`; whitespace runs collapse to one space; a 60-character name → its first 40 characters
  - `('abc', undefined)` and `(undefined)` → `'unknown'`

  `toDataPoint({ tool: 'get_top_artists', outcome: 'ok', cache: 'hit', durationMs: 12.5 }, 'Claude', '2.8.0')` deep-equals `{ indexes: ['get_top_artists'], blobs: ['get_top_artists', 'Claude', 'ok', 'hit', '2.8.0'], doubles: [12.5] }`.
- [ ] **Step 2:** Run `npx vitest run test/analytics/`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement both modules. Known CIMD URLs go in one exported `KNOWN_CLIENT_LABELS` map. Add the dataset blocks to `wrangler.toml` and run `npm run cf-typegen`.
- [ ] **Step 4:** Run `npx vitest run test/analytics/`. Expected: PASS. Run `npm run build`. Expected: dry-run succeeds and lists the `TOOL_EVENTS` binding.
- [ ] **Step 5:** Commit `feat(analytics): tool-call event schema and client labels`.

### Task 3: Per-request cache tally and tool-call instrumentation

**Files:**
- Modify: `src/utils/cache.ts` (`SmartCache` and `createLastfmCache` accept an optional `CacheTally`; `getOrFetch` increments `hits` on a cached or deduplicated return and `misses` before `fetchAndCache`), `src/clients/cachedLastfm.ts` (constructor `(client, kv?, tally?)`), `src/mcp/tools/error-handler.ts` (export `isToolErrorText(toolName: string, text: string): boolean`, matching the existing `Error in ${toolName}: ` prefix), `src/mcp/tools/authenticated.ts` (export `AUTH_REQUIRED_HEADING = '🔐 **Authentication Required**'` and use it in both `requiresAuth` builders), `src/mcp/server.ts`
- Create: `src/mcp/instrumentation.ts`
- Test: `test/mcp/instrumentation.test.ts`, plus additions to `test/utils/cache.test.ts`

**Interfaces:**
- Consumes: `ToolCallEvent`, `ToolOutcome`, `CacheOutcome` (Task 2)
- Produces:
  - `interface CacheTally { hits: number; misses: number }`
  - `instrumentTools(server: McpServer, tally: CacheTally, onToolCall: (event: ToolCallEvent) => void): void`. It wraps `server.registerTool` so every tool registered afterwards is timed and classified.
  - `createMcpServer(env, baseUrl, options?: { authMessages?: AuthMessageConfig; onToolCall?: (event: ToolCallEvent) => void })`. When `onToolCall` is set, it calls `instrumentTools` before any tool is registered and passes the same tally to `CachedLastfmClient`.

Classification: a throw → `'error'`, rethrown unchanged. Result `isError === true`, or first text block matching `isToolErrorText` → `'error'`. First text block starting with `AUTH_REQUIRED_HEADING` → `'auth_required'`. Anything else → `'ok'`. Cache: misses grew → `'miss'`; else hits grew → `'hit'`; else `'none'`. Duration comes from `performance.now()` around the callback. `onToolCall` exceptions are caught and logged, never propagated.

- [ ] **Step 1: Write failing tests** with a real `McpServer` and the SDK client test helpers already used in `test/mcp/`:
  - A tool returning normal text emits `{ tool, outcome: 'ok', cache: 'none' }` with `durationMs >= 0`.
  - A tool returning `toolError('x', new Error('boom'))` emits `'error'`.
  - A tool returning the OAuth `requiresAuth()` text emits `'auth_required'`.
  - A throwing tool emits `'error'`, and the client sees the same failure as without instrumentation.
  - `onToolCall` that throws: the tool result is deep-equal to the uninstrumented result (Review Focus 2).
  - Cache: a fake fetcher called through `getOrFetch` twice on one tally gives `{ hits: 1, misses: 1 }`, and the tool sees `'miss'` then `'hit'`.
- [ ] **Step 2:** Run `npx vitest run test/mcp/instrumentation.test.ts test/utils/cache.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep `registerTool`'s generic signature intact for callers.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all PASS, including the existing `test/mcp/__snapshots__`.
- [ ] **Step 5:** Commit `feat(mcp): time and classify every tool call`.

### Task 4: Wire events into the OAuth API handler, then verify on staging

**Files:**
- Create: `src/analytics/recordToolEvent.ts`
- Modify: `src/index-oauth.ts` (`mcpApiHandler`), `AGENTS.md` (binding list in the intro, plus one Architecture line for `src/analytics/`)
- Test: `test/analytics/recordToolEvent.test.ts`, plus one integration case in `test/index-oauth.test.ts` or `test/oauth-roundtrip.test.ts`

**Interfaces:**
- Consumes: `labelForClient`, `toDataPoint` (Task 2); `createMcpServer({ onToolCall })` (Task 3)
- Produces: `recordToolEvent(env: Env, clientId: string | undefined, event: ToolCallEvent): Promise<void>`. It never rejects. It resolves the label as follows: a URL client ID goes through `labelForClient` with no KV read; otherwise it reads `env.OAUTH_KV.get('client:' + clientId, 'json')` for `clientName`, memoised in a module-level `Map` capped at 500 entries. It then calls `env.TOOL_EVENTS?.writeDataPoint(toDataPoint(event, label, SERVER_VERSION))`.

The handler reads `clientId` from `(ctx as { auth?: { clientId?: string } }).auth?.clientId`; `workers-oauth-provider` 1.2.4 sets `ctx.auth.clientId` next to `ctx.props`. It passes `onToolCall: (e) => ctx.waitUntil(recordToolEvent(env, clientId, e))`.

- [ ] **Step 1: Write failing tests:**
  - With a fake `TOOL_EVENTS` (`{ writeDataPoint: vi.fn() }`), a DCR client whose stored `clientName` is `'Claude'` → `writeDataPoint` is called once with blob2 `'Claude'`.
  - A second call for the same client ID makes no second KV read.
  - `TOOL_EVENTS` undefined → resolves, no throw.
  - `writeDataPoint` throws → resolves, no throw.
  - KV `get` rejects → label `'unknown'`, the point is still written.
  - Integration: an OAuth round-trip `tools/call` of `ping` writes exactly one point with blob1 `'ping'` and blob3 `'ok'`, and no blob contains the test username.
- [ ] **Step 2:** Run the new tests. Expected: FAIL.
- [ ] **Step 3:** Implement and update `AGENTS.md`.
- [ ] **Step 4:** Run `npm run lint && npm run format:check && npx vitest run && npm run build`. Expected: all pass.
- [ ] **Step 5:** Commit `feat(analytics): record anonymous tool-call events`.
- [ ] **Step 6: Staging check.**
  - Run `npm run deploy` (staging).
  - Connect an MCP client to the staging `workers.dev` URL and call two tools.
  - Within about 5 minutes, `SELECT blob1, blob2, blob3, blob4, double1 FROM lastfm_mcp_tool_events_staging ORDER BY timestamp DESC LIMIT 10` against `POST /accounts/{id}/analytics_engine/sql` returns those calls.
  - Paste the rows (they carry no usernames) into the PR body.
- [ ] **Step 7:** Push and open PR A. The body links the Task 1 PR and states "merge after the privacy notice is live; merging deploys to production". Stop for Rian's merge.

## PR B — dashboard Worker (branch `feat/usage-dashboard-worker`, from `main` after PR A merges)

### Task 5: Dashboard scaffold and Access JWT gate

**Files:**
- Create: `dashboard/wrangler.toml`, `dashboard/tsconfig.json` (extends the root), `dashboard/vitest.config.mts`, `dashboard/src/index.ts`, `dashboard/src/env.ts`, `dashboard/src/access.ts`
- Modify: `package.json` (add `jose` as an exact-pinned dependency at the version already in the lockfile, `6.2.10`; add scripts `dashboard:dev` = `wrangler dev -c dashboard/wrangler.toml`, `dashboard:deploy` = `wrangler deploy -c dashboard/wrangler.toml`, `test:dashboard` = `vitest run --config dashboard/vitest.config.mts`; change `lint` to `eslint src dashboard/src --ext .ts,.tsx`), `vitest.config.mts` (exclude `dashboard/**`), `.github/workflows/ci.yml` (add a `npx vitest run --config dashboard/vitest.config.mts` step after "Run tests"; the deploy job is unchanged)
- Test: `dashboard/test/access.test.ts`

`dashboard/wrangler.toml`:
- `name = "lastfm-mcp-stats"`, `main = "src/index.ts"`, the same `compatibility_date` and flags as the root, `workers_dev = false`, `preview_urls = false`.
- `routes = [{ pattern = "stats.lastfm-mcp.com", custom_domain = true }]`.
- `[triggers] crons = ["17 * * * *"]`. That's hourly at :17, not :00, per the top-of-hour herding note.
- One KV binding `DASH_KV`. The namespace is created in Task 9; until then, use a placeholder ID, which tests override.
- `[vars]`: `ACCOUNT_ID`, `OAUTH_KV_NAMESPACE_ID = "8c3a19a93165452b9ab0215bdb3daa71"`, `SCRIPT_NAME = "lastfm-mcp-prod"`, `TOOL_EVENTS_DATASET = "lastfm_mcp_tool_events"`, `ACCESS_TEAM_DOMAIN = "elezea.cloudflareaccess.com"`, `ACCESS_AUD = ""`.
- Secret, documented in a comment: `CF_API_TOKEN`.

**Interfaces:**
- Produces:
  - `interface DashEnv { DASH_KV: KVNamespace; CF_API_TOKEN: string; ACCOUNT_ID: string; OAUTH_KV_NAMESPACE_ID: string; SCRIPT_NAME: string; TOOL_EVENTS_DATASET: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string }`
  - `requireAccess(request: Request, env: DashEnv): Promise<Response | null>`. It returns `null` when `Cf-Access-Jwt-Assertion` verifies with `jose.jwtVerify` against `createRemoteJWKSet(https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs)`, `issuer: https://${ACCESS_TEAM_DOMAIN}` and `audience: ACCESS_AUD`. Otherwise it returns a plain `403`. Keep the JWKS memoised per isolate.
  - The default export has `fetch` (gate first, then `GET /` renders; any other path → 404) and `scheduled`, which calls Task 7's `refreshGrantSummary`.

- [ ] **Step 1: Write failing tests.** Generate an RS256 key pair with `jose.generateKeyPair`, and serve its JWK at the certs URL through a mocked `globalThis.fetch`. Cases:
  - No header → 403.
  - Garbage token → 403.
  - Expired → 403.
  - Wrong AUD → 403.
  - Wrong issuer → 403.
  - `ACCESS_AUD = ''` → 403 even with a token signed for `''`.
  - A valid token → `null`.
  - `fetch` on `GET /nope` with a valid token → 404.
- [ ] **Step 2:** Run `npm run test:dashboard`. Expected: FAIL.
- [ ] **Step 3:** Implement. `GET /` can return a stub page in this task.
- [ ] **Step 4:** Run `npm run test:dashboard && npx vitest run && npm run lint`. Expected: PASS. Run `npx wrangler deploy -c dashboard/wrangler.toml --dry-run --outdir dashboard/dist`. Expected: success. Add `dashboard/dist` to `.gitignore`.
- [ ] **Step 5:** Commit `feat(dashboard): scaffold stats Worker behind an Access JWT gate`.

### Task 6: Cloudflare API client

**Files:**
- Create: `dashboard/src/cfApi.ts`
- Test: `dashboard/test/cfApi.test.ts`

**Interfaces:**
- Produces:
  - `listKvKeys(env: DashEnv, prefix: string): Promise<Array<{ name: string; expiration?: number }>>`. It follows `result_info.cursor` with `limit=1000` until the cursor is empty.
  - `getKvJson<T>(env: DashEnv, key: string): Promise<T | null>`. A 404 → `null`; keys are URL-encoded, since client IDs can be URLs.
  - `graphql<T>(env: DashEnv, query: string, variables: Record<string, unknown>): Promise<T>`. It throws on a non-empty `errors`.
  - `analyticsSql<T>(env: DashEnv, sql: string): Promise<T[]>`. It POSTs the raw SQL with `FORMAT JSON` and returns `data`.
  - Every call sends `Authorization: Bearer ${CF_API_TOKEN}`. It retries 429/5xx twice with 1 s and then 3 s backoff, and throws `CfApiError` with `status` and a short message after that.

- [ ] **Step 1: Write failing tests** with mocked `fetch`:
  - Pagination across two cursors returns all keys.
  - A `client:https://…` key is URL-encoded in the path.
  - 404 → `null`.
  - 429, 429, 200 → resolves (use fake timers).
  - 403 three times → `CfApiError` with status 403.
  - A GraphQL `errors` array → throws.
- [ ] **Step 2:** Run `npm run test:dashboard`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test:dashboard`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(dashboard): Cloudflare REST, GraphQL and Analytics Engine client`.

### Task 7: Hourly grant summary

**Files:**
- Create: `dashboard/src/grants.ts`
- Test: `dashboard/test/grants.test.ts`

Background, checked 2026-11-12: KV-list metadata is unreliable. 584 of 924 production grants were written by the 0.x provider and have no metadata, and 533 have no KV expiration. So the summary reads each grant's **value** (`clientId`, `createdAt`, `expiresAt`, `authCodeId`, `refreshTokenId`) once and memoises it.

**Interfaces:**
- Consumes: `listKvKeys`, `getKvJson` (Task 6); `labelForClient` from `../../src/analytics/clientLabel` (Task 2)
- Produces:
  - `interface GrantSummary { computedAt: string; liveGrants: number; liveUsers: number; noExpiryGrants: number; pendingGrants: number; unresolvedGrants: number; registeredClients: number; signInsLast7d: number; signInsByDay: Array<{ date: string; count: number }>; clients: Array<{ label: string; grants: number; users: number }> }`. `signInsByDay` covers the last 30 UTC days, oldest first, with zero-filled days. `clients` is sorted by `users` descending.
  - `refreshGrantSummary(env: DashEnv, now?: Date): Promise<GrantSummary>`. It writes `summary:grants` to `DASH_KV`.
  - `readGrantSummary(env: DashEnv): Promise<GrantSummary | null>`

Rules:
- Split each key `grant:<userId>:<grantId>` on the **last** `:`.
- Index entries live at `gi:<grantId>` as `{ clientId?: string; createdAt: number; expiresAt?: number }`, with KV `expiration` = `expiresAt + 86400`, or no expiration when `expiresAt` is absent. **No username** goes in `DASH_KV`; distinct users are counted in memory from the listed keys.
- A grant whose value has `authCodeId` and no `refreshTokenId` is pending. It is never indexed, is re-checked each run, and is counted only in `pendingGrants`.
- Live means not pending and (`expiresAt > now` or `expiresAt` absent). Absent ones also count in `noExpiryGrants`.
- A sign-in is a live or expired grant's `createdAt`.
- Client labels are memoised at `cl:<clientId>`: URL IDs go through `labelForClient` directly; others read `client:<id>` for `clientName`.
- `registeredClients` is the number of keys listed with prefix `client:`.
- At most `MAX_FETCHES_PER_RUN = 500` value reads (grants plus clients) per run. Grants past the cap count in `unresolvedGrants` and are picked up next run.

- [ ] **Step 1: Write failing tests** with an in-memory fake for `cfApi`. Fixture: 3 users, one with two grants from different clients, one legacy grant with no `expiresAt`, one pending grant, one expired grant, one DCR client named `'Claude'` and one CIMD ChatGPT client. Assert:
  - `liveUsers`, `liveGrants`, `noExpiryGrants`, `pendingGrants`.
  - `signInsByDay` has length 30, sums correctly, and places the sign-ins on their days.
  - `clients` labels and counts are correct.
  - A second run reads no grant values that are already indexed.
  - With `MAX_FETCHES_PER_RUN` exceeded, `unresolvedGrants > 0`, and the next run resolves them.
  - No `DASH_KV` key or value contains any fixture username.
- [ ] **Step 2:** Run `npm run test:dashboard`. Expected: FAIL.
- [ ] **Step 3:** Implement. Make the cap injectable for the test.
- [ ] **Step 4:** Run `npm run test:dashboard`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(dashboard): hourly grant summary from OAuth KV`.

### Task 8: Traffic and tool queries, page rendering

**Files:**
- Create: `dashboard/src/traffic.ts`, `dashboard/src/tools.ts`, `dashboard/src/page.ts`, `dashboard/src/cached.ts`
- Modify: `dashboard/src/index.ts` (`GET /` builds the model and renders it; if `summary:grants` is missing, it renders a "warming up" note and kicks `refreshGrantSummary` through `ctx.waitUntil`)
- Test: `dashboard/test/traffic.test.ts`, `dashboard/test/tools.test.ts`, `dashboard/test/page.test.ts`

Load the `dataviz` skill before writing chart code. Charts are inline SVG with no client-side JS. The page uses colour tokens on `:root` with a dark-mode override and works at 375 px wide.

**Interfaces:**
- Consumes: `graphql`, `analyticsSql` (Task 6); `readGrantSummary`, `GrantSummary` (Task 7)
- Produces:
  - `cachedJson<T>(env: DashEnv, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T>`. It uses `DASH_KV` with `expirationTtl`; TTL 300 for traffic and tools.
  - `interface TrafficSummary { days: Array<{ date: string; requests: number; errors: number; disconnected: number }>; last24h: { requests: number; errors: number } }` and `fetchTraffic(env: DashEnv, now?: Date): Promise<TrafficSummary>`.
    - The query uses `workersInvocationsAdaptive` filtered on `scriptName` with dimensions `date` and `status`, summing `requests` and `errors`. This shape was verified 2026-11-12, returning about 45k requests a day split into `success` and `clientDisconnected`.
    - `disconnected` is the `clientDisconnected` request count.
    - `last24h` is a second filter on `datetime_geq` in the same GraphQL request, so it costs one API call.
  - `interface ToolRow { tool: string; calls: number; errors: number; authRequired: number; p50Ms: number | null; p95Ms: number | null; cacheHitRate: number | null }` and `interface ToolStats { firstEventAt: string | null; last24h: ToolRow[]; last7d: ToolRow[]; clients7d: Array<{ label: string; calls: number }> }`, plus `fetchToolStats(env: DashEnv): Promise<ToolStats>`.
    - Weight counts with `SUM(_sample_interval)`.
    - Latency uses `quantileWeighted` on `double1`. If the SQL API rejects it, fall back to `quantileExactWeighted`, and note which one works in a code comment.
    - `cacheHitRate` = hits / (hits + misses), and `null` when both are 0.
  - `interface DashboardModel { generatedAt: string; grants: GrantSummary | { error: string } | null; traffic: TrafficSummary | { error: string }; tools: ToolStats | { error: string } }` and `renderDashboard(model: DashboardModel): string`.
    - The three loads run with `Promise.allSettled`. A rejected load becomes `{ error }` with the `CfApiError` message (Review Focus 3).

Page sections, in this order (spec "What the page shows"):
1. Tiles: users with live grants, sign-ins in the last 7 days, requests in the last 24 hours, error rate in the last 24 hours, tool calls in the last 24 hours.
2. 30-day requests/errors chart.
3. 30-day sign-ins chart.
4. Clients table: grants and users from the grant summary, plus tool calls over 7 days.
5. Tools table: 24 h / 7 d toggle via two `<details>` blocks, no JS. Columns: calls, error %, auth-required, p50, p95, cache hit %.
6. OAuth hygiene: registered clients compared with live grants, plus pending, no-expiry and unresolved counts.
7. Footer notes:
   - "Tool tracking started <firstEventAt>", or "no tool events yet".
   - "Error rate counts uncaught exceptions; tool failures are in the Tools table."
   - "Users on the legacy `?session_id=` sign-in have no grant and aren't counted."
   - The `generatedAt` / `computedAt` timestamps.

- [ ] **Step 1: Write failing tests:**
  - `fetchTraffic` maps a canned GraphQL response to 30 zero-filled days and correct `last24h`.
  - `fetchToolStats` maps canned SQL rows. An empty SQL result → `firstEventAt: null` and empty arrays.
  - `renderDashboard` with a client label `'<script>alert(1)</script>'` → the HTML contains `&lt;script&gt;` and no `<script>alert` (Review Focus 1).
  - Model with `tools: { error: 'CfApiError 403' }` → the HTML contains `couldn't load` and still shows the grant tiles (Review Focus 3).
  - Model with empty tool stats and a zero-lookup row → the HTML contains none of `NaN`, `Infinity`, `undefined` (Review Focus 5).
  - `grants: null` → the HTML contains `warming up`.
- [ ] **Step 2:** Run `npm run test:dashboard`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test:dashboard && npm run lint && npm run format:check`. Expected: PASS. Render `renderDashboard` with a realistic fixture to a file under the session scratchpad and screenshot it at 1280 and 375 px with headless Chrome (CDP device emulation for 375; `--window-size` clamps at 500). Fix anything broken.
- [ ] **Step 5:** Commit `feat(dashboard): traffic, tool stats and page`.

### Task 9: Provision, protect, deploy, verify

**Files:**
- Modify: `dashboard/wrangler.toml` (real `DASH_KV` ID, `ACCESS_AUD`), `README.md` or a new `dashboard/README.md` (a runbook of the steps below, so it can be redone)

Everything in this task changes the live account. Show Rian each command before running it.

- [ ] **Step 1:** `npx wrangler kv namespace create lastfm-mcp-stats-DASH_KV`. Put the ID in `dashboard/wrangler.toml`.
- [ ] **Step 2: Create the Access app** before the hostname exists. Use `cf zero-trust access applications create` (or the dashboard if `cf` can't express it):
  - Type `self_hosted`, name `lastfm-mcp stats`, domain `stats.lastfm-mcp.com`, session duration `24h`.
  - One allow policy that includes rule group `282d056b-0d72-49cf-95b7-a0b0228386a6`.
  - Put the returned `aud` in `ACCESS_AUD`.
- [ ] **Step 3: Get the API token from Rian.** `cf` can't create API tokens, so Rian creates one in the dashboard: account `db8ef1f4…`, permissions **Account Analytics: Read** and **Workers KV Storage: Read**, nothing else. Collect it with `request_secret` (`delivery: "file"`), then run `npx wrangler secret put CF_API_TOKEN -c dashboard/wrangler.toml < "$file"`.
- [ ] **Step 4:** `npm run dashboard:deploy`. Expected: deploy succeeds, the custom domain `stats.lastfm-mcp.com` is attached, and no `workers.dev` URL is printed.
- [ ] **Step 5: Verify:**
  - `curl -sI https://stats.lastfm-mcp.com/` → a 302 to `elezea.cloudflareaccess.com`.
  - `curl -sI https://lastfm-mcp-stats.<subdomain>.workers.dev/` → not served.
  - After the next :17 cron, `npx wrangler kv key get summary:grants --namespace-id <DASH_KV id> --remote` returns JSON with `liveUsers` around 500. Run it a second time an hour later and confirm `unresolvedGrants` is 0.
  - Rian opens the page on his phone and laptop and confirms the numbers look plausible: about 500 users, and requests matching GraphQL.
- [ ] **Step 6:** Commit the runbook and IDs. Push, open PR B (merging only changes CI and docs; the dashboard is already deployed by hand), and stop for Rian's review.
