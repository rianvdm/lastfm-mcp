# AGENTS.md

Guidance for coding agents (Claude Code, Codex) working in this repository.

Cloudflare Worker implementing a Model Context Protocol (MCP) server that connects AI assistants to Last.fm listening data. Runs on workerd with a Rate Limiting binding (`REGISTRATION_RATE_LIMITER`) and three KV namespaces: `OAUTH_KV` (OAuth clients, grants and tokens), `MCP_SESSIONS` (the Last.fm response cache; the name predates OAuth) and `MCP_RL` (per-IP rate limits).

## Build / Test / Lint Commands

```bash
npm run dev              # Local dev server (wrangler dev, port 8787)
npm run build            # Dry-run deploy to validate build (wrangler deploy --dry-run)
npm run deploy           # Deploy to staging (the default `lastfm-mcp` Worker)
npm run deploy:prod      # Deploy to production (`lastfm-mcp-prod`); CI normally does this, see below
npm run setup:prod       # Create production KV namespaces and set the three secrets
npm run lint             # ESLint (src/**/*.ts)
npm run format           # Prettier --write
npm run format:check     # Prettier --check (CI)
npm run test:multi-user  # Manual multi-user check against a running server (scripts/test-multi-user.js)
npm run cf-typegen       # Regenerate Worker type bindings (run after changing wrangler.toml; produces worker-configuration.d.ts — generated, do not edit by hand)
```

## Deploys and Releases

**A merge to `main` is a production deploy.** CI (`.github/workflows/ci.yml`) lints, tests and builds every PR and push, then runs `npm run deploy:prod` on each push to `main`. Test risky auth changes on staging (`npm run deploy`) before merging.

To release:

1. In one PR, bump `version` in `package.json` and `package-lock.json` and `SERVER_VERSION` in `src/mcp/protocol.ts`. `server_info`, the server card and `/health` report `SERVER_VERSION`.
2. After it merges, tag that merge commit and create the GitHub release.
3. Publishing a release cross-posts it to elezea.com through `.github/workflows/elezea-release-post.yml`. The endpoint rejects a release whose name isn't `lastfm-mcp vX.Y.Z — <tagline>` or whose body lacks an opening paragraph before its `## What's new` / `## Fixes` / `## Under the hood` sections. To publish on GitHub only, put `<!-- skip-elezea-post -->` in the body. A release runs the workflow file from its tagged commit, so the tag must include the version of the workflow you expect.

### Running Tests

Test runner: **vitest 4** with `@cloudflare/vitest-pool-workers` 0.22 (runs in workerd/miniflare). Requires **Node 22** (see `.nvmrc`); the config uses the `cloudflareTest()` plugin shape, not the removed `defineWorkersConfig`.

**`wrangler` is pinned to the exact version `@cloudflare/vitest-pool-workers` depends on**, so tests, `npm run dev`, and deploys share one wrangler and one workerd. A caret range resolves to the newest wrangler and splits the tree in two again. When bumping vitest-pool-workers, move the pin in the same change:

```bash
npm view @cloudflare/vitest-pool-workers@<new-version> dependencies.wrangler   # the version to pin
npm ls wrangler workerd                                                         # after install: one copy of each
```

```bash
npm test                                    # All tests
npx vitest run                              # All tests, exit when done
npx vitest run test/utils/retry.test.ts     # Single file
npx vitest run -t "should succeed"          # Single test by name (matches against full describe → it path)
npx vitest run test/protocol/               # All tests in a directory
```

## Code Style

### Formatting (Prettier)

- **Tabs** for indentation (not spaces)
- **No semicolons**
- **Single quotes**
- **140-char** print width
- **LF** line endings

### Linting (ESLint)

- `@typescript-eslint/no-unused-vars`: error — prefix unused params/vars with `_`
- `@typescript-eslint/no-explicit-any`: warn — avoid but not blocked
- TypeScript strict mode is enabled

### File Headers

**Every file** (source and test) must have exactly two `// ABOUTME:` comment lines at the top. Line 1 describes WHAT the file is. Line 2 describes its PURPOSE or SCOPE.

```typescript
// ABOUTME: Smart caching utility with TTL-based expiration for Last.fm API responses.
// ABOUTME: Provides optimized cache TTLs per endpoint type and request deduplication.
```

### Imports

1. External/third-party packages first
2. Blank line
3. Relative project imports

```typescript
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import type { Env } from '../types/env'
import { toolError } from './error-handler'
```

- Use `import type` for type-only imports
- No file extensions on relative imports (Wrangler bundles them)
- MCP SDK v2: server code imports from `@modelcontextprotocol/server`, tests use `@modelcontextprotocol/client`; the handler comes from `agents/mcp/server`
- No path aliases — all relative paths

### Naming Conventions

| Thing            | Convention                      | Example                                |
| ---------------- | ------------------------------- | -------------------------------------- |
| Files (source)   | camelCase or kebab-case         | `cachedLastfm.ts`, `oauth-handler.ts`  |
| Files (test)     | Match source + `.test.ts`       | `retry.test.ts`, `index-oauth.test.ts` |
| Directories      | lowercase                       | `auth/`, `mcp/`, `utils/`              |
| Functions        | camelCase                       | `createMcpServer`, `fetchWithRetry`    |
| Classes          | PascalCase                      | `LastfmClient`, `SmartCache`           |
| Interfaces/Types | PascalCase, no prefix           | `Env`, `SessionPayload` (not `IEnv`)   |
| Enums            | PascalCase + PascalCase members | `ErrorCode.ParseError`                 |
| Constants        | UPPER_SNAKE_CASE                | `SERVER_VERSION`, `PROTOCOL_VERSION`   |
| Variables        | camelCase                       | `sessionId`, `cachedClient`            |

### Type Patterns

- Interfaces for data shapes, not classes
- Union types for constrained values: `type Period = '7day' | '1month' | ...`
- Zod schemas for MCP tool input validation
- Domain types co-located with their client (e.g., `LastfmTrack` in `src/clients/lastfm.ts`)
- Shared protocol types in `src/types/`
- Type guards for runtime validation (e.g., `isJSONRPCRequest()`)

### Error Handling

Three patterns used at different layers:

1. **HTTP handlers** — try/catch, log with `console.error`, return `Response` with status code
2. **MCP tools** — try/catch, return `toolError('tool_name', error)` from `src/mcp/tools/error-handler.ts`
3. **Non-critical systems** — fail open (e.g., rate limiter returns `{ allowed: true }` if KV is down)

Always use `error instanceof Error ? error.message : 'Unknown error'` when stringifying caught errors.

## Test Conventions

Tests live in `test/` mirroring the `src/` structure. Use `describe`/`it` (not `test`).

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('Feature', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('subfeature', () => {
		it('should do the expected thing', async () => {
			expect(result).toBe(expected)
		})
	})
})
```

- Mock with `vi.fn()`, `.mockResolvedValue()`, `.mockRejectedValue()`
- Mock fetch: `globalThis.fetch = vi.fn()`
- Timer control: `vi.useFakeTimers()` / `vi.useRealTimers()` / `vi.advanceTimersByTimeAsync()`
- Worker integration tests use `import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'`
- OAuth flow helpers live in `test/helpers/` (`oauth-flow.ts`, `cimd-fetch.ts`); captured 0.10.3 KV records for the upgrade-survival test are in `test/fixtures/`

## Architecture Overview

```
src/
  index-oauth.ts        # Sole Worker entry point: static routes, per-IP rate limits, per-origin OAuth provider
  marketing-page.ts     # Landing page HTML (served at /)
  auth/                 # OAuth handler (consent, Last.fm sign-in, callback), consent page, /mcp resource rewrite
  clients/              # Last.fm API client + caching decorator
  mcp/                  # MCP SDK server, tools (public + authenticated), prompts, resources
  types/                # Shared types: Env
  utils/                # Cache, rate limiting, retry, https redirect, security, date formatting, mood mapping, breadcrumbs
```

Single Worker entry point configured in `wrangler.toml`: `main = "src/index-oauth.ts"`. The `[env.production]` block points to the same entry — it only renames the deployed Worker.

Every MCP request needs an OAuth bearer token: unauthenticated `POST /mcp` returns 401 with `WWW-Authenticate`, which starts the client's sign-in. OAuth is the only sign-in path: the manual `/login` → `?session_id=` flow was removed in #34, so Last.fm session keys are only stored inside encrypted grant `props`. The "public" tools in `src/mcp/tools/public.ts` are the ones that don't need the user's Last.fm session, not tools reachable without sign-in. `src/auth/jwt.ts` is no longer imported by any source file.

**Key dependencies:** `@modelcontextprotocol/server` (MCP SDK v2), `@cloudflare/workers-oauth-provider` 1.x, `agents` (Cloudflare Agents SDK), `zod`.

## OAuth Notes

- `getOAuthProvider(origin)` builds one provider per request origin (custom domain, workers.dev, localhost) and is called with a per-request copy of `env`. The provider stores its helpers on `env.OAUTH_PROVIDER` only when unset, so a shared `env` would serve the first origin's helpers to every later origin.
- `src/auth/resource-indicator.ts` rewrites exactly `resource=<origin>/mcp` to the origin on `/authorize` and `/oauth/token`. 1.x answers any other path with `invalid_target`, which clients don't recover from. Upstream request: [cloudflare/workers-oauth-provider#430](https://github.com/cloudflare/workers-oauth-provider/issues/430).
- Plain-http requests to non-loopback hosts get a 308 to https before they reach the provider, which throws on an http resource outside loopback.
- `/authorize` shows the consent page (`src/auth/consent-page.ts`) before redirecting to Last.fm. `CONSENT_SECRET` signs the cookie that remembers an approval for a year; when it's missing or shorter than 32 characters, approvals aren't remembered and sign-in still works.
- Errors on `/authorize` render on this origin and are never redirected to the client's `redirect_uri`: registration is open, so redirecting would make the server an open redirector.
- Two per-IP budgets, both failing open: `/mcp` gets 60 requests a minute from a KV counter in `MCP_RL` (`src/utils/rateLimit.ts`), and `POST /oauth/register` gets 5 a minute from the `REGISTRATION_RATE_LIMITER` Rate Limiting binding (`src/utils/registrationRateLimit.ts`). The binding's limit and period live in `wrangler.toml`, once per environment; its counts are approximate and per Cloudflare location, and they hold up under bursts where a KV counter doesn't.
- Grants expire 30 days after sign-in (the library's refresh-token default), so a `grant_not_found` or `invalid_grant` after about a month is expected.
