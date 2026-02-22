# Cloudflare Workers Best Practices Review: lastfm-mcp

**Date:** 2026-02-22
**Reviewed against:** [Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)

## Summary

The codebase is well-structured and follows many Workers patterns correctly. TypeScript compiles cleanly and lint passes with only warnings. There are several findings organized by severity.

---

## CRITICAL Findings

### 1. Global mutable state in SSE transport — cross-request data leaks

`src/transport/sse.ts:7`

```ts
const connections = new Map<string, SSEConnection>()
```

This is a **module-level mutable Map** that stores active SSE connections, authentication state, and user IDs. Workers reuse isolates across requests, so this data leaks between requests and between different users. Per the best practice: _"Module-level mutable variables cause cross-request data leaks, stale state, and 'Cannot perform I/O on behalf of a different request' errors."_

The `connections` Map also includes `isAuthenticated` and `userId` fields, meaning one user's authentication state could leak to another request processed by the same isolate.

**Additionally**: `setInterval` at line 50 will not work reliably in Workers — isolates can be evicted between requests, so the keepalive interval will silently disappear. SSE connections in Workers generally require Durable Objects for reliable long-lived connections.

**Fix**: If the legacy SSE transport is needed, move connection state to KV or Durable Objects. Otherwise, deprecate the SSE module and rely solely on the HTTP-based MCP transport.

### 2. Global mutable state in LastfmClient and LastfmAuth — `lastRequestTime`

`src/clients/lastfm.ts:362`, `src/auth/lastfm.ts:36`

```ts
private lastRequestTime = 0
```

Both `LastfmClient` and `LastfmAuth` store `lastRequestTime` as instance state, but `createMcpServer()` (`src/mcp/server.ts:59-60`) creates new instances per request, so this is technically safe for the client. However, in `src/protocol/handlers.ts:38-46`, `getCachedLastfmClient()` creates a **new client on every call**, making the throttling completely ineffective — `lastRequestTime` always starts at 0.

**Fix**: If rate-limiting against the Last.fm API is needed, implement it with a shared counter in KV (e.g., a sliding window key), not instance state.

### 3. JWT signature comparison uses string equality — timing side-channel

`src/auth/jwt.ts:60`

```ts
if (signature !== expectedSignature) {
	return null
}
```

This directly compares JWT signatures using `!==`, which is vulnerable to timing side-channel attacks. The Workers best practice explicitly states: _"Use `crypto.subtle.timingSafeEqual()` for comparing secrets. Hash both values to a fixed size first."_

**Fix**: Replace with `crypto.subtle.timingSafeEqual()`:

```ts
const enc = new TextEncoder()
const a = enc.encode(signature)
const b = enc.encode(expectedSignature)
if (a.byteLength !== b.byteLength || !crypto.subtle.timingSafeEqual(a, b)) {
	return null
}
```

---

## HIGH Findings

### 4. Hand-written `Env` interface instead of generated types

`src/types/env.ts:3-18`

The `Env` interface is manually defined. The best practice says: _"Never hand-write the `Env` interface. Run `wrangler types` to generate it."_ The project even has `"cf-typegen": "wrangler types"` in `package.json`, and `tsconfig.json` references `.build/tools/worker-configuration.d.ts`, but `src/types/env.ts` is what's actually used everywhere. This creates drift risk — if a binding is renamed in `wrangler.toml`, the code won't catch it until deploy time.

**Fix**: Run `wrangler types`, then import the generated `Env` from `worker-configuration.d.ts` instead of the hand-written one. Remove `src/types/env.ts`.

### 5. Duplicate `KVNamespace` declarations shadow platform types

`src/utils/kvLogger.ts:5-12`, `src/utils/rateLimit.ts:5-12`

```ts
declare global {
    interface KVNamespace { ... }
}
```

Both files declare `KVNamespace` in the global scope. This shadows the actual `KVNamespace` type from `@cloudflare/workers-types`, which has many more methods and options. This could mask type errors (e.g., missing `metadata`, `cacheTtl`, etc.).

**Fix**: Remove the `declare global` blocks. The correct types come from `@cloudflare/workers-types` which is already installed.

### 6. Compatibility date is stale

`wrangler.toml:3`

```toml
compatibility_date = "2024-12-01"
```

The date is over 14 months old. The best practice says to flag dates older than 6 months. Updating gives access to newer runtime features and bug fixes.

**Fix**: Update to a recent date (e.g., `2025-02-22`).

### 7. Using `wrangler.toml` instead of `wrangler.jsonc`

The best practice recommends `wrangler.jsonc` for new projects — newer features are JSON-only, and JSONC supports comments.

**Fix**: Migrate to `wrangler.jsonc`. Low urgency since the current config works.

### 8. `_ctx` is unused — logging and KV writes should use `waitUntil`

`src/index.ts:173`

```ts
async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
```

The `ExecutionContext` is underscore-prefixed (unused) in the legacy entry point, but the `handleMCPRequest` function does `await logger.log(...)` and `await rateLimiter.checkLimit(...)` **inline** before returning the response. These KV writes should be deferred using `ctx.waitUntil()` to reduce response latency.

The OAuth entry point (`src/index-oauth.ts`) does use `ctx` and passes it through to `createMcpHandler`.

**Fix**: Pass `ctx` into `handleMCPRequest` and wrap logging/non-critical KV writes in `ctx.waitUntil()`.

### 9. `as any` type casts in protocol handlers

`src/protocol/handlers.ts:697,868,1085,1129,1306`

Five instances of `as any` on Last.fm artist/track access. These defeat type safety.

**Fix**: Define a proper union type for the artist field shape (string vs object with `name`), and use a type guard or accessor function.

---

## MEDIUM Findings

### 10. `Math.random()` used for log key generation

`src/utils/kvLogger.ts:40`

```ts
const key = `log:${userId}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`
```

While this isn't for security, the best practice flags `Math.random()`. For log keys, `crypto.randomUUID()` would be more appropriate and avoids any ambiguity.

### 11. `Math.random()` in retry jitter

`src/utils/retry.ts:58,64`

Used for calculating backoff jitter. This is acceptable for jitter timing but worth noting per the best practice. Not a security concern.

### 12. No `observability.logs.head_sampling_rate` configured

`wrangler.toml:6-7`

```toml
[observability]
enabled = true
```

Observability is enabled (good!), but no `head_sampling_rate` or `traces` configuration. For a production worker, you should configure sampling rates explicitly.

**Fix**: Add explicit configuration:

```toml
[observability]
enabled = true

[observability.logs]
head_sampling_rate = 1

[observability.traces]
enabled = true
head_sampling_rate = 0.01
```

### 13. Unstructured string logging throughout

Most logging uses `console.log()` with string templates rather than structured JSON. Examples:

- `src/index.ts:51`: ``console.log(`[SESSION-LOOKUP] Looking up KV key: ${kvKey}`)``
- `src/index.ts:132`: ``console.log(`[MCP-SDK] Session ID: ${sessionId} ...`)``

The best practice says: _"Use structured JSON logging — `console.log(JSON.stringify({...}))` — so logs are searchable and filterable."_

**Fix**: Convert to structured JSON logging: `console.log(JSON.stringify({ event: "session_lookup", kvKey, found: !!result }))`

### 14. OAuthProvider instantiated at module level

`src/index-oauth.ts:154`

```ts
const oauthProvider = new OAuthProvider({ ... })
```

This is a module-level instance. It's fine if `OAuthProvider` is stateless (it appears to be — just holds config), but it's worth verifying that it doesn't accumulate request-scoped state internally.

### 15. Production environment missing `observability` config

`wrangler.toml:27-44`

The production environment doesn't inherit `[observability]`. Non-inheritable keys in wrangler environments mean production may not have observability enabled.

**Fix**: Add `[env.production.observability]` with appropriate configuration.

### 16. `as unknown as` cast in OAuth handler

`src/index-oauth.ts:170`

```ts
const props = auth.props as unknown as { username: string; sessionKey: string }
```

Double-cast hides real type incompatibilities. The best practice explicitly flags `as unknown as T`.

**Fix**: Define a proper type for the auth props and use a type guard.

---

## LOW Findings

### 17. `response as unknown as Response` in SSE handler

`src/index.ts:582`

```ts
return response as unknown as Response
```

Another double-cast that hides a type mismatch between the SSE response and the Worker's Response type.

### 18. Cookie parsing duplicated in 3+ places

Cookie parsing logic (`cookieHeader.split(';').reduce(...)`) is duplicated in `src/index.ts:88`, `src/index.ts:848`, and `src/protocol/handlers.ts:60`. Extract to a shared utility.

### 19. Missing `Access-Control-Allow-Origin` on some error responses

Some error responses (e.g., `src/index.ts:211`) return plain text without CORS headers, which could cause client-side errors for browser-based MCP clients.

### 20. `satisfies ExportedHandler<Env>` not used on default exports

Neither `src/index.ts:172` nor `src/index-oauth.ts:223` uses `satisfies ExportedHandler<Env>`, which the best practice recommends for type validation without widening.

---

## What's Done Well

- **Secrets management**: Secrets (`LASTFM_API_KEY`, `LASTFM_SHARED_SECRET`, `JWT_SECRET`) are properly stored via `wrangler secret put` and accessed through `env`. `.dev.vars` is in `.gitignore`.
- **`nodejs_compat` enabled**: In `compatibility_flags`.
- **Observability enabled**: Though configuration could be more explicit.
- **`crypto.randomUUID()`**: Used correctly for session IDs and state tokens.
- **CSRF protection**: The OAuth flow includes proper CSRF token generation and validation with `__Host-` cookies.
- **Test infrastructure**: Uses `@cloudflare/vitest-pool-workers` correctly.
- **Error handling**: Consistent try/catch with error responses throughout. No `passThroughOnException()`.
- **Web Crypto for JWT signing**: Uses `crypto.subtle` HMAC-SHA256 — not a third-party library.
- **Rate limiting**: Implemented and configurable.
- **Caching layer**: Smart per-endpoint TTL caching reduces API calls.
- **XSS sanitization**: Output sanitization in the OAuth callback HTML page.
- **KV bindings used properly**: Direct binding access, not REST API.

---

## Priority Recommendations

| Priority | Finding                                               | Effort  |
| -------- | ----------------------------------------------------- | ------- |
| P0       | #3 — Fix JWT timing side-channel                      | Small   |
| P0       | #1 — Remove global mutable SSE state or deprecate SSE | Medium  |
| P1       | #4 — Switch to generated `Env` types                  | Small   |
| P1       | #5 — Remove duplicate `KVNamespace` declarations      | Small   |
| P1       | #8 — Use `ctx.waitUntil()` for logging/KV writes      | Medium  |
| P1       | #6 — Update `compatibility_date`                      | Trivial |
| P2       | #13 — Add structured JSON logging                     | Medium  |
| P2       | #9 — Remove `as any` casts                            | Small   |
| P2       | #12, #15 — Configure observability sampling           | Small   |
| P3       | #7 — Migrate to `wrangler.jsonc`                      | Small   |
