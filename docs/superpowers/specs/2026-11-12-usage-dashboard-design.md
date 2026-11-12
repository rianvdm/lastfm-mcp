# Usage dashboard design

_2026-11-12_

## Intent

Rian runs lastfm-mcp as a public service and can't easily see how it's used: how many people are signed in, which MCP clients they connect from, which tools they call, and whether anything is failing. This project adds a private dashboard at `stats.lastfm-mcp.com` that answers those questions at a glance, behind Cloudflare Access so only Rian can open it. Rian handed the choice of what goes on it to the builder ("make your own calls, we can edit from there"), so v1 is a starting point to react to, not a finished product.

## Goals

- One page that shows current usage and recent trends without running queries by hand.
- Use the data production already has (OAuth KV, Workers analytics) so the page is useful on day one.
- Start recording per-tool usage, which nothing records today.
- Only Rian's personal Google identity can reach it.

## Non-goals

- Alerting or notifications.
- A per-user leaderboard or any view that lists individual Last.fm usernames. Counts only in v1; Rian may ask for more later.
- Public stats, or anything reachable without Access.
- Replacing Workers Observability for debugging single requests.

## Anti-goals

These would make the project a failure even if the page works:

- The instrumentation slows down or breaks MCP requests. Recording a data point must never fail a tool call or add noticeable latency.
- Last.fm usernames, session keys or tool arguments end up in Analytics Engine or the page.
- The dashboard Worker can write to, or corrupt, production OAuth data.
- The dashboard is reachable some way other than through Access (a `workers.dev` URL, a preview URL).

## Current state (checked 2026-11-12)

- Production Worker `lastfm-mcp-prod`, custom domain `lastfm-mcp.com` (zone `7e14ec408e1ef1207cb96373d9da5ee3`, account `db8ef1f4b492e4727e7fab0e12907871`). A merge to `main` deploys it through CI.
- Production `OAUTH_KV` (`8c3a19a93165452b9ab0215bdb3daa71`) held 5,739 keys: 4,706 `client:`, 924 `grant:`, 104 `token:`, 5 `transaction:`. The 924 grants belong to 512 distinct users.
- Grant keys are `grant:<username>:<grantId>`. The key-list metadata carries `clientId` (a registered ID, or a CIMD URL such as `https://claude.ai/oauth/mcp-oauth-client-metadata`), `resource` and `redirectUri`, and the key's `expiration`. Grants expire 30 days after sign-in, so `expiration − 30 days` gives the sign-in time.
- `[observability] enabled = true`. There is no Analytics Engine binding, and nothing records tool names, so per-tool usage has no history.
- The OAuth provider puts `{ username, sessionKey }` into `ctx.props` for `/mcp` requests (`src/index-oauth.ts`, `mcpApiHandler`). It's unconfirmed whether the provider also exposes the client ID there.
- Cloudflare Access: there's no reusable policy for just Rian's personal email. The rule group **Elezea** (`282d056b-0d72-49cf-95b7-a0b0228386a6`) contains only `rianvdm@gmail.com`; the LTM Admin app uses it. The reusable policy "Rian Access" is Rian's work email, so it's the wrong one.

## Decided

### Part 1: instrumentation in the MCP Worker

- Add a Workers Analytics Engine binding to both environments (separate datasets for staging and production, e.g. `lastfm_mcp_events_staging` / `lastfm_mcp_events`).
- Write one data point per MCP tool call, holding at least: the tool name, the client label, the outcome (ok / error / auth-required), the duration in ms, and whether the call was served from cache. **No user identifier of any kind**, not even a hash: Last.fm usernames are public, so a hash can be reversed by hashing a list of names. Distinct-user counts come from OAuth grants instead. _(Rian, 2026-11-12.)_ Use `writeDataPoint`, which doesn't block, and make sure no error from it reaches the tool call.
- Never record tool arguments, usernames in clear text, or session keys.
- This ships as its own PR to `main`, tested on staging first. Merging it is a production deploy.
- **Before that PR merges**, add a line to the "What's stored on the server" list in the lastfm-mcp section of the elezea.com privacy notice (`elezea.com` repo, `src/content/pages/privacy.md`). It says the server records anonymous usage counts (which tool, which AI client, success or failure, timing) with no username, kept about three months. That's a separate PR in that repo, following its own conventions. _(Rian, 2026-11-12.)_

### Part 2: dashboard Worker

- A separate Worker, `lastfm-mcp-stats`, in a `dashboard/` folder of this repo with its own wrangler config. Custom domain `stats.lastfm-mcp.com`, with `workers_dev = false` and preview URLs off.
- CI keeps deploying only the MCP Worker. The dashboard deploys by hand.
- Data sources:
  - Production `OAUTH_KV`, read through the KV REST API with a token scoped to Workers KV Storage Read, **not** a binding. A KV binding can always write, so a binding would leave the no-write anti-goal resting on code review alone. _(Builder-check call.)_
  - Workers GraphQL Analytics for `lastfm-mcp-prod`: requests, errors, CPU/duration, about 30 days back.
  - The Analytics Engine SQL API for the Part 1 dataset.
  - One account API token stored as a Worker secret, with exactly Account Analytics Read and Workers KV Storage Read. It covers GraphQL, Analytics Engine SQL and the KV reads.
- Cache computed results for about 5 minutes, so reloading the page doesn't hammer KV or the analytics APIs.
- The page renders on the server. Make it look decent and work on a phone.

### Part 3: Access

- A self-hosted Access application on `stats.lastfm-mcp.com`, with one allow policy that includes the **Elezea** rule group.
- The Worker also checks the `Cf-Access-Jwt-Assertion` JWT against the team's certs and the application's AUD, and returns 403 without a valid one.

### What the page shows (v1)

1. Headline tiles: users with live grants (roughly monthly active users, since grants last 30 days), sign-ins in the last 7 days, requests and error rate in the last 24 hours, and tool calls in the last 24 hours.
   - Sign-ins are sign-in **events**, not new users. Grants expire 30 days after creation and refreshing doesn't extend them (no `refreshTokenIdleTTL`), so every user signs in again each month, and a new grant revokes that user's earlier grant for the same client. A 30-day count would always equal the live-grant total, so it's left out. Counting first-time users needs history KV doesn't have, so it's out of v1. _(Builder-check call.)_
   - Error rate is uncaught exceptions from GraphQL. Tool failures return 200 and the 401 that starts every sign-in is expected, so tool-level failures come from the Part 1 outcomes and show in the Tools panel. _(Builder-check call.)_
2. Daily chart over 30 days: requests and errors (GraphQL), with sign-ins per day (KV) on a separate chart.
3. Clients: live grants and users per MCP client (Claude.ai, ChatGPT, Cursor, Claude Code, …), labelled from the client's name or CIMD host.
4. Tools: calls per tool, error rate, p50/p95 latency, and cache hit rate, for 24 hours and 7 days. There are no per-tool distinct-user counts, by design.
5. OAuth hygiene: registered clients compared with live grants (4,706 against 924 today). The page should make this gap obvious, because it may point to clients re-registering on every connect.
6. A note saying when per-tool data starts (the Part 1 deploy date), so empty panels aren't mistaken for no usage.

## Left to the builder

- How to hook tool calls. Wrapping `registerTool` inside `createMcpServer` is the obvious place, but any approach that covers every tool works.
- How to tell the cache layer reported a hit for this call.
- How to get the client label at request time: client ID from the provider if it's exposed, otherwise a User-Agent family. Say which one you chose and how accurate it is.
- The Analytics Engine blob/double/index layout and the SQL queries.
- Filtering out pending grants that haven't been exchanged yet (10-minute TTL) from every grant count.
- Labelling the page so it's clear that users still on the old `?session_id=` sign-in path have no grant and so aren't counted. On `main` that path still exists; the unmerged #34 branch removes it.
- How to get client names: fetch `client:<id>` only for the distinct client IDs that appear in live grants, not all 4,706.
- Choice of chart rendering (inline SVG or a pinned CDN library) and visual design.
- Looking up the Access team domain for the JWT check. The Elezea group is in the same account as the Worker, which was confirmed on 2026-11-12.
- Whether the Access app and DNS are created by script, `cf`, or the dashboard. Document the steps either way.
- Test coverage that matches the repo's conventions (Vitest pool workers, `ABOUTME` headers, Prettier settings).
