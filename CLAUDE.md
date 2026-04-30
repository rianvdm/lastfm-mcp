# AGENTS.md — lastfm-mcp

Cloudflare Worker implementing a Model Context Protocol (MCP) server that connects AI assistants to Last.fm listening data. Runs on workerd with KV-backed persistence for sessions, caching, rate limits, and logs.

## Build / Test / Lint Commands

```bash
npm run dev              # Local dev server (wrangler dev, port 8787)
npm run build            # Dry-run deploy to validate build (wrangler deploy --dry-run)
npm run deploy           # Deploy to staging
npm run deploy:prod      # Deploy to production
npm run lint             # ESLint (src/**/*.ts)
npm run format           # Prettier --write
npm run format:check     # Prettier --check (CI)
npm run cf-typegen       # Regenerate Worker type bindings (run after changing wrangler.toml)
```

### Running Tests

Test runner: **vitest** with `@cloudflare/vitest-pool-workers` (runs in workerd/miniflare).

```bash
npm test                                    # All tests
npx vitest run                              # All tests, exit when done
npx vitest run test/utils/retry.test.ts     # Single file
npx vitest run -t "should succeed"          # Single test by name
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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { Env } from '../types/env'
import { toolError } from './error-handler'
```

- Use `import type` for type-only imports
- No file extensions on relative imports (Wrangler bundles them)
- Exception: MCP SDK uses `.js` extensions (`@modelcontextprotocol/sdk/server/mcp.js`)
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

Four patterns used at different layers:

1. **HTTP handlers** — try/catch, log with `console.error`, return `Response` with status code
2. **MCP tools** — try/catch, return `toolError('tool_name', error)` from `src/mcp/tools/error-handler.ts`
3. **Protocol layer** — `mapErrorToJSONRPC()` maps error messages to JSON-RPC error codes
4. **Non-critical systems** — fail open (e.g., rate limiter returns `{ allowed: true }` if KV is down)

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
- Test stubs for ajv in `test/stubs/` (workerd can't run ajv CJS modules)

## Architecture Overview

```
src/
  index-oauth.ts        # Primary entry point (OAuth 2.1 + session hybrid auth)
  index.ts              # Legacy entry point (session-only auth)
  marketing-page.ts     # Landing page HTML (served at /)
  auth/                 # JWT, Last.fm auth flow, OAuth 2.1 handler
  clients/              # Last.fm API client + caching decorator
  mcp/                  # MCP SDK server, tools (public + authenticated), prompts, resources
  protocol/             # Legacy hand-rolled JSON-RPC handlers (backward compat)
  transport/            # Deprecated SSE transport
  types/                # Shared types: Env, JSON-RPC, MCP protocol, Last.fm catalogs
  utils/                # Cache, rate limiting, retry, logging, security, mood mapping
```

Two entry points configured in `wrangler.toml`: default uses `index-oauth.ts` (production), `env.legacy` uses `index.ts`.

**Key dependencies:** `@modelcontextprotocol/sdk`, `@cloudflare/workers-oauth-provider`, `agents` (Cloudflare Agents SDK), `zod`.
