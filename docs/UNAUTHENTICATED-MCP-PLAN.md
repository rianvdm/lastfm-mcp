# Plan: Allow Unauthenticated MCP Initialization

**Date:** 2026-01-24
**Status:** Complete

## Problem Summary

The `/mcp` endpoint in `src/index-oauth.ts` currently routes all requests without a `session_id` query parameter directly to the `OAuthProvider`, which returns a 401 for any request without a valid OAuth Bearer token. This blocks clients that don't support OAuth 2.1 (like Antigravity, Windsurf) from even completing the MCP `initialize` handshake.

### Error Message

```
Error: streamable http connection failed: calling "initialize": sending "initialize": Unauthorized, sse fallback failed: missing endpoint: first event is "", want "endpoint".
```

### Root Cause

In `src/index-oauth.ts` lines 326-342:

```typescript
if (url.pathname === '/mcp') {
	const sessionId = url.searchParams.get('session_id')
	if (sessionId) {
		return handleSessionBasedMcp(request, env, ctx, sessionId)
	}
}
// Falls through to OAuth provider → returns 401
const response = await oauthProvider.fetch(request, env, ctx)
```

## Solution

Allow unauthenticated requests to `/mcp` to be handled by the MCP server directly. The MCP server already handles auth gracefully at the tool level - authenticated tools return a helpful message when the user isn't logged in.

### Request Routing Logic (New)

```
/mcp request received
    ├── Has session_id query param? → Use session-based auth (existing)
    ├── Has Bearer token header? → Route to OAuth provider (existing)
    └── Neither? → Handle as unauthenticated MCP request (NEW)
```

## Implementation Tasks

### 1. Standardize Test Naming

- [x] Rename `test/index.spec.ts` → `test/index.test.ts`
- Rationale: 19 files use `*.test.ts`, only 1 uses `*.spec.ts`

### 2. Modify `src/index-oauth.ts`

- [x] Add `handleUnauthenticatedMcp()` function
- [x] Modify `/mcp` route to check for Bearer token before routing to OAuth
- [x] Generate and return session ID for unauthenticated requests

### 3. Create `test/index-oauth.test.ts`

- [x] Test unauthenticated initialize request succeeds
- [x] Test session ID is returned in response header
- [x] Test existing session ID is preserved
- [x] Test session_id query param triggers session-based auth
- [x] Test Bearer token triggers OAuth provider
- [x] Test static endpoints (/, /health, /.well-known/mcp.json)

### 4. Update `README.md`

- [x] Tools documentation already existed
- [x] Fixed `auth_status` → `lastfm_auth_status` typo
- [x] Added note about public tools working without auth

### 5. Verify

- [x] Run `npm run lint` - passes (warnings are pre-existing)
- [x] Run `npm run build` - build succeeds
- [ ] Manual test with curl (requires deployment)

**Note:** Tests are disabled in CI due to pre-existing vitest/MCP SDK compatibility issue.

### 6. Commit

- [ ] Commit with descriptive message

---

## Code Changes

### A. New Handler Function (`src/index-oauth.ts`)

Add after `handleSessionBasedMcp` (around line 101):

```typescript
/**
 * Handle MCP request without authentication (for clients that don't support OAuth)
 * Public tools work; authenticated tools prompt for login
 */
async function handleUnauthenticatedMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url)
	const baseUrl = `${url.protocol}//${url.host}`

	// Generate a session ID for this client (allows them to authenticate later)
	// Check for existing session ID in header first
	let sessionId = request.headers.get('Mcp-Session-Id')
	if (!sessionId) {
		sessionId = crypto.randomUUID()
	}

	// Create MCP server without session context
	const { server, setContext } = createMcpServer(env, baseUrl)

	// Set context with session ID but no auth session
	// Tools will check for auth and prompt user to log in if needed
	setContext({
		sessionId,
		session: null,
	})

	const handler = createMcpHandler(server, { route: '/mcp' })
	const response = await handler(request, env, ctx)

	// Add session ID to response headers so client can use it for subsequent requests
	const newHeaders = new Headers(response.headers)
	newHeaders.set('Mcp-Session-Id', sessionId)
	newHeaders.set('Access-Control-Expose-Headers', 'Mcp-Session-Id')

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	})
}
```

### B. Modified Route Logic (`src/index-oauth.ts`)

Replace lines 326-334:

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

---

## Tools Reference

### Public Tools (No Auth Required)

| Tool                  | Description                             |
| --------------------- | --------------------------------------- |
| `ping`                | Test server connectivity                |
| `server_info`         | Get server information and capabilities |
| `get_track_info`      | Get detailed track information          |
| `get_artist_info`     | Get detailed artist information         |
| `get_album_info`      | Get detailed album information          |
| `get_similar_artists` | Find similar artists                    |
| `get_similar_tracks`  | Find similar tracks                     |

### Authenticated Tools (Last.fm Sign-in Required)

| Tool                        | Description                         |
| --------------------------- | ----------------------------------- |
| `lastfm_auth_status`        | Check authentication status         |
| `get_recent_tracks`         | Get recent listening history        |
| `get_top_artists`           | Get top artists by time period      |
| `get_top_albums`            | Get top albums by time period       |
| `get_loved_tracks`          | Get loved/favorited tracks          |
| `get_user_info`             | Get Last.fm profile information     |
| `get_listening_stats`       | Get listening statistics            |
| `get_music_recommendations` | Get personalized recommendations    |
| `get_weekly_artist_chart`   | Get weekly artist chart             |
| `get_weekly_track_chart`    | Get weekly track chart              |
| `get_weekly_chart_list`     | Get list of available weekly charts |

---

## Testing Plan

### Automated Tests

New test file `test/index-oauth.test.ts` covers:

- Unauthenticated MCP initialization
- Session ID generation and preservation
- Session-based auth flow
- OAuth token routing
- Static endpoints

### Manual Testing

```bash
# Test unauthenticated initialize
curl -X POST "https://lastfm-mcp.com/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# Should return 200 with Mcp-Session-Id header
```

---

## Rollback Plan

If issues arise, revert the changes to `src/index-oauth.ts` to restore the previous behavior where all `/mcp` requests without `session_id` go to the OAuth provider.
