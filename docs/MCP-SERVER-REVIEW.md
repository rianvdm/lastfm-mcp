# MCP Server Implementation Review

Reviewed against the Cloudflare MCP server building skill references, `workers-oauth-provider` security docs, and MCP spec best practices.

**Date:** 2026-02-21
**Scope:** Full codebase review of `src/index-oauth.ts` (main entry), `src/auth/`, `src/mcp/`, `src/clients/`, `src/transport/`, `src/protocol/`, `src/utils/`, `src/types/`

---

## Overall Assessment

The server is production-functional and correctly uses `@cloudflare/workers-oauth-provider`, the `@modelcontextprotocol/sdk`, and `agents/mcp` (`createMcpHandler`). The three-tier auth strategy (OAuth 2.0, session-based, unauthenticated) is sound. The caching layer, rate limiting, retry logic, and tool/resource/prompt registrations are well-implemented.

There are several issues that need fixing, detailed below by priority.

---

## P0 - Critical / Security

### 1. Massive code duplication in authenticated tools

**File:** `src/mcp/tools/authenticated.ts`

`registerAuthenticatedTools` (~520 lines, closure-based session) and `registerAuthenticatedToolsWithOAuth` (~500 lines, `getMcpAuthContext()`-based session) are nearly identical. The only difference is how they obtain the user session. This is a maintenance hazard: a bug fix or feature change in one function won't be reflected in the other.

**Fix:** Extract a single `registerAuthenticatedToolsGeneric` that accepts a `getSession: () => AuthSession | null` and optional `getBaseUrl`/`getSessionId` for auth messages. Both registration functions become thin wrappers that provide the appropriate session getter.

### 2. No CSRF protection on manual login flow

**Files:** `src/auth/oauth-handler.ts` (lines 272-392)

The `/login` -> `/callback` manual flow stores `login-pending:${sessionId}` in KV, but this only verifies that _some_ login was initiated—not that the same browser session completed it. The skill reference (`references/oauth-setup.md`) explicitly requires CSRF token validation and state-session binding via secure cookies.

An attacker could trick a user into completing authentication for the attacker's Last.fm account by crafting a malicious redirect.

**Fix:** Generate a CSRF token on `/login`, store it in a `__Host-` prefixed secure cookie, embed the token as part of the state, and validate the cookie against the state on `/callback`.

### 3. No Content Security Policy headers on HTML responses

**Files:** `src/auth/oauth-handler.ts` (lines 356-380), `src/marketing-page.ts`

The login success page and marketing page return raw HTML without CSP headers. The skill reference recommends CSP as defense-in-depth against XSS.

**Fix:** Add a `buildSecurityHeaders` utility that sets `Content-Security-Policy`, `X-Frame-Options: DENY`, and `X-Content-Type-Options: nosniff` on all HTML responses.

### 4. Fragile `resource` parameter mutation in OAuth flow

**Files:** `src/auth/oauth-handler.ts:149`, `src/index-oauth.ts:196-222`

The code uses `(oauthReqInfo as any).resource = undefined` and `stripResourceFromRequest` to work around an audience mismatch between Claude.ai and `workers-oauth-provider`. The `as any` cast bypasses TypeScript safety. If the library changes its internal validation, this silently breaks.

**Fix:** Add proper type assertions with documentation. Consolidate the resource-stripping logic into one location with a clear comment about why it's needed and under what conditions it can be removed.

---

## P1 - Important

### 5. Duplicate route handling between entry point and OAuth handler

**Files:** `src/index-oauth.ts`, `src/auth/oauth-handler.ts`

Both files handle `/.well-known/mcp.json`, `/health`, `/sitemap.xml`, `/robots.txt`, and `/`. The main entry point catches most of these first, so the `defaultHandler` versions rarely fire. But the duplication is confusing and could lead to inconsistent behavior if routing changes.

**Fix:** Remove duplicate route handlers from `oauth-handler.ts` for routes already handled by `index-oauth.ts`. The OAuth handler should only handle `/authorize`, `/lastfm-callback`, `/login`, `/callback`, and `/.well-known/oauth-protected-resource`.

### 6. MCP server created per-request in OAuth apiHandler path

**File:** `src/index-oauth.ts` (lines 154-183)

The `oauthProvider.apiHandler.fetch()` creates a new `McpServer`, dynamically imports tools/resources/prompts, and registers everything on every OAuth-authenticated request. The session-based and unauthenticated paths use the `createMcpServer()` factory.

**Fix:** Use `createMcpServer()` in the OAuth apiHandler as well, adding an OAuth-aware session getter to the context pattern.

### 7. Missing error handling in tool callbacks

**Files:** `src/mcp/tools/public.ts`, `src/mcp/tools/authenticated.ts`

Tool handlers don't wrap Last.fm API calls in try/catch. If the API returns an error (rate limited, invalid response, etc.), the raw error propagates. MCP tools should return user-friendly error content rather than throwing.

**Fix:** Wrap each tool's async handler body in try/catch, returning a friendly error message in the `content` array on failure.

### 8. `ABOUTME:` comments missing from all files

Per `CLAUDE.md`: "All code files should start with a brief 2 line comment explaining what the file does. Each line of the comment should start with the string 'ABOUTME:'". No source files follow this convention.

**Fix:** Add `ABOUTME:` comments to all `src/` files.

### 9. Hardcoded production URLs

**Files:** `src/index.ts:882`, `src/auth/oauth-handler.ts:374`

Production URLs are hardcoded instead of being derived from the request. This breaks in dev/staging environments.

**Fix:** Derive base URLs from `request.url` consistently.

---

## P2 - Low Priority / Future Cleanup

These are noted for future work and will be documented in `todo.md`:

- **Unused dependencies:** `crypto-js` and `oauth-1.0a` in `package.json` appear unused (codebase uses Web Crypto API for MD5).
- **`@types/crypto-js` in dependencies** instead of devDependencies.
- **`MCP_SESSIONS` KV namespace used for 4 concerns:** session data, cache data, pending login state, and pending OAuth state all share one namespace.
- **In-memory `pendingRequests` map in SmartCache:** Request deduplication uses `Map`, which resets per-request in Workers isolates. Only helps within a single request's lifecycle.
- **MCP discovery endpoint content duplicated** in `index-oauth.ts`, `index.ts`, and `oauth-handler.ts` with slightly different content.
- **Tests disabled in CI:** Comment says "temporarily disabled due to vitest/MCP SDK compatibility issue."
- **`src/index.ts` (legacy) is ~900 lines** with mixed concerns (routing, session mgmt, SSE, login, MCP handling).

---

## Implementation Plan

Work will be done on a feature branch. Each fix is tested before moving to the next.

### Phase 1: P0 Fixes (Critical)

1. **Unify authenticated tool registration** - Refactor to single implementation with pluggable session getter
2. **Add CSRF protection to manual login** - Secure cookie + state token validation
3. **Add CSP headers** - Security headers utility for all HTML responses
4. **Clean up resource parameter handling** - Proper types, consolidated logic, clear docs

### Phase 2: P1 Fixes (Important)

5. **Deduplicate route handling** - Remove duplicate routes from oauth-handler.ts
6. **Fix OAuth apiHandler** - Use createMcpServer() factory instead of per-request creation
7. **Add tool error handling** - try/catch wrappers in all tool callbacks
8. **Add ABOUTME comments** - All source files
9. **Fix hardcoded URLs** - Derive from request

### Phase 3: P2 Documentation

10. **Document P2 items** in todo.md for future work

---

## What's Working Well

- OAuth 2.1 integration via `workers-oauth-provider` is correctly implemented
- `createMcpHandler` from `agents/mcp` properly handles MCP transport
- KV-based caching with smart TTLs per data type
- Rate limiting and retry logic with exponential backoff
- Clean separation of public vs authenticated tools
- Resource templates using the MCP SDK
- Prompt templates for common analysis patterns
- Multi-environment wrangler config (dev/production/legacy)
- Proper CORS handling
- Request throttling to respect Last.fm rate limits
