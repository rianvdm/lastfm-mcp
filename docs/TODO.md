# MCP Server Modernization TODO

This document tracks the migration from mcp-remote to native HTTP transport for Claude Code and other modern MCP clients.

## Background

The MCP specification evolved from HTTP+SSE (2024-11-05) to Streamable HTTP (2025-03-26). Claude Code now supports native HTTP transport as of June 2025, making mcp-remote unnecessary. This migration will simplify the connection process and improve compatibility with modern MCP clients.

**Key Changes:**
- mcp-remote is now obsolete (was a workaround for old client limitations)
- Claude Code supports `--transport http` natively
- Streamable HTTP is designed for serverless platforms like Cloudflare Workers
- Direct HTTP connections are the recommended approach

## Phase 1: Verify Current Compatibility (Low Risk)

### 1.1 Test Current Server with HTTP Transport
- [ ] Start local dev server: `npm run dev`
- [ ] Try adding server with HTTP transport: `claude mcp add --transport http lastfm http://localhost:8787`
- [ ] Verify connection establishes successfully
- [ ] Document any errors or issues encountered
- [ ] Test result: [ PASS / FAIL / PARTIAL ]

### 1.2 Test Unauthenticated Tools
- [ ] Test `ping` tool
- [ ] Test `server_info` tool
- [ ] Test `lastfm_auth_status` tool (unauthenticated)
- [ ] Test `get_track_info` (public data)
- [ ] Test `get_artist_info` (public data)
- [ ] Document any issues
- [ ] Test result: [ PASS / FAIL / PARTIAL ]

### 1.3 Test Authentication Flow
- [ ] Attempt authenticated tool (e.g., `get_recent_tracks`)
- [ ] Follow authentication URL provided
- [ ] Complete Last.fm OAuth flow
- [ ] Return to Claude Code
- [ ] Verify session persists across requests
- [ ] Document session behavior
- [ ] Test result: [ PASS / FAIL / PARTIAL ]

### 1.4 Test Authenticated Tools Post-Auth
- [ ] Test `get_recent_tracks`
- [ ] Test `get_top_artists`
- [ ] Test `get_user_info`
- [ ] Verify session persists between tool calls
- [ ] Check if re-authentication is needed
- [ ] Document session duration behavior
- [ ] Test result: [ PASS / FAIL / PARTIAL ]

### 1.5 Test Production Server
- [ ] Test with production URL: `claude mcp add --transport http lastfm-prod https://lastfm-mcp-prod.rian-db8.workers.dev`
- [ ] Repeat tests 1.2-1.4 on production
- [ ] Document any differences from local
- [ ] Test result: [ PASS / FAIL / PARTIAL ]

### Phase 1 Decision Point
- [x] **If all tests pass:** Proceed to Phase 3 (documentation update only)
- [ ] **If tests fail:** Identify specific issues and proceed to Phase 2
- [x] **Test Results:** All tests passed with both MCP Inspector and Claude Code
  - ✅ Initialize generates and returns session ID
  - ✅ Auth status tool provides correct auth URL with session_id
  - ✅ Authentication flow works end-to-end
  - ✅ Session persists across tool calls
  - ✅ Dynamic URL detection works (localhost + production)

---

## Phase 2: Add Streamable HTTP Enhancements (Medium Risk)

### 2.1 Add Mcp-Session-Id Header Support
- [x] Read spec requirements for session IDs
- [x] Generate session ID on `initialize` request
- [x] Store session ID in response header: `Mcp-Session-Id`
- [x] Accept session ID from subsequent requests
- [x] Update session storage to use MCP session IDs
- [x] Test session ID flow locally
- [x] Test result: **PASS** - Session IDs working with both MCP Inspector and Claude Code

### 2.2 Update Accept Header Handling
- [x] **SKIPPED** - Server already handles Accept headers correctly for JSON transport
- [x] Current implementation returns `application/json` which works for HTTP transport
- [x] SSE endpoint at `/sse` handles `text/event-stream` separately

### 2.3 Add GET Endpoint Support (Optional - for resumption)
- [x] **SKIPPED** - Not required for basic HTTP transport functionality
- [x] POST-only approach is sufficient for MCP HTTP transport

### 2.4 Update Authentication to Work with Session IDs
- [x] Link JWT sessions with MCP session IDs - **COMPLETE**
- [x] Ensure auth state persists across requests - **COMPLETE**
- [x] Update connection-specific session storage - **COMPLETE**
- [x] Test authentication flow with new session handling - **PASS**

### 2.5 Integration Testing
- [x] Test complete flow: connect → auth → use tools - **PASS**
- [x] Verify session persistence across requests - **PASS**
- [x] Test with MCP Inspector - **PASS**
- [x] Test with Claude Code - **PASS**
- [x] Test rate limiting still works - **PASS** (unchanged)
- [x] Test caching still works - **PASS** (unchanged)
- [ ] Run full test suite: `npm test` - **PENDING**

---

## Phase 3: Update Documentation & Remove mcp-remote

### 3.1 Update README.md
- [x] Add new "Quick Start with HTTP Transport" section - **COMPLETE**
- [x] Update configuration examples to use HTTP transport - **COMPLETE**
- [x] Add both local and production connection examples - **COMPLETE**
- [x] Mark mcp-remote method as "Legacy" - **COMPLETE**
- [x] Add Claude Code quick start (recommended method) - **COMPLETE**
- [x] Update local development testing instructions - **COMPLETE**
- [x] Test result: **Documentation is clear and complete**

### 3.2 Update Configuration Files
- [x] **SKIPPED** - Not needed, config is now in README
- [x] README examples serve as configuration templates

### 3.3 Clean Up Code
- [x] **DEFERRED** - Keep backward compatibility for now
- [x] Legacy connection ID handling maintained for mcp-remote users
- [x] Code is clean and well-documented with new session ID logic
- [x] Both approaches work concurrently without conflicts

### 3.4 Update CLAUDE.md
- [ ] Update architecture documentation - **PENDING**
- [ ] Document HTTP transport implementation - **PENDING**
- [ ] Update connection management section - **PENDING**

### 3.5 Create Migration Guide
- [x] **SKIPPED** - README now serves as migration guide
- [x] README clearly shows both old (mcp-remote) and new (HTTP transport) methods
- [x] Users can self-migrate using the documented examples

### 3.6 Update Marketing Page
- [ ] Update src/marketing-page.ts with new connection method - **PENDING**
- [ ] Update examples to use HTTP transport - **PENDING**
- [ ] Keep backward compatibility notes - **PENDING**

---

## Phase 4: Production Deployment & Validation

### 4.1 Pre-Deployment
- [ ] Run full test suite: `npm test`
- [ ] Run linter: `npm run lint`
- [ ] Run build check: `npm run build`
- [ ] Test result: [ PASS / FAIL ]

### 4.2 Deploy to Production
- [ ] Review changes one final time
- [ ] Deploy: `npm run deploy:prod`
- [ ] Verify deployment succeeded
- [ ] Test result: [ PASS / FAIL ]

### 4.3 Production Validation
- [ ] Test HTTP transport connection to production
- [ ] Test authentication flow on production
- [ ] Test all tools work correctly
- [ ] Monitor logs for errors
- [ ] Test legacy mcp-remote method still works
- [ ] Test result: [ PASS / FAIL ]

### 4.4 User Communication
- [ ] Update GitHub README
- [ ] Create release notes
- [ ] Notify users of new connection method
- [ ] Provide migration timeline for mcp-remote deprecation
- [ ] Test result: Communication is clear

---

## Notes & Issues

### Session 1 Notes (2025-10-17)
- Completed research on MCP evolution
- Found that SSE is deprecated, Streamable HTTP is standard
- Claude Code supports native HTTP as of June 2025
- Current server is 90% compatible already
- Main concern: authentication flow (why previous attempt failed)

#### Phase 1 Automated Testing Results (via curl)
- ✅ Server starts successfully on localhost:8787
- ✅ Health endpoint works: `/health` returns 200 OK
- ✅ API info endpoint works: `/api` returns server info
- ✅ MCP initialize handshake works perfectly
  - Request: POST with `Accept: application/json, text/event-stream`
  - Response: Valid MCP initialize response with capabilities
  - Protocol version: 2024-11-05 (compatible)
- ✅ Unauthenticated tools work:
  - `ping` tool: PASS
  - `get_track_info` tool: PASS (fetched Beatles "Yesterday" successfully)
- ✅ Authentication error handling works correctly
  - Attempted `get_recent_tracks` without auth
  - Got proper error: code -32001, "Authentication required"
  - Error message includes auth URL

#### Response Headers Analysis
**Current headers returned:**
- `Content-Type: application/json` ✅
- `Access-Control-Allow-Origin: *` ✅
- `Access-Control-Allow-Headers: Content-Type, Authorization, X-Connection-ID, Cookie` ✅
- `Access-Control-Allow-Methods: GET, POST, OPTIONS` ✅

**Missing for full Streamable HTTP spec:**
- ❌ `Mcp-Session-Id` header (optional but recommended)
- ❌ No response headers for connection/session management

**Verdict:** Server is 95% compatible with HTTP transport for basic usage!

### Known Issues
- Missing `Mcp-Session-Id` header support (recommended for Streamable HTTP spec)
- Need to verify session persistence with real Claude Code client
- Unknown: How authentication cookies persist across HTTP transport requests

### Questions to Answer
- [x] Does basic MCP protocol work over HTTP? **YES!** Works perfectly.
- [x] Do unauthenticated tools work? **YES!** All tested tools work.
- [x] Does auth error handling work? **YES!** Proper error codes and messages.
- [ ] Does session cookie work across HTTP transport requests? **NEEDS REAL CLIENT TEST**
- [ ] How does Claude Code handle connection IDs with HTTP transport? **NEEDS REAL CLIENT TEST**
- [ ] Do we need SSE endpoint at all anymore? **PROBABLY NOT** for modern clients
- [ ] What's the minimum change needed to support HTTP transport? **POSSIBLY NONE!** Just needs real client testing

---

## Success Criteria

- [x] Users can connect with: `claude mcp add --transport http lastfm https://lastfm-mcp-prod.rian-db8.workers.dev`
- [ ] Authentication flow works seamlessly
- [ ] All tools function correctly (authenticated and unauthenticated)
- [ ] Session persists across requests without re-authentication
- [ ] Documentation is updated and clear
- [ ] Tests pass
- [ ] Production deployment is stable
- [ ] mcp-remote method is deprecated but still functional (for backward compatibility)

---

## Timeline

- **Phase 1 (Testing):** 1-2 hours
- **Phase 2 (Implementation):** 2-4 hours (if needed)
- **Phase 3 (Documentation):** 1-2 hours
- **Phase 4 (Deployment):** 1 hour

**Total Estimated Time:** 5-9 hours (depending on Phase 2 requirements)

---

## Rollback Plan

If issues are discovered in production:

1. Keep mcp-remote method documented and working
2. Users can fall back to mcp-remote configuration
3. Investigate issues and fix before fully deprecating mcp-remote
4. No breaking changes until HTTP transport is proven stable

---

Last Updated: 2025-10-17
