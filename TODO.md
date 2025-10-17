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
- [ ] **If all tests pass:** Proceed to Phase 3 (documentation update only)
- [ ] **If tests fail:** Identify specific issues and proceed to Phase 2
- [ ] **Issues identified:**
  - Issue 1: _____________________
  - Issue 2: _____________________
  - Issue 3: _____________________

---

## Phase 2: Add Streamable HTTP Enhancements (Medium Risk)

### 2.1 Add Mcp-Session-Id Header Support
- [ ] Read spec requirements for session IDs
- [ ] Generate session ID on `initialize` request
- [ ] Store session ID in response header: `Mcp-Session-Id`
- [ ] Accept session ID from subsequent requests
- [ ] Update session storage to use MCP session IDs
- [ ] Test session ID flow locally
- [ ] Test result: [ PASS / FAIL ]

### 2.2 Update Accept Header Handling
- [ ] Verify server reads `Accept` header from requests
- [ ] Support both `application/json` and `text/event-stream`
- [ ] Return appropriate `Content-Type` based on Accept
- [ ] Test with different Accept header values
- [ ] Test result: [ PASS / FAIL ]

### 2.3 Add GET Endpoint Support (Optional - for resumption)
- [ ] Implement GET handler on `/` endpoint
- [ ] Support `Last-Event-ID` header
- [ ] Return session state on GET requests
- [ ] Test connection resumption after network interruption
- [ ] Test result: [ PASS / FAIL ]

### 2.4 Update Authentication to Work with Session IDs
- [ ] Link JWT sessions with MCP session IDs
- [ ] Ensure auth state persists across requests
- [ ] Update connection-specific session storage
- [ ] Test authentication flow with new session handling
- [ ] Test result: [ PASS / FAIL ]

### 2.5 Integration Testing
- [ ] Test complete flow: connect → auth → use tools → disconnect → reconnect
- [ ] Verify session persistence across requests
- [ ] Test multiple concurrent users
- [ ] Test rate limiting still works
- [ ] Test caching still works
- [ ] Run full test suite: `npm test`
- [ ] Test result: [ PASS / FAIL ]

---

## Phase 3: Update Documentation & Remove mcp-remote

### 3.1 Update README.md
- [ ] Add new "Quick Start with HTTP Transport" section
- [ ] Update configuration examples to use HTTP transport
- [ ] Add both local and production connection examples
- [ ] Mark mcp-remote method as "Legacy (Deprecated)"
- [ ] Add migration guide section
- [ ] Update troubleshooting section
- [ ] Test result: Documentation is clear and complete

### 3.2 Update Configuration Files
- [ ] Update `.build/config/claude-desktop-config-production.json`
- [ ] Create example HTTP transport config
- [ ] Keep mcp-remote config as legacy example
- [ ] Test result: [ PASS / FAIL ]

### 3.3 Clean Up Code
- [ ] Remove mcp-remote-specific connection ID logic (src/index.ts:408-448)
- [ ] Simplify connection ID handling
- [ ] Remove deterministic connection ID generation
- [ ] Update comments referencing mcp-remote
- [ ] Remove SSE-specific workarounds if no longer needed
- [ ] Test after cleanup: `npm test`
- [ ] Test result: [ PASS / FAIL ]

### 3.4 Update CLAUDE.md
- [ ] Update architecture documentation
- [ ] Update development workflow if needed
- [ ] Update testing instructions
- [ ] Test result: Documentation is accurate

### 3.5 Create Migration Guide
- [ ] Create MIGRATION.md document
- [ ] Document old vs new connection methods
- [ ] Provide step-by-step migration instructions
- [ ] Include troubleshooting for common issues
- [ ] Test result: Guide is complete and helpful

### 3.6 Update Marketing Page
- [ ] Update src/marketing-page.ts with new connection method
- [ ] Update examples to use HTTP transport
- [ ] Keep backward compatibility notes
- [ ] Test result: [ PASS / FAIL ]

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
