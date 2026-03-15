# OAuth Flow Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix unauthenticated `/mcp` requests to return `401 + WWW-Authenticate` instead of routing through `handleUnauthenticatedMcp()`, so MCP clients (Claude Code, Claude Desktop, opencode) automatically open the browser for OAuth instead of showing a copy-paste URL.

**Architecture:** Remove the `if (!hasOAuthToken)` short-circuit in `src/index-oauth.ts` that bypasses the OAuth provider for unauthenticated requests. Add a `Mcp-Session-Id` header + KV lookup before falling through to the OAuth provider, preserving existing manual-login sessions. All other unauthenticated requests fall through to the OAuth provider which returns the correct `401`. Also add `Access-Control-Expose-Headers: Mcp-Session-Id` to `handleSessionBasedMcp` which currently omits it.

**Tech Stack:** Cloudflare Workers, `@cloudflare/workers-oauth-provider`, Vitest with `@cloudflare/vitest-pool-workers`, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-15-oauth-flow-design.md`

**Note on test file names:** The spec names the test file `test/oauth-flow.spec.ts`. This plan uses `test/index-oauth.test.ts` (existing file, extended) and `test/oauth-discovery.test.ts` (new) and `test/oauth-roundtrip.test.ts` (new) to match the existing naming convention in the project. The spec is the source of truth for *what* to test; this plan is the source of truth for *where*.

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `src/index-oauth.ts` | Modify | (1) Add `Access-Control-Expose-Headers` to `handleSessionBasedMcp`; (2) Replace the `/mcp` routing block — remove `if (!hasOAuthToken)` branch and delete `handleUnauthenticatedMcp` function; (3) Add `Mcp-Session-Id` header + KV lookup before falling through to OAuth provider |
| `test/index-oauth.test.ts` | Modify | Add ABOUTME header; replace unauthenticated-200 tests with correct 401 tests; add Mcp-Session-Id header tests and regression tests; preserve Access-Control-Expose-Headers coverage |
| `test/oauth-discovery.test.ts` | Create | Tests for `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` metadata |
| `test/oauth-roundtrip.test.ts` | Create | Full OAuth round-trip integration test (register client → authorize → callback → exchange code → use token); covers spec test case 7 (valid bearer token → 200) |

**Do not touch:**
- `src/index.ts` — legacy session path, out of scope
- `src/auth/oauth-handler.ts` — working correctly
- `src/auth/lastfm.ts` — working correctly
- `src/auth/jwt.ts` — working correctly
- `src/mcp/server.ts` — no changes needed once routing is fixed

---

## Chunk 1: Update and Extend Tests (TDD First)

Write all tests before touching implementation. Verify failing tests fail for the right reason before moving to Chunk 2.

---

### Task 0: Add ABOUTME header to test/index-oauth.test.ts

CLAUDE.md requires all code files to start with a 2-line `ABOUTME:` comment. The existing file uses a JSDoc block instead.

**Files:**
- Modify: `test/index-oauth.test.ts`

- [ ] **Step 1: Replace the JSDoc header at line 1**

Find:
```typescript
/**
 * Tests for the OAuth entry point (src/index-oauth.ts)
 *
 * Tests unauthenticated MCP access, session-based auth, and OAuth routing.
 */
```

Replace with:
```typescript
// ABOUTME: Tests for the OAuth entry point (src/index-oauth.ts).
// ABOUTME: Covers unauthenticated 401 routing, session-based auth, OAuth routing, and regression for copy-paste URL bug.
```

- [ ] **Step 2: Verify the file still compiles**

Run: `npx vitest run test/index-oauth.test.ts --reporter=verbose 2>&1 | tail -5`

Expected: Same test results as before (no import/parse errors).

---

### Task 1: Replace the broken unauthenticated-200 tests in test/index-oauth.test.ts

The existing `'/mcp endpoint - unauthenticated access'` describe block (lines 11–104) contains **three tests that assert status 200 for unauthenticated requests** — this is the broken behavior we are fixing. All three must be replaced.

The three tests being removed:
1. "should handle initialize request without authentication" — asserts 200 (wrong after fix)
2. "should preserve existing session ID from header" — sends `Mcp-Session-Id` that is NOT in KV, asserts 200 (wrong after fix; this is an unknown session and must fall through to 401)
3. "should expose Mcp-Session-Id in Access-Control-Expose-Headers" — asserts 200 for unauthenticated (wrong after fix)

**Files:**
- Modify: `test/index-oauth.test.ts`

- [ ] **Step 1: Replace the entire `'/mcp endpoint - unauthenticated access'` describe block**

Find the block starting at line 11 (`describe('/mcp endpoint - unauthenticated access', () => {`) through line 104 (its closing `})`). Replace the entire block with:

```typescript
describe('/mcp endpoint - unauthenticated access', () => {
  const initBody = JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'TestClient', version: '1.0.0' },
    },
    id: 1,
  })
  const mcpHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }

  it('should return 401 when no auth is provided', async () => {
    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      body: initBody,
      headers: mcpHeaders,
    })

    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(401)
  })

  it('should include WWW-Authenticate header pointing to OAuth metadata', async () => {
    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      body: initBody,
      headers: mcpHeaders,
    })

    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(401)
    const wwwAuth = response.headers.get('WWW-Authenticate')
    expect(wwwAuth).not.toBeNull()
    expect(wwwAuth).toContain('Bearer')
    expect(wwwAuth).toContain('resource_metadata')
    expect(wwwAuth).toContain('/.well-known/oauth-protected-resource')
  })

  it('should return 401 when Mcp-Session-Id header has no matching KV session', async () => {
    // An unknown Mcp-Session-Id (not in KV) must fall through to OAuth → 401.
    // The old behavior returned 200 by routing all requests through handleUnauthenticatedMcp.
    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      body: initBody,
      headers: { ...mcpHeaders, 'Mcp-Session-Id': 'unknown-session-not-in-kv' },
    })

    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(401)
    const wwwAuth = response.headers.get('WWW-Authenticate')
    expect(wwwAuth).toContain('Bearer')
  })

  it('should not include a /login?session_id= URL in the response body', async () => {
    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      body: initBody,
      headers: mcpHeaders,
    })

    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)

    const body = await response.clone().text()
    expect(body).not.toContain('/login?session_id=')
  })
})
```

- [ ] **Step 2: Run to verify the replaced tests now fail**

Run: `npx vitest run test/index-oauth.test.ts --reporter=verbose 2>&1`

Expected: The 4 tests in the replaced block FAIL (implementation not changed yet). The session-based auth, OAuth, and static endpoint tests should still PASS.

---

### Task 2: Add Mcp-Session-Id header + Access-Control-Expose-Headers tests

**Files:**
- Modify: `test/index-oauth.test.ts`

- [ ] **Step 1: Add a new describe block after the existing `'/mcp endpoint - session-based auth'` block**

```typescript
describe('/mcp endpoint - Mcp-Session-Id header routing', () => {
  const initBody = JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'TestClient', version: '1.0.0' },
    },
    id: 1,
  })

  it('should use session-based auth when Mcp-Session-Id header has a valid KV session', async () => {
    const sessionId = 'test-mcp-header-valid-session'
    await env.MCP_SESSIONS.put(
      `session:${sessionId}`,
      JSON.stringify({
        userId: 'testuser',
        sessionKey: 'test-session-key',
        username: 'testuser',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        sessionId,
      }),
    )

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      body: initBody,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Session-Id': sessionId,
      },
    })

    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    expect(response.headers.get('Mcp-Session-Id')).toBe(sessionId)
  })

  it('should expose Mcp-Session-Id in Access-Control-Expose-Headers for session-based responses', async () => {
    const sessionId = 'test-mcp-header-expose-session'
    await env.MCP_SESSIONS.put(
      `session:${sessionId}`,
      JSON.stringify({
        userId: 'testuser',
        sessionKey: 'test-session-key',
        username: 'testuser',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        sessionId,
      }),
    )

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      body: initBody,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Session-Id': sessionId,
      },
    })

    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('Mcp-Session-Id')
  })

  it('should return 401 when Mcp-Session-Id header session is expired', async () => {
    // handleSessionBasedMcp checks expiresAt and returns 401 with error: 'session_expired'
    const sessionId = 'test-mcp-header-expired-session'
    await env.MCP_SESSIONS.put(
      `session:${sessionId}`,
      JSON.stringify({
        userId: 'testuser',
        sessionKey: 'test-session-key',
        username: 'testuser',
        timestamp: Date.now() - 40 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 10 * 24 * 60 * 60 * 1000, // expired 10 days ago
        sessionId,
      }),
    )

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      body: initBody,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Session-Id': sessionId,
      },
    })

    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)

    // Expired session → handleSessionBasedMcp returns 401 with session_expired error
    // (This is existing behavior in handleSessionBasedMcp lines 52–63, not changed by the fix)
    expect(response.status).toBe(401)
    const result = (await response.json()) as { error: string }
    expect(result.error).toBe('session_expired')
  })
})
```

- [ ] **Step 2: Run to verify new tests fail (not yet implemented)**

Run: `npx vitest run test/index-oauth.test.ts --reporter=verbose 2>&1`

Expected:
- "should use session-based auth when Mcp-Session-Id header has a valid KV session" — **check the result carefully**. The current `handleUnauthenticatedMcp()` code does look up `session:{mcpSessionId}` in KV and returns 200 if found. This test may already PASS before the fix. Note whether it passes or fails — do not skip this step.
- "should expose Mcp-Session-Id in Access-Control-Expose-Headers for session-based responses" — likely FAILS because `handleSessionBasedMcp` does not yet add `Access-Control-Expose-Headers`.
- "should return 401 when Mcp-Session-Id header session is expired" — may PASS (expired sessions already handled in `handleSessionBasedMcp`).

---

### Task 3: Add session_id param valid-session test and bearer token test

These are spec test cases 4 and 7, which were missing from the original plan.

**Files:**
- Modify: `test/index-oauth.test.ts`

- [ ] **Step 1: Add a test inside the existing `'/mcp endpoint - session-based auth'` describe block**

After the existing test "should return 401 when session_id does not exist in KV", add:

```typescript
it('should return 200 when session_id param has a valid KV session', async () => {
  const sessionId = 'test-session-id-param-valid'
  await env.MCP_SESSIONS.put(
    `session:${sessionId}`,
    JSON.stringify({
      userId: 'testuser',
      sessionKey: 'test-session-key',
      username: 'testuser',
      timestamp: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      sessionId,
    }),
  )

  const request = new Request(`http://example.com/mcp?session_id=${sessionId}`, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'TestClient', version: '1.0.0' },
      },
      id: 1,
    }),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
  })

  const ctx = createExecutionContext()
  const response = await worker.fetch(request, env, ctx)
  await waitOnExecutionContext(ctx)

  expect(response.status).toBe(200)
  expect(response.headers.get('Mcp-Session-Id')).toBe(sessionId)
})
```

- [ ] **Step 2: Add a bearer token test inside the existing `'/mcp endpoint - OAuth auth'` describe block**

After the existing "should include WWW-Authenticate header for 401 responses" test, add:

```typescript
it('should not return a /login?session_id= URL in OAuth path tool responses', async () => {
  // Even with a valid bearer token but no Last.fm session props,
  // the OAuth path must never fall back to session-based auth messages.
  // Note: this test uses an invalid token (401 expected), not a valid one.
  // The key assertion is that the body never contains the copy-paste URL.
  const request = new Request('http://example.com/mcp', {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_recent_tracks', arguments: {} },
      id: 1,
    }),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer invalid-token',
    },
  })

  const ctx = createExecutionContext()
  const response = await worker.fetch(request, env, ctx)
  await waitOnExecutionContext(ctx)

  const body = await response.clone().text()
  expect(body).not.toContain('/login?session_id=')
})
```

- [ ] **Step 3: Run tests to see current state**

Run: `npx vitest run test/index-oauth.test.ts --reporter=verbose 2>&1`

Note which tests pass and fail. The "session_id valid KV" test should PASS (that path already works). The bearer token body test should PASS (OAuth provider 401 response doesn't contain a login URL).

---

### Task 4: Create OAuth discovery endpoint tests

**Files:**
- Create: `test/oauth-discovery.test.ts`

- [ ] **Step 1: Create the file**

```typescript
// ABOUTME: Tests for OAuth discovery endpoints required by the MCP OAuth 2.1 spec.
// ABOUTME: Verifies /.well-known/oauth-protected-resource and /.well-known/oauth-authorization-server return correct metadata.
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import worker from '../src/index-oauth'

describe('OAuth Discovery Endpoints', () => {
  describe('/.well-known/oauth-protected-resource', () => {
    it('should return 200 with JSON content type', async () => {
      const request = new Request('http://example.com/.well-known/oauth-protected-resource')
      const ctx = createExecutionContext()
      const response = await worker.fetch(request, env, ctx)
      await waitOnExecutionContext(ctx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('application/json')
    })

    it('should include required resource metadata fields', async () => {
      const request = new Request('http://example.com/.well-known/oauth-protected-resource')
      const ctx = createExecutionContext()
      const response = await worker.fetch(request, env, ctx)
      await waitOnExecutionContext(ctx)

      const data = (await response.json()) as Record<string, unknown>

      // resource must be the base URL only (no /mcp path) for audience validation
      expect(data.resource).toBe('http://example.com')
      expect((data.authorization_servers as string[]).includes('http://example.com')).toBe(true)
      expect((data.bearer_methods_supported as string[]).includes('header')).toBe(true)
    })

    it('should not include /mcp path in resource field', async () => {
      // workers-oauth-provider validates audience against base URL only.
      // Including /mcp would cause token audience mismatch errors on every request.
      const request = new Request('http://example.com/.well-known/oauth-protected-resource')
      const ctx = createExecutionContext()
      const response = await worker.fetch(request, env, ctx)
      await waitOnExecutionContext(ctx)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.resource as string).not.toContain('/mcp')
    })
  })

  describe('/.well-known/oauth-authorization-server', () => {
    it('should return 200 with JSON content type', async () => {
      const request = new Request('http://example.com/.well-known/oauth-authorization-server')
      const ctx = createExecutionContext()
      const response = await worker.fetch(request, env, ctx)
      await waitOnExecutionContext(ctx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('application/json')
    })

    it('should include all MCP-required authorization server fields', async () => {
      const request = new Request('http://example.com/.well-known/oauth-authorization-server')
      const ctx = createExecutionContext()
      const response = await worker.fetch(request, env, ctx)
      await waitOnExecutionContext(ctx)

      const data = (await response.json()) as Record<string, unknown>

      expect(data.issuer).toBeTruthy()
      expect(data.authorization_endpoint).toBeTruthy()
      expect(data.token_endpoint).toBeTruthy()
      expect((data.response_types_supported as string[]).includes('code')).toBe(true)
      expect((data.grant_types_supported as string[]).includes('authorization_code')).toBe(true)
      expect((data.code_challenge_methods_supported as string[]).includes('S256')).toBe(true)
    })

    it('should have authorization_endpoint pointing to /authorize', async () => {
      const request = new Request('http://example.com/.well-known/oauth-authorization-server')
      const ctx = createExecutionContext()
      const response = await worker.fetch(request, env, ctx)
      await waitOnExecutionContext(ctx)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.authorization_endpoint as string).toContain('/authorize')
    })

    it('should have token_endpoint pointing to /oauth/token', async () => {
      const request = new Request('http://example.com/.well-known/oauth-authorization-server')
      const ctx = createExecutionContext()
      const response = await worker.fetch(request, env, ctx)
      await waitOnExecutionContext(ctx)

      const data = (await response.json()) as Record<string, unknown>
      expect(data.token_endpoint as string).toContain('/oauth/token')
    })
  })
})
```

- [ ] **Step 2: Run to verify discovery tests pass (these endpoints already work)**

Run: `npx vitest run test/oauth-discovery.test.ts --reporter=verbose 2>&1`

Expected: All tests PASS. These endpoints are served by `@cloudflare/workers-oauth-provider` (auth server metadata) and `oauth-handler.ts` (protected resource metadata), both of which are already correct. If any test fails, note the failure — do not proceed until you understand why.

---

### Task 5: Add the regression test for copy-paste URLs

This is the key regression test: lock in that `POST /mcp` with no auth never returns a copy-paste URL again.

**Files:**
- Modify: `test/index-oauth.test.ts`

- [ ] **Step 1: Add a regression describe block at the end of the file**

```typescript
describe('Regression: no copy-paste login URLs for OAuth clients', () => {
  it('POST /mcp with no auth should never return a /login?session_id= URL in body', async () => {
    // This is the exact broken behavior we are fixing.
    // Before the fix: returns 200 with "Click this link: /login?session_id=..."
    // After the fix: returns 401 with WWW-Authenticate header
    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'get_recent_tracks', arguments: {} },
        id: 1,
      }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
    })

    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(401)
    const body = await response.clone().text()
    expect(body).not.toContain('/login?session_id=')
    expect(body).not.toContain('Click this link')
    expect(body).not.toContain('Sign in with your Last.fm')
  })

  it('POST /mcp with valid session_id param still returns 200 (not affected by fix)', async () => {
    const sessionId = 'regression-test-valid-session'
    await env.MCP_SESSIONS.put(
      `session:${sessionId}`,
      JSON.stringify({
        userId: 'testuser',
        sessionKey: 'test-session-key',
        username: 'testuser',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        sessionId,
      }),
    )

    const request = new Request(`http://example.com/mcp?session_id=${sessionId}`, {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'TestClient', version: '1.0.0' },
        },
        id: 1,
      }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
    })

    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
  })

  it('GET /login still works (manual login path not affected)', async () => {
    // The /login route is handled by LastfmOAuthHandler and must not be broken
    const request = new Request('http://example.com/login')
    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)

    // /login redirects to Last.fm auth (302) — confirms the manual path still works
    expect([302, 400, 500]).toContain(response.status)
    // It should NOT return 404
    expect(response.status).not.toBe(404)
  })
})
```

- [ ] **Step 2: Run all tests to get the full pre-fix baseline**

Run: `npx vitest run test/index-oauth.test.ts test/oauth-discovery.test.ts --reporter=verbose 2>&1`

Save the output. Expected: Several tests in `index-oauth.test.ts` FAIL (those asserting 401 for unauthenticated requests). Discovery tests PASS. This is your baseline — after the fix, all should pass.

- [ ] **Step 3: Commit the tests**

```bash
git add test/index-oauth.test.ts test/oauth-discovery.test.ts
git commit -m "test: update index-oauth tests and add OAuth discovery tests for routing fix"
```

---

### Task 6: Create full OAuth round-trip integration test

This test covers spec test case 7 (valid bearer token → 200) and proves the complete flow works end-to-end: register a client, authorize, callback, exchange code for token, use token to call an MCP endpoint.

Mocks the Last.fm `getSessionKey` API call so we don't need a real Last.fm account.

**Files:**
- Create: `test/oauth-roundtrip.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// ABOUTME: Full OAuth round-trip integration test for the MCP OAuth 2.1 flow.
// ABOUTME: Covers client registration, authorization, callback, token exchange, and authenticated MCP request.
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import worker from '../src/index-oauth'

// Mock the Last.fm auth module so we don't need a real Last.fm account.
// The mock intercepts getSessionKey() which is called during /lastfm-callback.
vi.mock('../src/auth/lastfm', () => ({
  LastfmAuth: vi.fn().mockImplementation(() => ({
    getAuthUrl: (callbackUrl: string) =>
      `https://www.last.fm/api/auth/?api_key=test-key&cb=${encodeURIComponent(callbackUrl)}`,
    getSessionKey: vi.fn().mockResolvedValue({
      sessionKey: 'mock-lastfm-session-key',
      username: 'testuser',
    }),
  })),
}))

/** Generate a PKCE code_verifier and its SHA-256 base64url code_challenge */
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  return { verifier, challenge }
}

describe('Full OAuth Round-Trip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes the full OAuth flow: register → authorize → callback → token → MCP request', async () => {
    const baseUrl = 'http://example.com'
    const redirectUri = 'http://localhost:9999/callback'

    // ── Step 1: Register a test OAuth client ────────────────────────────
    const registerRequest = new Request(`${baseUrl}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Test MCP Client',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // public client (PKCE)
      }),
    })
    const regCtx = createExecutionContext()
    const regResponse = await worker.fetch(registerRequest, env, regCtx)
    await waitOnExecutionContext(regCtx)

    expect(regResponse.status).toBe(201)
    const { client_id: clientId } = (await regResponse.json()) as { client_id: string }
    expect(clientId).toBeTruthy()

    // ── Step 2: Start authorization (GET /authorize) ─────────────────────
    const { verifier, challenge } = await generatePKCE()
    const state = crypto.randomUUID()
    const authorizeUrl = new URL(`${baseUrl}/authorize`)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('client_id', clientId)
    authorizeUrl.searchParams.set('redirect_uri', redirectUri)
    authorizeUrl.searchParams.set('code_challenge', challenge)
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')
    authorizeUrl.searchParams.set('state', state)

    const authCtx = createExecutionContext()
    const authResponse = await worker.fetch(new Request(authorizeUrl.toString()), env, authCtx)
    await waitOnExecutionContext(authCtx)

    // Should redirect to Last.fm
    expect(authResponse.status).toBe(302)
    const lastfmRedirectUrl = authResponse.headers.get('Location')
    expect(lastfmRedirectUrl).toContain('last.fm')
    expect(lastfmRedirectUrl).toContain('lastfm-callback')

    // Extract state token from the Last.fm callback URL embedded in the redirect
    const cbUrlMatch = lastfmRedirectUrl!.match(/cb=([^&]+)/)
    expect(cbUrlMatch).not.toBeNull()
    const callbackUrl = decodeURIComponent(cbUrlMatch![1])
    const stateToken = new URL(callbackUrl).searchParams.get('state')
    expect(stateToken).toBeTruthy()

    // ── Step 3: Simulate Last.fm callback ────────────────────────────────
    const lastfmCallbackUrl = `${baseUrl}/lastfm-callback?token=mock-lastfm-token&state=${stateToken}`
    const callbackCtx = createExecutionContext()
    const callbackResponse = await worker.fetch(new Request(lastfmCallbackUrl), env, callbackCtx)
    await waitOnExecutionContext(callbackCtx)

    // Should redirect back to our redirect_uri with an authorization code
    expect(callbackResponse.status).toBe(302)
    const redirectBack = callbackResponse.headers.get('Location')
    expect(redirectBack).toBeTruthy()
    expect(redirectBack).toContain(redirectUri)

    const codeUrl = new URL(redirectBack!)
    const code = codeUrl.searchParams.get('code')
    expect(code).toBeTruthy()

    // ── Step 4: Exchange code for access token ───────────────────────────
    const tokenRequest = new Request(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }).toString(),
    })
    const tokenCtx = createExecutionContext()
    const tokenResponse = await worker.fetch(tokenRequest, env, tokenCtx)
    await waitOnExecutionContext(tokenCtx)

    expect(tokenResponse.status).toBe(200)
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string }
    expect(accessToken).toBeTruthy()

    // ── Step 5: Use access token to call MCP endpoint ────────────────────
    // This is spec test case 7: valid bearer token → 200
    const mcpRequest = new Request(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'TestClient', version: '1.0.0' },
        },
        id: 1,
      }),
    })
    const mcpCtx = createExecutionContext()
    const mcpResponse = await worker.fetch(mcpRequest, env, mcpCtx)
    await waitOnExecutionContext(mcpCtx)

    // Valid token → MCP handler responds with 200
    expect(mcpResponse.status).toBe(200)

    // Body must not contain a copy-paste URL
    const body = await mcpResponse.clone().text()
    expect(body).not.toContain('/login?session_id=')
  })
})
```

- [ ] **Step 2: Run to verify the round-trip test fails (no implementation yet)**

Run: `npx vitest run test/oauth-roundtrip.test.ts --reporter=verbose 2>&1`

Expected: The test FAILS because `POST /mcp` without auth (before the routing fix) returns 200 with a copy-paste URL instead of going through OAuth. Alternatively it may fail at the "valid token → 200" assertion if `handleUnauthenticatedMcp` is still in place. Note the exact failure point.

- [ ] **Step 3: Commit the round-trip test**

```bash
git add test/oauth-roundtrip.test.ts
git commit -m "test: add full OAuth round-trip integration test"
```

---

## Chunk 2: Implement the Fix

---

### Task 7: Add Access-Control-Expose-Headers to handleSessionBasedMcp

`handleSessionBasedMcp` sets `Mcp-Session-Id` but not `Access-Control-Expose-Headers`. Cross-origin clients need both to read the session ID. After the fix, `Mcp-Session-Id` header clients go through this function, so it must expose the header.

The test for this was written in Task 2 ("should expose Mcp-Session-Id in Access-Control-Expose-Headers for session-based responses"). **Run that test now to confirm it fails before making this change:**

Run: `npx vitest run test/index-oauth.test.ts -t "should expose Mcp-Session-Id in Access-Control-Expose-Headers" --reporter=verbose 2>&1`

Expected: FAIL — `handleSessionBasedMcp` does not yet add `Access-Control-Expose-Headers`. Then apply the fix below.

**Files:**
- Modify: `src/index-oauth.ts`

- [ ] **Step 1: Find the response construction in `handleSessionBasedMcp` (around lines 84–93)**

The current code:
```typescript
	// Add session ID to response headers
	const newHeaders = new Headers(response.headers)
	newHeaders.set('Mcp-Session-Id', sessionId)

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	})
```

Replace with:
```typescript
	// Add session ID to response headers and expose it for cross-origin clients
	const newHeaders = new Headers(response.headers)
	newHeaders.set('Mcp-Session-Id', sessionId)
	newHeaders.set('Access-Control-Expose-Headers', 'Mcp-Session-Id')

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	})
```

- [ ] **Step 2: Build check**

Run: `npm run build 2>&1`

Expected: No errors.

---

### Task 8: Fix request routing — remove handleUnauthenticatedMcp

**Files:**
- Modify: `src/index-oauth.ts`

- [ ] **Step 1: Delete the `handleUnauthenticatedMcp` function**

Find and delete the entire function from the opening comment through its closing brace. The function starts at line 95 with this comment and ends at line 149:

```typescript
/**
 * Handle MCP request without authentication (for clients that don't support OAuth)
 * Public tools work; authenticated tools prompt for login
 */
async function handleUnauthenticatedMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	// ... entire function body ...
}
```

Delete all 51 lines of this function (lines 95–149). After deletion the file should jump from the end of `handleSessionBasedMcp` directly to the `// Server metadata` comment or the `oauthProvider` declaration.

- [ ] **Step 2: Replace the `/mcp` routing block**

Find this block (now around lines 310–328 after the function deletion — search for `// Check if this is an MCP request`):

```typescript
		// Check if this is an MCP request
		if (url.pathname === '/mcp') {
			const sessionId = url.searchParams.get('session_id')
			const hasOAuthToken = request.headers.get('Authorization')?.startsWith('Bearer ')

			if (sessionId) {
				// Use session-based auth for Claude Desktop
				return handleSessionBasedMcp(request, env, ctx, sessionId)
			}

			if (!hasOAuthToken) {
				// No OAuth token - handle as unauthenticated MCP request
				// Public tools work; authenticated tools prompt for login
				return handleUnauthenticatedMcp(request, env, ctx)
			}

			// Has Bearer token - fall through to OAuth provider for validation
		}
```

Replace with:

```typescript
		// Check if this is an MCP request
		if (url.pathname === '/mcp') {
			const sessionId = url.searchParams.get('session_id')

			if (sessionId) {
				// Explicit session_id param → session-based auth (manual login flow)
				return handleSessionBasedMcp(request, env, ctx, sessionId)
			}

			// Check for an existing session via Mcp-Session-Id header.
			// Clients that previously authenticated via the manual login flow
			// send this header to resume their session.
			const mcpSessionId = request.headers.get('Mcp-Session-Id')
			if (mcpSessionId) {
				const sessionDataStr = await env.MCP_SESSIONS.get(`session:${mcpSessionId}`)
				if (sessionDataStr) {
					return handleSessionBasedMcp(request, env, ctx, mcpSessionId)
				}
			}

			// No valid session found. Fall through to the OAuth provider.
			// - Requests with a valid Bearer token: OAuth provider authenticates them.
			// - Requests with no/invalid token: OAuth provider returns 401 + WWW-Authenticate,
			//   which triggers the MCP client's built-in browser-based OAuth flow.
		}
```

- [ ] **Step 3: Check for unused imports**

After deleting `handleUnauthenticatedMcp`, check line 10:
```typescript
import { buildOAuthAuthMessages } from './mcp/tools'
```

Search in the file for other uses of `buildOAuthAuthMessages`. It is still used inside the `oauthProvider` `apiHandler` on line 164 (`authMessages: buildOAuthAuthMessages()`). Keep the import.

Also check that no other function references `handleUnauthenticatedMcp`:

```bash
grep -n "handleUnauthenticatedMcp\|buildOAuthAuthMessages" src/index-oauth.ts
```

Expected output: Only the `buildOAuthAuthMessages` import line (line ~10) and its usage inside `oauthProvider.apiHandler` (line ~164). Zero occurrences of `handleUnauthenticatedMcp`. If any appear, remove them.

- [ ] **Step 4: Build check**

Run: `npm run build 2>&1`

Expected: No TypeScript errors. If there are any remaining references to `handleUnauthenticatedMcp` they will appear as errors — fix them.

- [ ] **Step 5: Run targeted tests**

Run: `npx vitest run test/index-oauth.test.ts test/oauth-discovery.test.ts test/oauth-roundtrip.test.ts --reporter=verbose 2>&1`

Expected: All tests PASS. Check each test by name:
- "should return 401 when no auth is provided" ✓
- "should include WWW-Authenticate header pointing to OAuth metadata" ✓
- "should return 401 when Mcp-Session-Id header has no matching KV session" ✓
- "should not include a /login?session_id= URL in the response body" ✓
- "should use session-based auth when Mcp-Session-Id header has a valid KV session" ✓
- "should expose Mcp-Session-Id in Access-Control-Expose-Headers for session-based responses" ✓
- "should return 401 when Mcp-Session-Id header session is expired" ✓
- "POST /mcp with no auth should never return a /login?session_id= URL in body" ✓

If any test fails, diagnose using the failure message before proceeding.

- [ ] **Step 6: Run the full test suite**

Run: `npm test 2>&1`

Expected: All tests pass. If any pre-existing tests fail, investigate — do NOT skip or delete them without understanding why.

- [ ] **Step 8: Commit the fix**

```bash
git add src/index-oauth.ts
git commit -m "fix: route unauthenticated /mcp requests through OAuth provider for browser-based auth

Previously, requests with no bearer token and no session_id were sent to
handleUnauthenticatedMcp() which returned a copy-paste /login?session_id= URL.
Now they fall through to the OAuth provider which returns 401 + WWW-Authenticate,
triggering MCP clients (Claude Code, Claude Desktop, opencode) to open the
browser automatically for OAuth.

Also adds Access-Control-Expose-Headers: Mcp-Session-Id to handleSessionBasedMcp
so cross-origin clients can read the session ID header.

Preserves Mcp-Session-Id header + KV lookup for clients with existing
manual-login sessions."
```

---

## Chunk 3: Manual Verification

---

### Task 9: Manual end-to-end verification

Automated tests prove the HTTP-level behavior is correct. This task verifies the actual client experience.

**Files:** None — verification only.

- [ ] **Step 1: Start the dev server**

Run in background: `npm run dev`

Wait for the message: `⎔ Starting local server...` / `Ready on http://localhost:8787`

- [ ] **Step 2: Verify the 401 response**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```

Expected output: `401`

- [ ] **Step 3: Verify the WWW-Authenticate header**

```bash
curl -s -D - -o /dev/null -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' \
  | grep -i www-authenticate
```

Expected: `WWW-Authenticate: Bearer resource_metadata="http://localhost:8787/.well-known/oauth-protected-resource"`

- [ ] **Step 4: Verify the discovery endpoints**

```bash
curl -s http://localhost:8787/.well-known/oauth-protected-resource | python3 -m json.tool
curl -s http://localhost:8787/.well-known/oauth-authorization-server | python3 -m json.tool
```

Expected: Both return valid JSON. The authorization server metadata must include `authorization_endpoint`, `token_endpoint`, `response_types_supported` (with `"code"`), `grant_types_supported` (with `"authorization_code"`), `code_challenge_methods_supported` (with `"S256"`).

- [ ] **Step 5: Test with MCP Inspector**

```bash
npx @modelcontextprotocol/inspector http://localhost:8787/mcp
```

Expected: MCP Inspector detects the 401 response, fetches OAuth metadata, and prompts to open a browser for authorization — NOT a copy-paste URL. Complete the authorization flow and confirm authenticated tools work.

If it does not open a browser:
1. Check the MCP Inspector output for the exact error message.
2. Run `curl -s http://localhost:8787/.well-known/oauth-authorization-server | python3 -m json.tool` and confirm `authorization_endpoint` and `token_endpoint` are present.
3. Run `curl -s http://localhost:8787/.well-known/oauth-protected-resource | python3 -m json.tool` and confirm `authorization_servers` contains the base URL.
4. If MCP Inspector shows "no OAuth metadata found", the `WWW-Authenticate` header format may be wrong — re-run step 3 of this task and compare to the expected value exactly.
5. Do not deploy until manual verification passes.

---

## Deployment

After all tests pass and manual verification succeeds:

- [ ] **Deploy to production**

```bash
npm run deploy:prod
```

- [ ] **Verify production**

```bash
curl -s -D - -o /dev/null -X POST https://lastfm-mcp.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' \
  | grep -i www-authenticate
```

Expected: `WWW-Authenticate: Bearer resource_metadata="https://lastfm-mcp.com/.well-known/oauth-protected-resource"`
