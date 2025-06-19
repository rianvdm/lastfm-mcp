# Supporting Claude Integrations Natively

## Executive Summary

This document outlines the requirements and implementation path for making the Last.fm MCP server work natively with Claude Integrations, eliminating the need for mcp-remote as an intermediary. Currently, our MCP server requires mcp-remote to bridge between local MCP protocols and Claude's remote integration system. Native support would provide a more seamless experience for users and reduce complexity.

## Background

### What are Claude Integrations?

Claude Integrations are a feature that allows Claude (on web and desktop) to connect directly to remote MCP servers. These integrations enable Claude to access external tools and data sources through a standardized protocol. Key features include:

- **OAuth 2.0 Authentication**: Secure user authorization without exposing credentials
- **Remote Access**: Servers are internet-accessible, not limited to local connections
- **Persistent Sessions**: Maintain user context across conversations
- **Tool Discovery**: Claude can automatically discover available tools from the server

### Current Architecture vs Native Integration

**Current Flow (with mcp-remote):**
```
Claude → mcp-remote (local) → Internet → Your MCP Server
```

**Native Integration Flow:**
```
Claude → Internet → Your MCP Server (with OAuth)
```

### Why Native Integration?

1. **Better User Experience**: No need to install or configure mcp-remote
2. **Simplified Deployment**: One less component to maintain
3. **Direct OAuth Flow**: More secure and standard authentication
4. **Official Support**: Listed in Claude's integration directory
5. **Enterprise Ready**: Works with Claude for Teams/Enterprise

## Technical Requirements

### 1. OAuth 2.0 Implementation

The most significant change required is implementing OAuth 2.0 authentication. Currently, our server uses Last.fm's web authentication flow, but Claude Integrations expect a standard OAuth 2.0 flow.

**Required OAuth 2.0 Endpoints:**

```typescript
// Authorization endpoint
GET /oauth/authorize
  ?client_id={client_id}
  &redirect_uri={redirect_uri}
  &response_type=code
  &state={state}
  &scope={requested_scopes}

// Token endpoint
POST /oauth/token
  Content-Type: application/x-www-form-urlencoded
  
  grant_type=authorization_code
  &code={authorization_code}
  &redirect_uri={redirect_uri}
  &client_id={client_id}
  &client_secret={client_secret}

// Token refresh endpoint (optional but recommended)
POST /oauth/token
  Content-Type: application/x-www-form-urlencoded
  
  grant_type=refresh_token
  &refresh_token={refresh_token}
  &client_id={client_id}
  &client_secret={client_secret}
```

**OAuth Flow for Claude:**

1. Claude initiates authorization by opening `/oauth/authorize`
2. User logs in via Last.fm (we keep our existing Last.fm auth)
3. User approves permissions
4. Server redirects back to Claude with authorization code
5. Claude exchanges code for access token at `/oauth/token`
6. Server returns access token that Claude uses for all API calls

### 2. MCP Protocol Changes

**Authentication Header Support:**

```typescript
// All MCP requests from Claude will include:
Authorization: Bearer {access_token}

// Server must validate token on every request
function validateRequest(request: Request): AuthContext {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) throw new Error('Unauthorized');
  
  // Validate JWT and extract user session
  const session = await validateJWT(token);
  return { userId: session.userId, username: session.username };
}
```

**Connection ID Handling:**

Native integrations don't use explicit connection IDs like mcp-remote does. Instead, the OAuth token becomes the session identifier.

### 3. Transport Protocol Requirements

Good news: Our server already supports the required transport protocols!

- ✅ HTTP JSON-RPC (already implemented)
- ✅ Server-Sent Events (already implemented in `/sse`)
- ✅ Proper CORS headers (need to verify configuration)

### 4. Integration Manifest

Claude Integrations require a manifest file that describes the integration:

```json
{
  "name": "Last.fm Music Data",
  "description": "Access your Last.fm listening history and music recommendations",
  "icon_url": "https://your-server.com/icon.png",
  "homepage_url": "https://github.com/your-repo",
  "oauth": {
    "client_id": "your-client-id",
    "authorization_url": "https://your-server.com/oauth/authorize",
    "token_url": "https://your-server.com/oauth/token",
    "scopes": [
      {
        "name": "read:listening_history",
        "description": "Read your Last.fm listening history"
      },
      {
        "name": "read:recommendations",
        "description": "Get music recommendations"
      }
    ]
  },
  "mcp": {
    "endpoint": "https://your-server.com/",
    "sse_endpoint": "https://your-server.com/sse"
  }
}
```

## Implementation Plan

### Phase 1: OAuth 2.0 Infrastructure

1. **Create OAuth Database Schema**
   ```typescript
   // Cloudflare KV namespaces needed:
   - OAUTH_CLIENTS: Store registered OAuth clients
   - OAUTH_CODES: Temporary authorization codes (TTL: 10 minutes)
   - OAUTH_TOKENS: Access tokens linked to user sessions
   ```

2. **Implement OAuth Endpoints**
   - Build `/oauth/authorize` endpoint
   - Build `/oauth/token` endpoint
   - Add token validation middleware

3. **Integrate with Existing Auth**
   - Keep Last.fm authentication as the identity provider
   - Map Last.fm sessions to OAuth tokens
   - Maintain backward compatibility with existing JWT sessions

### Phase 2: Protocol Adaptations

1. **Update Request Handling**
   ```typescript
   // Before (with mcp-remote)
   const connectionId = request.headers.get('x-connection-id');
   const session = await getSessionByConnectionId(connectionId);

   // After (native)
   const token = request.headers.get('Authorization')?.replace('Bearer ', '');
   const session = await getSessionByOAuthToken(token);
   ```

2. **Modify SSE Connection Management**
   - Use OAuth tokens instead of connection IDs
   - Update connection tracking logic

3. **CORS Configuration**
   ```typescript
   // Ensure proper CORS headers for Claude domains
   const ALLOWED_ORIGINS = [
     'https://claude.ai',
     'https://app.claude.ai',
     // Add other Claude domains as needed
   ];
   ```

### Phase 3: Testing & Validation

1. **OAuth Flow Testing**
   - Test authorization code generation
   - Verify token exchange
   - Validate token refresh (if implemented)

2. **Integration Testing**
   - Test with Claude's integration validator (if available)
   - Verify tool discovery works
   - Ensure all MCP commands function properly

3. **Security Audit**
   - Validate OAuth implementation against spec
   - Ensure proper token expiration
   - Check for authorization bypasses

### Phase 4: Registration & Deployment

1. **Prepare for Claude Integration Directory**
   - Create integration manifest
   - Prepare documentation
   - Set up support channels

2. **Production Deployment**
   - Deploy OAuth-enabled version
   - Monitor for issues
   - Maintain backward compatibility during transition

## Code Examples

### OAuth Authorization Endpoint

```typescript
// src/auth/oauth.ts
export async function handleOAuthAuthorize(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');
  const scope = url.searchParams.get('scope');

  // Validate OAuth client
  const client = await env.OAUTH_CLIENTS.get(clientId);
  if (!client) {
    return new Response('Invalid client_id', { status: 400 });
  }

  // Check if user already has Last.fm session
  const session = await getExistingSession(request, env);
  if (!session) {
    // Redirect to Last.fm auth, then back to OAuth flow
    const lastfmAuthUrl = buildLastfmAuthUrl({
      callbackUrl: `/oauth/callback?${url.searchParams}`,
    });
    return Response.redirect(lastfmAuthUrl);
  }

  // Generate authorization code
  const code = generateAuthorizationCode();
  await env.OAUTH_CODES.put(code, JSON.stringify({
    clientId,
    userId: session.userId,
    username: session.username,
    scope,
    redirectUri,
  }), { expirationTtl: 600 }); // 10 minute expiry

  // Redirect back to Claude with code
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', state);
  
  return Response.redirect(callbackUrl.toString());
}
```

### OAuth Token Endpoint

```typescript
// src/auth/oauth.ts
export async function handleOAuthToken(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const grantType = formData.get('grant_type');

  if (grantType === 'authorization_code') {
    const code = formData.get('code');
    const clientId = formData.get('client_id');
    const clientSecret = formData.get('client_secret');

    // Validate client credentials
    const client = await env.OAUTH_CLIENTS.get(clientId);
    if (!client || JSON.parse(client).secret !== clientSecret) {
      return new Response('Invalid client credentials', { status: 401 });
    }

    // Validate authorization code
    const codeData = await env.OAUTH_CODES.get(code as string);
    if (!codeData) {
      return new Response('Invalid authorization code', { status: 400 });
    }

    const { userId, username, scope } = JSON.parse(codeData);

    // Generate access token (JWT)
    const accessToken = await generateJWT({
      userId,
      username,
      scope,
      clientId,
    }, env.JWT_SECRET);

    // Store token mapping for easy lookup
    await env.OAUTH_TOKENS.put(accessToken, JSON.stringify({
      userId,
      username,
      scope,
    }), { expirationTtl: 7 * 24 * 60 * 60 }); // 7 days

    // Clean up used authorization code
    await env.OAUTH_CODES.delete(code as string);

    return new Response(JSON.stringify({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 604800, // 7 days
      scope,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Unsupported grant type', { status: 400 });
}
```

### Updated Request Handler

```typescript
// src/protocol/handlers.ts
export async function handleMCPRequest(request: Request, env: Env): Promise<Response> {
  // Extract bearer token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  
  // Validate token and get session
  const session = await env.OAUTH_TOKENS.get(token);
  if (!session) {
    return new Response('Invalid token', { status: 401 });
  }

  const { userId, username } = JSON.parse(session);

  // Process MCP request with authenticated context
  const mcpRequest = await request.json();
  const response = await processMCPRequest(mcpRequest, {
    userId,
    username,
    isAuthenticated: true,
  });

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': getAllowedOrigin(request),
    },
  });
}
```

## Migration Strategy

### Backward Compatibility

During the transition period, support both authentication methods:

```typescript
async function getAuthContext(request: Request, env: Env): Promise<AuthContext | null> {
  // First, try OAuth token
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const session = await env.OAUTH_TOKENS.get(token);
    if (session) {
      return JSON.parse(session);
    }
  }

  // Fall back to existing JWT/connection ID system
  const connectionId = request.headers.get('x-connection-id');
  if (connectionId) {
    return await getSessionByConnectionId(connectionId, env);
  }

  return null;
}
```

### Rollout Plan

1. **Week 1-2**: Implement OAuth endpoints and token management
2. **Week 3**: Add OAuth support alongside existing auth
3. **Week 4**: Test with Claude integration sandbox
4. **Week 5**: Soft launch with beta users
5. **Week 6**: Full launch and integration directory submission

## Security Considerations

### OAuth Security Best Practices

1. **PKCE (Proof Key for Code Exchange)**: Consider implementing PKCE for additional security
2. **Token Rotation**: Implement refresh tokens for long-lived sessions
3. **Scope Validation**: Strictly validate requested scopes
4. **Rate Limiting**: Apply rate limits to OAuth endpoints
5. **HTTPS Only**: Ensure all OAuth flows use HTTPS

### Example Security Headers

```typescript
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
```

## Resources and References

### Official Documentation
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Building Custom Integrations via Remote MCP Servers](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers)
- [OAuth 2.0 Specification (RFC 6749)](https://datatracker.ietf.org/doc/html/rfc6749)
- [OAuth 2.0 Security Best Practices (RFC 8252)](https://datatracker.ietf.org/doc/html/rfc8252)

### Example Implementations
- [Cloudflare MCP Server Example](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)
- [MCP Server with Azure API Management](https://devblogs.microsoft.com/blog/claude-ready-secure-mcp-apim)

### Tools and Libraries
- [`use-mcp`](https://github.com/modelcontextprotocol/use-mcp) - React hook for MCP clients (for reference)
- [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) - Official MCP SDK

### Testing Tools
- [OAuth 2.0 Playground](https://www.oauth.com/playground/) - Test OAuth flows
- [JWT.io](https://jwt.io/) - Debug JWT tokens
- Postman/Insomnia - Test API endpoints

## Conclusion

Native Claude Integration support would significantly improve the user experience and reduce deployment complexity. The main implementation challenge is adding OAuth 2.0 support while maintaining backward compatibility. The good news is that our server already has most of the required infrastructure (JWT auth, SSE support, proper MCP protocol implementation).

The effort is estimated at 2-3 weeks for a full implementation, including testing and documentation. The benefits include better user experience, official integration status, and simplified deployment architecture.