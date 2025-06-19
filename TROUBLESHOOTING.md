# OAuth Integration Troubleshooting Guide

## Current Issue: Missing Authorization Code

### Error Message
```
{"type":"error","error":{"type":"invalid_request_error","message":"code: Field required"}}
```

### What This Means
Claude Desktop is reaching our OAuth callback endpoint but not receiving the required authorization code parameter. This suggests the OAuth flow is breaking somewhere.

## Debugging Steps

### 1. Manual Flow Test
Visit this URL in your browser:
```
https://lastfm-mcp.rian-db8.workers.dev/oauth/authorize?client_id=d41921d91d668bb980299213361fa342&redirect_uri=https://claude.ai/oauth/callback&response_type=code&scope=read:listening_history&state=debug123
```

**Expected behavior:**
1. ✅ Shows consent page with "Authorize Debug Test Client"
2. ✅ Click "Authorize" → redirects to Last.fm login
3. ❓ Complete Last.fm authentication
4. ❓ Redirected back with authorization code

### 2. Potential Issues

#### Issue A: Last.fm Authentication Required
**Problem:** Claude Desktop users might not have Last.fm accounts or might not want to authenticate with Last.fm.

**Solution:** We need to provide a demo/test mode that doesn't require real Last.fm authentication.

#### Issue B: OAuth Flow Mismatch
**Problem:** Claude Desktop might expect a different OAuth flow pattern.

**Solution:** Simplify the OAuth flow to be more standard.

#### Issue C: Callback URL Issues
**Problem:** The callback parameters might not be properly preserved through the Last.fm authentication flow.

**Solution:** Ensure all OAuth parameters are correctly passed through the authentication chain.

### 3. Quick Fixes to Try

#### Option 1: Add Demo Mode
Allow OAuth flow without Last.fm authentication for testing:

```typescript
// In authorization endpoint
if (scope?.includes('demo') || clientName?.includes('test')) {
  // Skip Last.fm auth, generate code directly
  const authCode = generateAuthorizationCode()
  // Store demo user data
  // Redirect with code
}
```

#### Option 2: Simplify Scope Requirements
Reduce to absolute minimum:

```json
{
  "oauth": {
    "scopes": [
      {
        "name": "read:profile",
        "description": "Access basic profile information"
      }
    ]
  }
}
```

#### Option 3: Add Error Handling
Ensure all error cases redirect properly to Claude Desktop with error parameters.

### 4. Debug Information Needed

To debug further, we need:

1. **Cloudflare Worker logs** during the OAuth flow
2. **Last.fm callback parameters** (what Last.fm actually sends back)
3. **Claude Desktop behavior** (what exactly it sends in requests)

### 5. Immediate Action Plan

1. **Check if consent page loads** ✅
2. **Check if Last.fm redirect works** ❓
3. **Check if Last.fm callback receives token** ❓
4. **Check if authorization code is generated** ❓
5. **Check if Claude receives the code** ❌

The issue is likely in steps 3-4 where the Last.fm authentication and callback handling occurs.

## Next Steps

1. **Try the manual flow** to see where it breaks
2. **Check Cloudflare Worker logs** for detailed error information
3. **Consider implementing demo mode** for easier testing
4. **Simplify OAuth scope requirements** if needed

The OAuth infrastructure is solid - we just need to identify where the authentication flow is failing.