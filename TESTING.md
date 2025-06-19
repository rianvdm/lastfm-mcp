# Testing OAuth Implementation

## 🚀 Quick Browser Test (Recommended)

1. **Start the server:**
   ```bash
   npm run dev
   ```

2. **Register a test client:**
   ```bash
   curl -X POST http://localhost:8787/oauth/register \
     -H "Content-Type: application/json" \
     -d '{
       "client_name": "Test Client",
       "redirect_uris": ["https://example.com/callback"],
       "scope": "read:listening_history"
     }'
   ```
   
   Save the `client_id` from the response.

3. **Visit the consent page in your browser:**
   ```
   http://localhost:8787/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=https://example.com/callback&response_type=code&scope=read:listening_history&state=test
   ```

4. **You should see:**
   - ✅ Beautiful OAuth consent page with Last.fm branding
   - ✅ "Test Client" requesting permissions
   - ✅ "Authorize" and "Cancel" buttons

5. **Click "Authorize":**
   - ✅ Should redirect to Last.fm login page
   - ✅ URL should contain our callback parameters

## 🧪 Automated Testing

### Unit Tests
```bash
# Test OAuth endpoints
npx vitest --run test/oauth/

# Test complete suite  
npm test
```

### Integration Tests
```bash
# Test with realistic Claude Desktop flow
./test_oauth_flow.sh
```

## 🔗 Manual Flow Testing

### Step 1: Integration Manifest
```bash
curl -s http://localhost:8787/.well-known/integration-manifest | jq .
```

Should show OAuth configuration with authorization_url, token_url, etc.

### Step 2: Client Registration
```bash
curl -X POST http://localhost:8787/oauth/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Claude Desktop",
    "redirect_uris": ["https://claude.ai/oauth/callback"],
    "scope": "read:listening_history read:recommendations"
  }'
```

### Step 3: Authorization Endpoint
```bash
# Should return HTML consent page
curl -s "http://localhost:8787/oauth/authorize?client_id=CLIENT_ID&redirect_uri=https://claude.ai/oauth/callback&response_type=code&scope=read:listening_history"
```

### Step 4: Token Exchange Test
```bash
# Create auth code first (simulate Last.fm callback)
# Then test token endpoint
curl -X POST http://localhost:8787/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=AUTH_CODE&client_id=CLIENT_ID&client_secret=CLIENT_SECRET&redirect_uri=https://claude.ai/oauth/callback"
```

## 🎭 Simulating Claude Desktop

To simulate what Claude Desktop would do:

1. **Discover Integration:**
   - GET `/.well-known/integration-manifest`
   - Parse OAuth endpoints

2. **Register Client:**
   - POST `/oauth/register` with Claude's details

3. **Authorization Flow:**
   - Redirect user to `/oauth/authorize?...`
   - User sees consent page and approves
   - User redirected to Last.fm, then back to Claude

4. **Token Exchange:**
   - POST `/oauth/token` to exchange code for Bearer token

5. **API Access:**
   - Use Bearer token with MCP endpoints

## 🐛 Troubleshooting

### Common Issues:

1. **405 Method Not Allowed:**
   - Check URL parameters are properly encoded
   - Ensure using GET for authorization endpoint

2. **Invalid Client:**
   - Verify client_id from registration response
   - Check redirect_uri matches exactly

3. **Consent page not showing:**
   - Check browser developer tools for JavaScript errors
   - Verify all parameters are present

### Debug Commands:

```bash
# Check server is running
curl -I http://localhost:8787/

# Test basic authorization endpoint
curl -I "http://localhost:8787/oauth/authorize?client_id=test"

# View server logs
# Look for error messages in terminal running npm run dev
```

## ✅ Success Criteria

The OAuth implementation is working correctly when:

- [x] Integration manifest includes OAuth configuration
- [x] Client registration returns valid credentials  
- [x] Authorization endpoint shows HTML consent page (not redirect)
- [x] Consent approval redirects to Last.fm with parameters preserved
- [x] Token endpoint exchanges codes for Bearer tokens
- [x] Bearer tokens work with MCP endpoints
- [x] All unit tests pass

## 🚀 Production Testing

For production testing, deploy to Cloudflare Workers:

```bash
npm run deploy
```

Then test with the production URL instead of localhost:8787.