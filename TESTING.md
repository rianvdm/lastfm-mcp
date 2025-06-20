# Real-World Testing Guide

This document provides comprehensive testing approaches for the Last.fm MCP server with OAuth 2.1 integration before production deployment.

## Prerequisites

1. **Development server running**: `npm run dev`
2. **Valid Last.fm API credentials** in `.dev.vars`
3. **All KV namespaces created** in Cloudflare dashboard

## Testing Levels

### 1. Basic OAuth Flow Testing

Tests the complete OAuth 2.1 authentication flow:

```bash
# Start dev server
npm run dev

# In another terminal, test OAuth flow
node scripts/test-oauth-flow.js
```

**What this tests:**
- OAuth Dynamic Client Registration
- Authorization URL generation  
- Server health endpoints
- Manual authorization flow (opens browser)
- Token exchange (with manual auth code)
- MCP calls with bearer tokens

### 2. Real Last.fm API Integration

Tests actual Last.fm API calls with real data:

```bash
# Test public endpoints (no auth required)
node scripts/test-real-lastfm.js

# Test with access token from OAuth flow
ACCESS_TOKEN=<your-token> node scripts/test-real-lastfm.js
```

**What this tests:**
- Public Last.fm tools (search, artist/track info)
- Authenticated Last.fm tools (user data, scrobbles)
- Rate limiting behavior
- Real API responses and error handling

### 3. Legacy Multi-User Tests (Deprecated)

The existing multi-user test needs updating for OAuth:

```bash
# This will fail with current OAuth implementation
npm run test:multi-user
```

**Status**: ❌ Needs updating for OAuth (currently tests old session system)

### 4. Unit Tests 

```bash
# Run Vitest unit tests
npm test
```

**Status**: ❌ Needs updating for OAuth (currently tests old worker entry point)

## Manual Testing Scenarios

### Scenario 1: Claude Desktop Simulation

1. **Register OAuth client** (simulates Claude Desktop):
   ```bash
   curl -X POST http://localhost:8787/oauth/register \
     -H "Content-Type: application/json" \
     -d '{
       "client_name": "Claude Desktop Test",
       "redirect_uris": ["http://localhost:3000/callback"],
       "grant_types": ["authorization_code"],
       "scope": "mcp.read mcp.write lastfm.connect"
     }'
   ```

2. **Get authorization URL** and open in browser
3. **Complete Last.fm authentication**
4. **Extract authorization code** from callback URL
5. **Exchange code for tokens**
6. **Test MCP calls** with bearer token

### Scenario 2: Error Conditions

Test these error scenarios manually:

- **Invalid client ID** in authorization
- **Missing bearer token** in MCP calls
- **Expired tokens** (wait for expiry)
- **Invalid Last.fm credentials**
- **Rate limiting** (rapid requests)
- **Network timeouts**

### Scenario 3: Last.fm Integration

1. **Test with real Last.fm account**:
   - Use your actual Last.fm username
   - Complete OAuth flow with real credentials
   - Verify all personal data tools work

2. **Test edge cases**:
   - Empty listening history
   - Private profiles
   - Users with no scrobbles
   - Very large libraries

## Production Readiness Checklist

Before deploying to production, verify:

### ✅ OAuth Implementation
- [ ] Dynamic client registration works
- [ ] Authorization flow completes successfully  
- [ ] Token exchange returns valid access tokens
- [ ] Bearer token authentication works for MCP calls
- [ ] PKCE flow works (code challenge/verifier)

### ✅ Last.fm Integration  
- [ ] All 15 Last.fm tools work with real data
- [ ] Error handling for API failures
- [ ] Rate limiting respects Last.fm limits
- [ ] Caching reduces API calls appropriately

### ✅ Security
- [ ] Tokens are properly encrypted in KV storage
- [ ] Session isolation between users
- [ ] No secrets logged in console
- [ ] CORS headers configured correctly

### ✅ Performance
- [ ] Response times under 2 seconds
- [ ] Concurrent requests handled properly
- [ ] Memory usage stays reasonable
- [ ] KV operations don't timeout

### ✅ Error Handling
- [ ] Graceful degradation for API failures
- [ ] Clear error messages for users
- [ ] No server crashes on invalid input
- [ ] Proper HTTP status codes

## Troubleshooting Common Issues

### OAuth Flow Fails

1. Check KV namespace configuration in `wrangler.toml`
2. Verify `OAUTH_KV` binding exists in Cloudflare
3. Check browser console for CORS errors
4. Validate redirect URIs match exactly

### Last.fm API Errors

1. Verify API key/secret in `.dev.vars`
2. Check Last.fm API status page
3. Review rate limiting in CloudflareKV
4. Test with `curl` directly to Last.fm API

### MCP Processing Errors  

1. Validate JSON-RPC message format
2. Check bearer token format and expiry
3. Review server logs for parsing errors
4. Test with minimal MCP client

## Next Steps After Testing

Once all tests pass:

1. **Update README** with Claude Desktop configuration
2. **Deploy to production** with confidence
3. **Monitor production logs** for issues
4. **Set up alerts** for error rates

## Testing Scripts Overview

- `test-oauth-flow.js` - Complete OAuth 2.1 flow testing
- `test-real-lastfm.js` - Real Last.fm API integration testing  
- `test-multi-user.js` - Legacy multi-user testing (needs OAuth update)

Run these scripts against your development server to ensure everything works before production deployment.