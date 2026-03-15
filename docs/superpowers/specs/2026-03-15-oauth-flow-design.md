# OAuth Flow Fix: Design Spec

**Date:** 2026-03-15
**Status:** Approved

---

## Problem

All MCP clients (Claude Code, Claude Desktop, opencode) receive a copy-paste URL (`/login?session_id=...`) when they need to authenticate, instead of having the browser open automatically.

The correct MCP OAuth 2.1 behavior:
1. Client sends unauthenticated `POST /mcp`
2. Server returns `401 WWW-Authenticate: Bearer resource_metadata="https://host/.well-known/oauth-protected-resource"`
3. Client fetches `/.well-known/oauth-protected-resource`, then `/.well-known/oauth-authorization-server`
4. Client opens browser to `/authorize`
5. User authorizes on Last.fm → `completeAuthorization()` runs → token issued to client
6. Client retries with bearer token — no copy/paste required

---

## Confirmed Root Cause

In `src/index-oauth.ts` lines 371–375, there is an explicit short-circuit:

```typescript
if (!hasOAuthToken) {
    // No OAuth token - handle as unauthenticated MCP request
    return handleUnauthenticatedMcp(request, env, ctx)
}
```

When a request arrives at `/mcp` with no bearer token and no `session_id` query param, this sends it to `handleUnauthenticatedMcp()` instead of the OAuth provider. The OAuth provider never runs, never returns `401`, and clients never see the `WWW-Authenticate` header that would trigger their browser flow.

`handleUnauthenticatedMcp()` creates an MCP server with `session: null`. In `server.ts` line 78, when no `authMessages` option is passed, it defaults to `buildSessionAuthMessages()`:

```typescript
const authMessages = options?.authMessages ?? buildSessionAuthMessages(getBaseUrl, getSessionId)
```

This generates the `/login?session_id=...` copy-paste URL that all clients are currently seeing.

**Secondary issue:** `handleUnauthenticatedMcp()` also performs a valuable KV lookup for existing sessions via `Mcp-Session-Id` header — for clients that previously authenticated via manual login. This behavior must be preserved.

---

## Goals

- All supported clients (Claude Code, Claude Desktop, opencode) trigger an automatic browser open for first-time authentication
- No copy-paste `/login?session_id=...` URLs shown for clients that support MCP OAuth
- Clients with existing sessions (via `Mcp-Session-Id` header + KV) continue to work without re-authenticating
- Legacy `session_id` query param path continues to work unchanged
- Comprehensive automated tests that lock in the fix and prevent regression

## Non-Goals

- Rebuilding the OAuth layer from scratch
- Changing the manual login / session-based auth path (`/login`, `/callback`, `session_id` param)
- Supporting new MCP clients beyond the three listed

---

## Architecture

No structural changes. The existing OAuth infrastructure is correct. We are fixing the request routing in `index-oauth.ts`.

### Fixed Request Routing Logic

**Current (broken):**
```
POST /mcp
  ├─ has session_id param → handleSessionBasedMcp()
  ├─ has no bearer token → handleUnauthenticatedMcp()  ← THE BUG
  └─ has bearer token → oauthProvider.fetch()
```

**Fixed:**
```
POST /mcp
  ├─ has session_id param → handleSessionBasedMcp()
  ├─ has Mcp-Session-Id header + valid KV session → handleSessionBasedMcp()  ← preserve existing sessions
  └─ everything else → oauthProvider.fetch()
       ├─ valid bearer token → authenticated MCP handler
       └─ no/invalid bearer token → 401 + WWW-Authenticate  ← triggers browser flow
```

The `WWW-Authenticate` header injection at lines 390–398 already exists and is correct:
```typescript
newHeaders.set('WWW-Authenticate', `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`)
```

### Files Changed

| File | Change |
|------|--------|
| `src/index-oauth.ts` | Remove the `if (!hasOAuthToken)` branch; add `Mcp-Session-Id` + KV lookup before falling through to OAuth provider |
| `src/mcp/server.ts` | Verify `buildSessionAuthMessages` is not the default when called from the OAuth path (it won't be once the routing is fixed) |

### Files Explicitly Out of Scope

| File | Reason |
|------|--------|
| `src/index.ts` | Legacy session path — do not touch |
| `src/auth/jwt.ts` | Working correctly |
| `src/auth/lastfm.ts` | Working correctly |
| `src/auth/oauth-handler.ts` | Working correctly — authorize, callback, protected resource metadata all correct |
| `/.well-known/oauth-authorization-server` | Served by `@cloudflare/workers-oauth-provider` automatically — verify contents in tests but no code change expected |

---

## Implementation Steps

### Step 1: Fix routing in `index-oauth.ts`

Replace the `if (!hasOAuthToken)` short-circuit with a `Mcp-Session-Id` header lookup:

```typescript
// Check if this is an MCP request
if (url.pathname === '/mcp') {
    const sessionId = url.searchParams.get('session_id')

    if (sessionId) {
        // Explicit session_id param → session-based auth
        return handleSessionBasedMcp(request, env, ctx, sessionId)
    }

    // Check for existing session via Mcp-Session-Id header (clients from previous manual login)
    const mcpSessionId = request.headers.get('Mcp-Session-Id')
    if (mcpSessionId) {
        const sessionDataStr = await env.MCP_SESSIONS.get(`session:${mcpSessionId}`)
        if (sessionDataStr) {
            return handleSessionBasedMcp(request, env, ctx, mcpSessionId)
        }
    }

    // No valid session → fall through to OAuth provider
    // - Valid bearer token: OAuth provider authenticates and serves MCP
    // - No bearer token: OAuth provider returns 401 + WWW-Authenticate (triggers browser flow)
}
```

### Step 2: Verify `/.well-known/oauth-authorization-server`

Fetch the live endpoint and confirm it contains all MCP-required fields. This is auto-generated by `@cloudflare/workers-oauth-provider` — expected to be correct, but must be verified. Required fields:
- `issuer`
- `authorization_endpoint`
- `token_endpoint`
- `response_types_supported` (must include `"code"`)
- `grant_types_supported` (must include `"authorization_code"`)
- `code_challenge_methods_supported` (must include `"S256"`)

### Step 3: Write tests (see Testing section)

Write tests before verifying the fix works end-to-end.

---

## Testing

Testing is a first-class requirement. This fix has been attempted before and failed. Tests must prove the fix works.

### Unit Tests — `test/oauth-flow.spec.ts` (new file)

**1. Unauthenticated request returns 401**
- `POST /mcp` with no `Authorization` header and no `session_id` param
- Assert: response status is `401`
- Assert: `WWW-Authenticate` header is present
- Assert: header value is `Bearer resource_metadata="https://host/.well-known/oauth-protected-resource"`
- Assert: response body does NOT contain `/login?session_id=`

**2. Protected resource metadata is correct**
- `GET /.well-known/oauth-protected-resource`
- Assert: status `200`
- Assert: `resource` field equals base URL (no path)
- Assert: `authorization_servers` includes base URL
- Assert: `bearer_methods_supported` includes `"header"`

**3. Authorization server metadata is correct**
- `GET /.well-known/oauth-authorization-server`
- Assert: status `200`
- Assert: all required MCP fields present: `issuer`, `authorization_endpoint`, `token_endpoint`, `response_types_supported` (includes `"code"`), `grant_types_supported` (includes `"authorization_code"`), `code_challenge_methods_supported` (includes `"S256"`)

**4. Session_id param path still works**
- `POST /mcp?session_id=known-session` with valid KV session
- Assert: status `200`, not `401`
- Assert: `Mcp-Session-Id` header in response

**5. Mcp-Session-Id header path still works**
- `POST /mcp` with `Mcp-Session-Id: known-session` header and valid KV session
- Assert: status `200`, not `401`

**6. Mcp-Session-Id header with unknown session falls through to 401**
- `POST /mcp` with `Mcp-Session-Id: unknown-session` header (not in KV)
- Assert: status `401` with `WWW-Authenticate` header

**7. Valid bearer token is accepted**
- `POST /mcp` with `Authorization: Bearer valid-token`
- Assert: reaches MCP handler (status `200`)
- Assert: no copy-paste URL in response body

**8. Tool responses in OAuth path never contain session-based URL**
- Simulate `get_recent_tracks` tool call with valid OAuth bearer token but no Last.fm session props
- Assert: response does not contain `/login?session_id=`

### Integration Test — Full OAuth Round-Trip

Simulate what a conforming MCP client does:

1. `POST /mcp` (no auth) → assert `401` + `WWW-Authenticate`
2. `GET /.well-known/oauth-protected-resource` → assert valid JSON with `authorization_servers`
3. `GET /.well-known/oauth-authorization-server` → assert valid metadata
4. `GET /authorize?client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256&response_type=code` → assert redirect to Last.fm auth URL
5. Simulate Last.fm callback: `GET /lastfm-callback?token=mock-token&state=stored-state` (mock Last.fm `auth.getSession` API)
6. Assert: `completeAuthorization()` is called, redirect issued to client redirect_uri
7. Client exchanges code: `POST /oauth/token` with code → assert token response with `access_token`
8. `POST /mcp` with `Authorization: Bearer <access_token>` → assert `200` with MCP capabilities

### Regression Tests

- `POST /mcp` with no auth returns `401` — not `200` with a `/login?session_id=...` string in the body
- `POST /mcp?session_id=valid` with valid KV session returns `200`
- `GET /login` still works and redirects to Last.fm

---

## Deployment

No feature flags needed — this is a routing fix, not a new feature.

**Verification in staging:**
1. Run `npm run dev` locally
2. Use MCP Inspector (`npx @modelcontextprotocol/inspector`) to connect to `http://localhost:8787/mcp`
3. Confirm MCP Inspector shows OAuth prompt and opens browser, not a copy-paste URL
4. Complete the flow and confirm authenticated tools work

**Rollback:** Reverting this change restores the previous behavior (copy-paste URLs). The session-based path and manual login path are unchanged, so rollback has no collateral damage.

---

## Success Criteria

1. All automated tests pass
2. `POST /mcp` with no auth returns `401` with correct `WWW-Authenticate` header (verified by test)
3. Full OAuth round-trip integration test passes (verified by test)
4. Manual verification: connecting MCP Inspector to `/mcp` triggers OAuth browser open, not a copy-paste URL
5. Manual verification: existing session via `session_id` param or `Mcp-Session-Id` header continues to work
6. No tool response in the OAuth path contains `/login?session_id=`
