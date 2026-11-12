<!--
ABOUTME: Runbook for lastfm-mcp-stats, the private usage dashboard Worker served at stats.lastfm-mcp.com.
ABOUTME: Covers what it reads and stores, its bindings and secret, and how to provision, deploy, verify and rotate its token.
-->

# lastfm-mcp-stats

A private usage dashboard for the production MCP Worker (`lastfm-mcp-prod`), served at `stats.lastfm-mcp.com` behind Cloudflare Access. It's a separate Worker with its own `wrangler.toml` in this folder. It's deployed by hand with `npm run dashboard:deploy`, never from CI, and has no `workers.dev` or preview URL.

## What it reads and stores

Everything it reads from production goes through the Cloudflare REST API with one read-only API token. It has no bindings to the MCP Worker's resources.

| Source                                                     | API                            | Used for                                                                                                     |
| ---------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Production `OAUTH_KV` (`8c3a19a93165452b9ab0215bdb3daa71`) | KV REST: list keys, get values | The hourly grant summary: live users and grants, 30-day sign-ins, registered clients, live grants per client |
| Production `OAUTH_KV` access-token keys (`token:`)         | KV REST: list keys only        | Daily, 7-day and 30-day active users. Token values are never read.                                           |
| `events.workersInvocations` for `lastfm-mcp-prod`          | Analytics SQL API (beta)       | Daily requests, errors and client disconnects, and the last 24 hours                                         |
| `lastfm_mcp_tool_events` dataset                           | Analytics Engine SQL API       | Per-tool and per-client calls, error rates, cache hits and latency                                           |

It never writes production `OAUTH_KV`. It writes only its own `DASH_KV`:

- `summary:grants` and `summary:active-users`: the summaries the hourly cron (`17 * * * *`) computes.
- `au:<YYYY-MM-DD>:<hash>`: one empty marker per active user per UTC day, deleted after 31 days. The hash is the first 32 hex characters of HMAC-SHA256 of the user ID, keyed with `ACTIVE_USER_HMAC_KEY`; the user ID itself is never stored. Each run lists the `token:` keys in production `OAUTH_KV`, so anyone whose AI client held a live access token (they last an hour and renew while a client is in use) during that hour's check counts as active that day.
- `gi:<grantId>`, `gp:<grantId>` and `cl:<clientId>`: the grant index, pending-grant markers and memoised client labels that let each run read only grants it hasn't seen. They hold no username, no client URL and no registered client name. Client labels come only from the fixed list in `src/analytics/clientLabel.ts`.
- `cache:traffic:v1` and `cache:tools:v1`: Analytics SQL API and Analytics Engine results, cached for 5 minutes.

Each run reads at most 400 values from production `OAUTH_KV`, grants first. See `MAX_FETCHES_PER_RUN` in `src/grants.ts` for the arithmetic.

## Configuration

Set in `dashboard/wrangler.toml`:

| Name                    | Kind       | Value                                                                                       |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `DASH_KV`               | KV binding | The dashboard's own namespace (step 1 below)                                                |
| `ACCOUNT_ID`            | var        | `db8ef1f4b492e4727e7fab0e12907871`                                                          |
| `OAUTH_KV_NAMESPACE_ID` | var        | The production MCP Worker's `OAUTH_KV` namespace                                            |
| `SCRIPT_NAME`           | var        | `lastfm-mcp-prod`                                                                           |
| `TOOL_EVENTS_DATASET`   | var        | `lastfm_mcp_tool_events`                                                                    |
| `ACCESS_TEAM_DOMAIN`    | var        | `elezea.cloudflareaccess.com`                                                               |
| `ACCESS_AUD`            | var        | The Access application's audience tag (step 2). While it's empty, every request gets a 403. |
| `CF_API_TOKEN`          | secret     | The read-only API token (step 3)                                                            |
| `ACTIVE_USER_HMAC_KEY`  | secret     | At least 32 random characters that key the active-user hashes (step 4)                      |

The Worker verifies the `Cf-Access-Jwt-Assertion` header on every request as well, so a request that reaches it without passing Access gets a 403.

## Provisioning runbook

Every step changes the live account. Run them in order.

1. **Create the KV namespace.**

   ```bash
   npx wrangler kv namespace create lastfm-mcp-stats-DASH_KV
   ```

   Put the returned ID in the `[[kv_namespaces]]` block of `dashboard/wrangler.toml`, replacing the all-zero placeholder.

2. **Create the Access application** before the hostname exists, with `cf` or in the Zero Trust dashboard:

   - Type `self_hosted`, name `lastfm-mcp stats`, domain `stats.lastfm-mcp.com`, session duration `24h`, hidden from the App Launcher.
   - One allow policy that includes the rule group `282d056b-0d72-49cf-95b7-a0b0228386a6`.

   ```bash
   CLOUDFLARE_ACCOUNT_ID=db8ef1f4b492e4727e7fab0e12907871 cf zero-trust access applications create --body '{"type":"self_hosted","name":"lastfm-mcp stats","domain":"stats.lastfm-mcp.com","session_duration":"24h","app_launcher_visible":false,"policies":[{"name":"Rian (Elezea group)","decision":"allow","include":[{"group":{"id":"282d056b-0d72-49cf-95b7-a0b0228386a6"}}]}]}'
   ```

   The application created on 2026-11-12 has ID `f0d19ac3-632a-4cb7-a686-a7aa02bc1564`.

   Put the application's `aud` tag in `ACCESS_AUD` in `dashboard/wrangler.toml`.

3. **Create the API token in the Cloudflare dashboard** (`cf` can't create API tokens). Scope it to account `db8ef1f4b492e4727e7fab0e12907871` with exactly two permissions, **Account Analytics: Read** and **Workers KV Storage: Read**, and nothing else. Account Analytics: Read covers both the Analytics SQL API (traffic) and the Analytics Engine SQL API (tools). Then store it:

   ```bash
   npx wrangler secret put CF_API_TOKEN -c dashboard/wrangler.toml
   ```

4. **Set the active-user HMAC key.** Without it, or with one shorter than 32 characters, active users aren't recorded (each run logs `[STATS] active users not recorded: ACTIVE_USER_HMAC_KEY is missing or too short`) and the page says they're not configured. There's no unkeyed fallback.

   ```bash
   openssl rand -hex 32 | npx wrangler secret put ACTIVE_USER_HMAC_KEY -c dashboard/wrangler.toml
   ```

   Don't keep a copy: nothing needs it except the Worker. Rotating it gives every user a new hash, so for 30 days after a rotation the 7-day and 30-day counts include some users twice. Rotate only if it may have leaked.

5. **Deploy.**

   ```bash
   npm run dashboard:deploy
   ```

   The deploy should attach the custom domain `stats.lastfm-mcp.com` and print no `workers.dev` URL.

6. **Verify.**

   ```bash
   # Access answers first: expect a 302 to elezea.cloudflareaccess.com
   curl -sI https://stats.lastfm-mcp.com/

   # Expect no response from the Worker (workers_dev = false)
   curl -sI https://lastfm-mcp-stats.rian-db8.workers.dev/

   # After the next :17 cron, the summary exists
   npx wrangler kv key get summary:grants --namespace-id 4034b74e455d45d3875248bb761a6d74 --remote
   npx wrangler kv key get summary:active-users --namespace-id 4034b74e455d45d3875248bb761a6d74 --remote
   ```

   Check `liveUsers` against the number of people you expect to be signed in, and `dau` against the number of distinct users in the `token:` key listing (about 100 at a time on 2026-11-12). Run the last command after each hourly cron until `unresolvedGrants` reaches 0. Each run reads at most 400 values, so the first backfill of about 900 grants takes a few runs, and client labels fill in from whatever reads are left. Then open the page on a phone and a laptop and check the requests chart against the Worker's metrics in the Cloudflare dashboard.

The first page load before either summary exists starts both refreshes in the background, so the panels say they're warming up rather than staying empty until the cron.

## Rotating the API token

1. Create a new token with the same account and the same two permissions (step 3).
2. Store it with `npx wrangler secret put CF_API_TOKEN -c dashboard/wrangler.toml`. The new secret takes effect without a redeploy.
3. Load the page and confirm the traffic and tool panels render, then wait for the next :17 cron and confirm `summary:grants` has a new `computedAt`.
4. Delete the old token in the Cloudflare dashboard.

A failed refresh logs `[STATS] grant summary refresh failed (status <code>)` or `[STATS] active user refresh failed (status <code>)` and keeps the previous summary, so a 401 or 403 status there usually means the token is wrong or missing a permission. Check with `npx wrangler tail lastfm-mcp-stats`. If the traffic or tool panel says it couldn't load with `HTTP 403`, check that the token still has **Account Analytics: Read**.

## Development

```bash
npm run dashboard:dev     # Local dev server for this Worker
npm run test:dashboard    # Its tests (dashboard/vitest.config.mts)
npm run dashboard:deploy  # Deploy by hand
```

Local requests carry no Access JWT, so `dashboard:dev` answers every page request with a 403. The tests render the page from fixtures instead.
