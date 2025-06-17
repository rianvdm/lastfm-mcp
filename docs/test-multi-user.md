# Multi-User Authentication Testing Guide

## Test Scenario 1: Multiple Browser Sessions

### Setup

1. Open 3 different browser windows/incognito sessions
2. In each session, simulate a different MCP connection

### Test Steps

**Session A (User A):**

1. Visit: `http://localhost:8787/login?connection_id=test-user-a`
2. Complete OAuth flow with Last.fm Account A
3. Note the success message

**Session B (User B):**

1. Visit: `http://localhost:8787/login?connection_id=test-user-b`
2. Complete OAuth flow with Last.fm Account B
3. Note the success message

**Session C (User C):**

1. Visit: `http://localhost:8787/login?connection_id=test-user-c`
2. Complete OAuth flow with Last.fm Account C
3. Note the success message

### Verification

- Each user should see their own authentication success
- Sessions should not interfere with each other
- Each gets a unique connection ID

## Test Scenario 2: Data Isolation Testing

### MCP Tool Calls

For each authenticated session, test:

```bash
# User A
curl -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  -H "X-Connection-ID: test-user-a" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "lastfm_auth_status",
      "arguments": {}
    }
  }'

# User B
curl -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  -H "X-Connection-ID: test-user-b" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "lastfm_auth_status",
      "arguments": {}
    }
  }'
```

### Expected Results

- User A sees: "Connected Last.fm Account: [User A's username]"
- User B sees: "Connected Last.fm Account: [User B's username]"
- No cross-contamination of data

## Test Scenario 3: Session Storage Verification

### Check KV Storage

If you have access to Cloudflare dashboard or wrangler:

```bash
# List all sessions
wrangler kv:key list --binding=MCP_SESSIONS

# Check specific sessions
wrangler kv:key get "session:test-user-a" --binding=MCP_SESSIONS
wrangler kv:key get "session:test-user-b" --binding=MCP_SESSIONS
```

### Expected Results

- Each user has their own `session:${connectionId}` entry
- Each session contains different userId/accessToken
- No shared data between sessions

## Test Scenario 4: Connection Cleanup

### Inactive Connection Test

1. Create a connection: `test-user-cleanup`
2. Authenticate successfully
3. Wait 31 minutes (or modify timeout for testing)
4. Verify connection is cleaned up

### Expected Results

- Inactive connections removed after timeout
- KV sessions remain until TTL expires
- New connections work normally

## Test Scenario 5: Error Handling

### Unauthenticated Access

```bash
curl -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  -H "X-Connection-ID: unauth-user" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_recent_tracks",
      "arguments": {"limit": 10}
    }
  }'
```

### Expected Results

- Returns authentication error
- Provides connection-specific login URL
- Does not access any user's data

## Test Scenario 6: Concurrent Access

### Simultaneous Requests

Send multiple requests at the same time from different connection IDs:

```bash
# Terminal 1
for i in {1..5}; do
  curl -X POST http://localhost:8787/ \
    -H "X-Connection-ID: test-user-a" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":'$i',"method":"tools/call","params":{"name":"ping","arguments":{}}}' &
done

# Terminal 2
for i in {1..5}; do
  curl -X POST http://localhost:8787/ \
    -H "X-Connection-ID: test-user-b" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":'$i',"method":"tools/call","params":{"name":"ping","arguments":{}}}' &
done
```

### Expected Results

- All requests succeed
- No race conditions or data mixing
- Each user gets their own responses

## Success Criteria

✅ **Session Isolation**: Each user only sees their own data  
✅ **Concurrent Safety**: Multiple users can use the server simultaneously  
✅ **Authentication Security**: Unauthenticated users cannot access protected data  
✅ **Connection Management**: Proper cleanup of inactive connections  
✅ **Error Handling**: Graceful handling of invalid/missing authentication  
✅ **Performance**: No degradation with multiple users
