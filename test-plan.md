# Last.fm MCP OAuth Migration - Comprehensive Test Plan

## Overview

This test plan validates each component of the OAuth + MCP integration systematically before proceeding to the next layer. We'll test from the ground up to ensure each piece works before building on it.

## Test Environment Setup

### Prerequisites
- Local development server running: `npm run dev` (ask human to start and manage)
- Browser for manual testing
- curl/Postman for API testing
- MCP Inspector for protocol testing

### Test Data
- **Test Client Name**: "LastFM-MCP-Test-Client"
- **Test Redirect URI**: "http://localhost:5173/callback"
- **Test User**: Your Last.fm username
- **Base URL**: "http://localhost:8787"

## Phase 1: OAuth Infrastructure Validation

### Test 1.1: Dynamic Client Registration
**Objective**: Verify OAuth clients can register successfully

**Test Steps**:
```bash
# 1. Register a test client
curl -X POST http://localhost:8787/oauth/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "LastFM-MCP-Test-Client",
    "redirect_uris": ["http://localhost:5173/callback"],
    "scope": "lastfm:read lastfm:profile"
  }'
```

**Expected Result**:
- Status: 200 OK
- Response contains: `client_id`, `client_secret`, `client_name`
- Client stored in OAUTH_KV storage

**Validation Commands**:
```bash
# Check if client was stored (if KV CLI available)
wrangler kv:key get "client:{CLIENT_ID}" --binding=OAUTH_KV
```

**Success Criteria**: ✅ Client registration returns valid credentials

---

### Test 1.2: Authorization Flow Initiation  
**Objective**: Verify authorization endpoint redirects to Last.fm correctly

**Test Steps**:
```bash
# 1. Initiate authorization (replace CLIENT_ID with result from 1.1)
curl -v "http://localhost:8787/oauth/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri=http://localhost:5173/callback&state=test123&scope=lastfm:read"
```

**Expected Result**:
- Status: 302 Redirect
- Location header points to Last.fm auth URL
- State parameter preserved in Last.fm URL

**Manual Browser Test**:
1. Visit the authorization URL in browser
2. Should redirect to Last.fm
3. Complete Last.fm authentication
4. Should redirect back with authorization code

**Success Criteria**: ✅ Authorization flow redirects properly and preserves state

---

### Test 1.3: Token Exchange
**Objective**: Verify authorization codes can be exchanged for access tokens

**Test Steps**:
```bash
# 1. Use authorization code from 1.2 (replace with actual values)
curl -X POST http://localhost:8787/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code={AUTHORIZATION_CODE}&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&redirect_uri=http://localhost:5173/callback"
```

**Expected Result**:
- Status: 200 OK
- Response contains: `access_token`, `token_type: "Bearer"`, `expires_in`
- Token stored and accessible

**Success Criteria**: ✅ Authorization codes exchange for valid Bearer tokens

---

### Test 1.4: Bearer Token Authentication
**Objective**: Verify Bearer tokens authenticate access to protected endpoints

**Test Steps**:
```bash
# 1. Test protected endpoint with Bearer token (use token from 1.3)
curl -H "Authorization: Bearer {ACCESS_TOKEN}" http://localhost:8787/sse
```

**Expected Result**:
- Status: 200 OK (for GET request to SSE endpoint)
- No 401 Unauthorized errors
- Response indicates OAuth-protected endpoint

**Success Criteria**: ✅ Bearer tokens provide access to protected endpoints

---

## Phase 2: MCP Protocol Integration

### Test 2.1: MCP Protocol with OAuth
**Objective**: Verify MCP JSON-RPC works with OAuth Bearer tokens

**Test Steps**:
```bash
# 1. Test MCP initialize with Bearer token
curl -X POST http://localhost:8787/sse \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test-client", "version": "1.0.0"}
    }
  }'
```

**Expected Result**:
- Status: 200 OK
- Valid MCP initialize response
- Server capabilities listed

**Test Steps 2**:
```bash
# 2. Test tools/list with Bearer token
curl -X POST http://localhost:8787/sse \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

**Expected Result**:
- Status: 200 OK
- List of 14 Last.fm tools returned
- No authentication errors

**Success Criteria**: ✅ MCP protocol works with OAuth Bearer tokens

---

### Test 2.2: OAuth User Context Flow
**Objective**: Verify OAuth user context flows to MCP handlers correctly

**Test Steps**:
```bash
# 1. Test authenticated tool that requires user context
curl -X POST http://localhost:8787/sse \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "get_auth_status",
      "arguments": {}
    }
  }'
```

**Expected Result**:
- Status: 200 OK
- Response shows authenticated user
- User ID matches OAuth token user

**Success Criteria**: ✅ OAuth user context flows to MCP tool handlers

---

## Phase 3: Last.fm Integration Validation

### Test 3.1: Real Last.fm Session Integration
**Objective**: Verify OAuth tokens include real Last.fm session keys

**Test Steps**:
```bash
# 1. Test Last.fm API call through MCP with OAuth token
curl -X POST http://localhost:8787/sse \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "get_recent_tracks",
      "arguments": {"limit": 5}
    }
  }'
```

**Expected Result**:
- Status: 200 OK
- Real Last.fm listening data returned
- No "session key required" errors

**Success Criteria**: ✅ OAuth tokens enable real Last.fm API calls

---

### Test 3.2: Last.fm API Coverage
**Objective**: Verify all Last.fm tools work with OAuth authentication

**Test Commands**: Test each tool systematically:
```bash
# Artist info (public)
curl -X POST http://localhost:8787/sse \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "get_artist_info", "arguments": {"artist": "Radiohead"}}}'

# User's top artists (requires auth)
curl -X POST http://localhost:8787/sse \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "get_top_artists", "arguments": {"period": "7day", "limit": 10}}}'
```

**Success Criteria**: ✅ All Last.fm tools work with OAuth authentication

---

## Phase 4: Error Handling Validation

### Test 4.1: Invalid Token Handling
**Objective**: Verify proper error responses for invalid tokens

**Test Steps**:
```bash
# 1. Test with invalid Bearer token
curl -X POST http://localhost:8787/sse \
  -H "Authorization: Bearer invalid-token-12345" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 7, "method": "initialize", "params": {}}'
```

**Expected Result**:
- Status: 401 Unauthorized
- Clear error message about invalid token

**Success Criteria**: ✅ Invalid tokens properly rejected

---

### Test 4.2: Token Expiration Handling  
**Objective**: Verify expired tokens are handled gracefully

**Test Steps**:
```bash
# 1. Wait for token to expire (or manually invalidate in KV)
# 2. Test with expired token
curl -X POST http://localhost:8787/sse \
  -H "Authorization: Bearer {EXPIRED_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 8, "method": "tools/list", "params": {}}'
```

**Expected Result**:
- Status: 401 Unauthorized  
- Error indicates token expiration

**Success Criteria**: ✅ Expired tokens properly handled

---

## Phase 5: Claude Desktop Integration

### Test 5.1: Local Claude Desktop Configuration
**Objective**: Test Claude Custom Integration configuration locally

**Configuration**:
```json
{
  "customIntegrations": {
    "lastfm-local": {
      "name": "Last.fm Music Data (Local)",
      "url": "http://localhost:8787/sse"
    }
  }
}
```

**Test Steps**:
1. Configure Claude Desktop with local URL
2. Attempt to connect to integration
3. Complete OAuth flow through Claude interface
4. Test tool usage in Claude conversation

**Success Criteria**: ✅ Claude Desktop can connect and authenticate locally

---

### Test 5.2: End-to-End Claude Integration
**Objective**: Complete validation of Claude → OAuth → Last.fm flow

**Test Steps**:
1. Start fresh Claude conversation
2. Try to use Last.fm integration
3. Complete OAuth authentication when prompted
4. Verify tools work in conversation context
5. Test multiple tool calls in same conversation

**Success Criteria**: ✅ Complete OAuth flow works end-to-end in Claude Desktop

---

## Test Execution Tracking

### Phase 1 Results:
- [ ] Test 1.1: Dynamic Client Registration
- [ ] Test 1.2: Authorization Flow Initiation  
- [ ] Test 1.3: Token Exchange
- [ ] Test 1.4: Bearer Token Authentication

### Phase 2 Results:
- [ ] Test 2.1: MCP Protocol with OAuth
- [ ] Test 2.2: OAuth User Context Flow

### Phase 3 Results:
- [ ] Test 3.1: Real Last.fm Session Integration
- [ ] Test 3.2: Last.fm API Coverage

### Phase 4 Results:
- [ ] Test 4.1: Invalid Token Handling
- [ ] Test 4.2: Token Expiration Handling

### Phase 5 Results:
- [ ] Test 5.1: Local Claude Desktop Configuration
- [ ] Test 5.2: End-to-End Claude Integration

## Failure Investigation Protocol

When any test fails:

1. **Stop immediately** - Don't proceed to next phase
2. **Capture logs** - Save all server console output
3. **Document the failure** - What was expected vs actual
4. **Investigate root cause** - Check OAuth provider logs, KV storage, etc.
5. **Fix the issue** - Make minimal changes to address root cause
6. **Re-test from the beginning** - Ensure fix doesn't break earlier tests
7. **Update TODO.md** - Mark issues resolved before proceeding

## Success Criteria for Migration

✅ **All Phase 1-4 tests pass** - OAuth infrastructure is solid
✅ **Phase 5 tests pass** - Claude integration works end-to-end  
✅ **No regressions** - Existing Last.fm functionality preserved
✅ **Performance acceptable** - Response times comparable to current implementation

Only when ALL tests pass should we consider the migration successful and ready for production deployment.