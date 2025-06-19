# Claude Native Integration Support Implementation Plan

## Executive Summary

This document provides a comprehensive analysis and implementation roadmap for adding native Claude Custom Integrations support to the Last.fm MCP server. This will eliminate the need for mcp-remote as an intermediary and provide users with a seamless, officially supported integration experience.

**Key Benefits:**
- Direct Claude integration without mcp-remote dependency
- Official listing in Claude's integration directory
- Better user experience with native OAuth 2.0 flow
- Enterprise-ready deployment
- Simplified architecture

**Implementation Effort:** Estimated 1-2 weeks for full implementation including testing and documentation (revised down from original 2-3 weeks based on lessons learned from failed claude-native branch attempt).

## Background & Context

### What are Claude Custom Integrations?

Claude Custom Integrations are a beta feature allowing Claude (web and desktop) to connect directly to remote MCP servers over the internet. They provide:

- **OAuth 2.0 Authentication**: Standard secure authorization flow
- **Remote Access**: Internet-accessible servers (no local installation required)
- **Persistent Sessions**: Maintain user context across conversations
- **Tool Discovery**: Automatic discovery of available tools and capabilities
- **Enterprise Support**: Available for Pro, Max, Team, and Enterprise plans

### Current vs Native Architecture

**Current Flow (with mcp-remote):**
```
Claude → mcp-remote (local) → Internet → Last.fm MCP Server
```

**Native Integration Flow:**
```
Claude → Internet → Last.fm MCP Server (OAuth-enabled)
```

### Technical Foundation

Our existing server already provides excellent groundwork:
- ✅ **MCP Protocol**: Full MCP 2024-11-05 specification compliance
- ✅ **Transport Layer**: HTTP JSON-RPC + Server-Sent Events
- ✅ **Authentication**: JWT-based session management
- ✅ **Data Layer**: Last.fm API integration with caching
- ✅ **Cloudflare Workers**: Edge deployment ready for global access

**Missing Component:** OAuth 2.0 authorization server implementation

## Technical Requirements Analysis

### 1. OAuth 2.0 Authorization Server

The most significant requirement is implementing a full OAuth 2.0 authorization server. Claude requires standard OAuth 2.0 flows with these endpoints:

#### Authorization Endpoint
```
GET /oauth/authorize
  ?client_id={client_id}
  &redirect_uri={redirect_uri}
  &response_type=code
  &state={state}
  &scope={requested_scopes}
```

#### Token Endpoint
```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={authorization_code}
&redirect_uri={redirect_uri}
&client_id={client_id}
&client_secret={client_secret}
```

#### Token Validation
```
Authorization: Bearer {access_token}
```

### 2. OAuth Client Registration

Claude requires "Dynamic Client Registration support" per the 3/26 auth specification. This means implementing:

```
POST /oauth/register
Content-Type: application/json

{
  "client_name": "Claude",
  "redirect_uris": ["https://claude.ai/oauth/callback"],
  "scope": "read:listening_history read:recommendations",
  "token_endpoint_auth_method": "client_secret_basic"
}
```

### 3. Integration Manifest

Claude requires a discovery manifest describing the integration:

```json
{
  "name": "Last.fm Music Data",
  "description": "Access your Last.fm listening history and music recommendations",
  "icon_url": "https://lastfm-mcp.example.com/icon.png",
  "homepage_url": "https://github.com/your-repo/lastfm-mcp",
  "oauth": {
    "authorization_url": "https://lastfm-mcp.example.com/oauth/authorize",
    "token_url": "https://lastfm-mcp.example.com/oauth/token",
    "client_registration_url": "https://lastfm-mcp.example.com/oauth/register",
    "scopes": [
      {
        "name": "read:listening_history",
        "description": "Access your Last.fm listening history and statistics"
      },
      {
        "name": "read:recommendations", 
        "description": "Generate music recommendations based on your taste"
      },
      {
        "name": "read:social",
        "description": "Access your Last.fm friends and social features"
      }
    ]
  },
  "mcp": {
    "endpoint": "https://lastfm-mcp.example.com/",
    "sse_endpoint": "https://lastfm-mcp.example.com/sse"
  }
}
```

### 4. MCP Protocol Adaptations

#### Bearer Token Authentication
All MCP requests from Claude will include:
```
Authorization: Bearer {access_token}
```

#### Connection Management
- Replace connection ID system with OAuth token-based sessions
- Map OAuth tokens to user sessions in Cloudflare KV
- Maintain session state per OAuth token

#### CORS Configuration
Ensure proper CORS headers for Claude domains:
```typescript
const ALLOWED_ORIGINS = [
  'https://claude.ai',
  'https://app.claude.ai',
  'https://desktop.claude.ai'
];
```

## Lessons Learned from Failed Implementation

### Analysis of claude-native Branch Attempt

The claude-native branch represented a substantial OAuth 2.0 implementation effort with 69 tests written and most functionality working correctly. However, it failed due to several critical issues that provide important lessons:

#### 1. **Primary Issue: Error Handling Logic Bug (31 failing tests)**

**Problem**: The main error handling logic in `src/index.ts` had a flawed type detection:

```typescript
// Broken logic in claude-native branch:
if (error instanceof Error && error.message.includes('OAuth')) {
  // Handle as OAuth error
}

// But OAuthError instances don't include "OAuth" in their message!
// So OAuth errors fell through to generic 500 responses
```

**Root Cause**: The `OAuthError` class used `this.description || this.error` as the message, so messages like "Client not found" or "Authorization code expired" didn't contain "OAuth".

**Impact**: Tests expecting specific OAuth status codes (400/401) received generic 500 errors instead.

**Lesson**: Always test error handling paths thoroughly and use proper type checking (`error instanceof OAuthError`) rather than string matching.

#### 2. **Integration Issues with Existing Architecture**

**Problems Identified**:
- OAuth endpoints were added but SSE endpoint OAuth integration was incomplete
- Some validation logic conflicts with existing authentication flow
- Missing bearer token support in several handler paths

**Lesson**: OAuth integration must be comprehensive across all authentication touchpoints, not just the main endpoints.

#### 3. **Test Environment Configuration Issues**

**Problems**:
- KV namespace mismatches between test and development environments  
- Some integration tests failed due to environment setup rather than code logic
- OAuth flows worked in isolation but failed in integrated scenarios

**Lesson**: Environment configuration and test setup must be consistent and reliable before implementing complex features.

#### 4. **What Actually Worked Well**

Despite the failures, significant OAuth infrastructure was successfully implemented:

✅ **Fully Working Components**:
- OAuth client registration and management (`registerOAuthClient`)
- Authorization code generation and storage (`generateAuthorizationCode`)
- Access token creation and JWT signing (`generateJWT`)
- Bearer token authentication in MCP handlers (`verifyAuthentication`)
- Dynamic Client Registration (RFC 7591) compliance
- Backward compatibility with existing cookie-based auth
- CORS configuration for Claude domains
- Comprehensive OAuth metadata endpoints
- Proper KV namespace setup and data flow

✅ **Architectural Decisions That Were Correct**:
- Using existing Last.fm authentication as identity provider
- JWT-based access tokens stored in KV namespaces
- Separate OAuth storage namespaces (OAUTH_CLIENTS, OAUTH_CODES, OAUTH_TOKENS)
- Integration with existing session management
- Comprehensive test coverage approach

### Revised Implementation Strategy

Based on the failed attempt analysis, here's the corrected approach:

#### Phase 1: Fix Core Error Handling (Week 1)

**1.1 Correct Error Detection Logic**
```typescript
// Fixed error handling in src/index.ts
if (error instanceof OAuthError) {
  return new Response(
    JSON.stringify({
      error: error.error,
      error_description: error.description || error.message,
    }),
    {
      status: error.statusCode,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}
```

**1.2 Environment Consistency**
- Ensure KV namespaces are properly configured across all environments
- Add comprehensive environment validation
- Create setup scripts that verify OAuth infrastructure

**1.3 SSE Endpoint OAuth Integration**
```typescript
// Add Bearer token support to SSE endpoint
async function handleSSEConnection(request: Request, env: Env): Promise<Response> {
  const authContext = await authenticateRequest(request, env);
  if (!authContext) {
    return new Response('Unauthorized', { 
      status: 401,
      headers: {
        'WWW-Authenticate': 'Bearer realm="OAuth"'
      }
    });
  }
  
  // Use OAuth token as connection identifier
  const connectionId = await hashToken(
    request.headers.get('Authorization')?.slice(7) || ''
  );
  
  // Continue with SSE setup...
}
```

#### Phase 2: Comprehensive Integration Testing (Week 1)

**2.1 OAuth Flow End-to-End Tests**
- Test complete authorization code flow from start to finish
- Verify token exchange works with real Claude-like requests
- Test Bearer token authentication across all MCP endpoints

**2.2 Environment-Specific Testing**
- Run tests against development and staging environments
- Verify KV operations work correctly in all environments
- Test OAuth flows with real external redirect URIs

**2.3 Error Path Testing**  
- Test all OAuth error scenarios with correct status codes
- Verify error messages match OAuth 2.0 specification
- Test rate limiting and security validations

#### Phase 3: Claude Integration Preparation (Week 2)

**3.1 Integration Manifest Refinement**
```json
{
  "name": "Last.fm Music Data",
  "description": "Access your Last.fm listening history, get music recommendations, and explore your musical taste profile",
  "oauth": {
    "authorization_url": "https://lastfm-mcp-prod.rian-db8.workers.dev/oauth/authorize",
    "token_url": "https://lastfm-mcp-prod.rian-db8.workers.dev/oauth/token",
    "client_registration_url": "https://lastfm-mcp-prod.rian-db8.workers.dev/oauth/register",
    "scopes": [
      {
        "name": "read:listening_history",
        "description": "Access your Last.fm scrobbles, top tracks, albums, and artists"
      },
      {
        "name": "read:recommendations",
        "description": "Generate personalized music recommendations based on your taste"
      }
    ]
  },
  "mcp": {
    "endpoint": "https://lastfm-mcp-prod.rian-db8.workers.dev/",
    "sse_endpoint": "https://lastfm-mcp-prod.rian-db8.workers.dev/sse"
  }
}
```

**3.2 MCP Inspector Validation**
- Use MCP Inspector to validate complete protocol compliance
- Test OAuth + MCP integration end-to-end
- Verify all tools, resources, and prompts work with Bearer tokens

**3.3 Security Audit**
- Review OAuth implementation against security best practices
- Test PKCE implementation if needed for Claude Desktop
- Validate token expiration and revocation

#### Critical Success Factors (Revised)

**1. Test-Driven Development**
- Write integration tests FIRST before implementing OAuth endpoints
- Test OAuth error scenarios comprehensively
- Use real-world OAuth flows in testing

**2. Environment Validation**
- Verify all KV namespaces exist and are accessible
- Test OAuth flows in production-like environments
- Validate CORS configuration with actual Claude domains

**3. Error Handling Excellence**
- Use proper TypeScript type checking for error detection
- Return correct OAuth 2.0 status codes and error formats
- Test all error paths thoroughly

**4. Incremental Integration**
- Start with minimal OAuth implementation
- Add Bearer token support incrementally to each endpoint
- Maintain backward compatibility throughout

### Implementation Complexity Assessment

**Updated Timeline**: 1-2 weeks (reduced from 2-3 weeks)

**Why Shorter**: The hard work was already done in the claude-native branch. The core OAuth infrastructure is solid and just needs:
1. Simple error handling fix (1-2 days)
2. SSE endpoint OAuth integration (2-3 days)  
3. Comprehensive testing and validation (3-5 days)
4. Claude integration testing (2-3 days)

**Risk Level**: Medium → Low (most complex parts already implemented and tested)

## Implementation Architecture

### Database Schema (Cloudflare KV)

```typescript
// OAuth Client Registry
OAUTH_CLIENTS = {
  [client_id]: {
    client_secret: string;
    client_name: string;
    redirect_uris: string[];
    scopes: string[];
    created_at: string;
  }
}

// Authorization Codes (TTL: 10 minutes)
OAUTH_CODES = {
  [code]: {
    client_id: string;
    user_id: string;
    username: string;
    scope: string;
    redirect_uri: string;
    expires_at: number;
  }
}

// Access Tokens (TTL: 7 days)
OAUTH_TOKENS = {
  [access_token]: {
    client_id: string;
    user_id: string;
    username: string;
    scope: string;
    issued_at: number;
    expires_at: number;
  }
}

// Existing schemas remain unchanged:
// MCP_SESSIONS: User sessions with Last.fm
// MCP_LOGS: Request logging
// MCP_RL: Rate limiting
```

### Key Implementation Files

```
src/
├── auth/
│   ├── oauth.ts          # OAuth 2.0 server implementation
│   ├── clients.ts        # OAuth client management
│   └── tokens.ts         # Token generation and validation
├── endpoints/
│   ├── oauth-authorize.ts
│   ├── oauth-token.ts
│   ├── oauth-register.ts
│   └── manifest.ts
├── middleware/
│   └── oauth-auth.ts     # Bearer token validation
└── types/
    └── oauth.ts          # OAuth type definitions
```

## Detailed Implementation Plan

### Phase 1: OAuth 2.0 Foundation (Week 1)

#### 1.1 OAuth Client Registration System
```typescript
// src/auth/clients.ts
interface OAuthClient {
  client_id: string;
  client_secret: string;
  client_name: string;
  redirect_uris: string[];
  scopes: string[];
  created_at: string;
}

export async function registerOAuthClient(
  request: ClientRegistrationRequest,
  env: Env
): Promise<OAuthClient> {
  const client_id = generateClientId();
  const client_secret = generateClientSecret();
  
  const client: OAuthClient = {
    client_id,
    client_secret,
    client_name: request.client_name,
    redirect_uris: request.redirect_uris,
    scopes: request.scope?.split(' ') || ['read:listening_history'],
    created_at: new Date().toISOString()
  };
  
  await env.OAUTH_CLIENTS.put(client_id, JSON.stringify(client));
  
  return client;
}
```

#### 1.2 Authorization Endpoint
```typescript
// src/endpoints/oauth-authorize.ts
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const params = {
    client_id: url.searchParams.get('client_id'),
    redirect_uri: url.searchParams.get('redirect_uri'),
    response_type: url.searchParams.get('response_type'),
    scope: url.searchParams.get('scope'),
    state: url.searchParams.get('state')
  };
  
  // Validate OAuth parameters
  const validation = await validateAuthorizationRequest(params, env);
  if (!validation.valid) {
    return new Response(validation.error, { status: 400 });
  }
  
  // Check if user has active Last.fm session
  const lastfmSession = await getLastfmSession(request, env);
  if (!lastfmSession) {
    // Redirect to Last.fm auth with return path
    const callbackUrl = `/oauth/callback?${url.searchParams}`;
    const lastfmAuthUrl = buildLastfmAuthUrl(callbackUrl, env);
    return Response.redirect(lastfmAuthUrl);
  }
  
  // Generate authorization code
  const code = generateAuthorizationCode();
  const codeData = {
    client_id: params.client_id,
    user_id: lastfmSession.userId,
    username: lastfmSession.username,
    scope: params.scope,
    redirect_uri: params.redirect_uri,
    expires_at: Date.now() + 10 * 60 * 1000 // 10 minutes
  };
  
  await env.OAUTH_CODES.put(code, JSON.stringify(codeData), { expirationTtl: 600 });
  
  // Redirect back to Claude with authorization code
  const callbackUrl = new URL(params.redirect_uri);
  callbackUrl.searchParams.set('code', code);
  if (params.state) callbackUrl.searchParams.set('state', params.state);
  
  return Response.redirect(callbackUrl.toString());
}
```

#### 1.3 Token Endpoint
```typescript
// src/endpoints/oauth-token.ts
export async function handleToken(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const grantType = formData.get('grant_type');
  
  if (grantType === 'authorization_code') {
    return handleAuthorizationCodeGrant(formData, env);
  } else if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(formData, env);
  }
  
  return new Response('Unsupported grant type', { status: 400 });
}

async function handleAuthorizationCodeGrant(
  formData: FormData, 
  env: Env
): Promise<Response> {
  const code = formData.get('code') as string;
  const clientId = formData.get('client_id') as string;
  const clientSecret = formData.get('client_secret') as string;
  const redirectUri = formData.get('redirect_uri') as string;
  
  // Validate client credentials
  const client = await env.OAUTH_CLIENTS.get(clientId);
  if (!client || JSON.parse(client).client_secret !== clientSecret) {
    return new Response('Invalid client credentials', { status: 401 });
  }
  
  // Validate and consume authorization code
  const codeData = await env.OAUTH_CODES.get(code);
  if (!codeData) {
    return new Response('Invalid or expired authorization code', { status: 400 });
  }
  
  const { user_id, username, scope, expires_at } = JSON.parse(codeData);
  
  if (Date.now() > expires_at) {
    await env.OAUTH_CODES.delete(code);
    return new Response('Authorization code expired', { status: 400 });
  }
  
  // Generate access token
  const accessToken = await generateJWT({
    sub: user_id,
    username,
    scope,
    client_id: clientId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7 days
  }, env.JWT_SECRET);
  
  // Store token metadata
  await env.OAUTH_TOKENS.put(accessToken, JSON.stringify({
    client_id: clientId,
    user_id,
    username,
    scope,
    issued_at: Date.now(),
    expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000
  }), { expirationTtl: 7 * 24 * 60 * 60 });
  
  // Clean up authorization code
  await env.OAUTH_CODES.delete(code);
  
  return new Response(JSON.stringify({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 7 * 24 * 60 * 60,
    scope
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

### Phase 2: MCP Protocol Integration (Week 2)

#### 2.1 Bearer Token Middleware
```typescript
// src/middleware/oauth-auth.ts
export interface AuthContext {
  userId: string;
  username: string;
  scope: string[];
  clientId: string;
  isAuthenticated: true;
}

export async function authenticateRequest(
  request: Request,
  env: Env
): Promise<AuthContext | null> {
  // Check for Bearer token
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return await validateOAuthToken(token, env);
  }
  
  // Fallback to existing connection ID system for backward compatibility
  const connectionId = request.headers.get('x-connection-id');
  if (connectionId) {
    const session = await getSessionByConnectionId(connectionId, env);
    if (session) {
      return {
        userId: session.userId,
        username: session.username,
        scope: ['read:listening_history', 'read:recommendations'],
        clientId: 'legacy',
        isAuthenticated: true
      };
    }
  }
  
  return null;
}

async function validateOAuthToken(
  token: string,
  env: Env
): Promise<AuthContext | null> {
  try {
    // Validate JWT signature and expiration
    const payload = await verifyJWT(token, env.JWT_SECRET);
    
    // Check token in storage (for revocation support)
    const tokenData = await env.OAUTH_TOKENS.get(token);
    if (!tokenData) {
      return null; // Token revoked
    }
    
    const { user_id, username, scope, client_id } = JSON.parse(tokenData);
    
    return {
      userId: user_id,
      username,
      scope: scope.split(' '),
      clientId: client_id,
      isAuthenticated: true
    };
  } catch (error) {
    return null; // Invalid token
  }
}
```

#### 2.2 Updated MCP Handler
```typescript
// src/protocol/handlers.ts - Updated
export async function handleMCPRequest(
  request: Request,
  env: Env
): Promise<Response> {
  // Authenticate request
  const authContext = await authenticateRequest(request, env);
  if (!authContext) {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Unauthorized - valid Bearer token required'
      }
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Parse MCP request
  const mcpRequest = await request.json();
  
  // Process with authenticated context
  const response = await processMCPRequest(mcpRequest, authContext, env);
  
  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': getAllowedOrigin(request),
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}
```

#### 2.3 Updated SSE Connection Management
```typescript
// src/transport/sse.ts - Updated
export async function handleSSEConnection(
  request: Request,
  env: Env
): Promise<Response> {
  const authContext = await authenticateRequest(request, env);
  if (!authContext) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // Use OAuth token as connection identifier
  const connectionId = await hashToken(
    request.headers.get('Authorization')?.slice(7) || ''
  );
  
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  
  // Store connection with OAuth context
  await env.MCP_SESSIONS.put(
    `sse:${connectionId}`,
    JSON.stringify({
      userId: authContext.userId,
      username: authContext.username,
      scope: authContext.scope,
      clientId: authContext.clientId,
      connectionType: 'sse',
      connectedAt: Date.now()
    }),
    { expirationTtl: 7 * 24 * 60 * 60 }
  );
  
  // Send initial capabilities
  await writer.write(new TextEncoder().encode(
    `data: ${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        },
        serverInfo: {
          name: 'lastfm-mcp',
          version: '1.0.0'
        }
      }
    })}\n\n`
  ));
  
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': getAllowedOrigin(request),
      'Access-Control-Allow-Headers': 'Authorization'
    }
  });
}
```

### Phase 3: Integration Manifest & Discovery (Week 2)

#### 3.1 Manifest Endpoint
```typescript
// src/endpoints/manifest.ts
export async function handleManifest(request: Request, env: Env): Promise<Response> {
  const manifest = {
    name: 'Last.fm Music Data',
    description: 'Access your Last.fm listening history, get music recommendations, and explore your musical taste profile',
    version: '1.0.0',
    icon_url: `${getBaseUrl(request)}/icon.png`,
    homepage_url: 'https://github.com/your-username/lastfm-mcp',
    support_url: 'https://github.com/your-username/lastfm-mcp/issues',
    privacy_policy_url: `${getBaseUrl(request)}/privacy`,
    terms_of_service_url: `${getBaseUrl(request)}/terms`,
    oauth: {
      authorization_url: `${getBaseUrl(request)}/oauth/authorize`,
      token_url: `${getBaseUrl(request)}/oauth/token`,
      client_registration_url: `${getBaseUrl(request)}/oauth/register`,
      scopes: [
        {
          name: 'read:listening_history',
          description: 'Access your Last.fm scrobbles, top tracks, albums, and artists'
        },
        {
          name: 'read:recommendations',
          description: 'Generate personalized music recommendations based on your taste'
        },
        {
          name: 'read:social',
          description: 'Access your Last.fm friends, similar users, and social features'
        }
      ]
    },
    mcp: {
      endpoint: `${getBaseUrl(request)}/`,
      sse_endpoint: `${getBaseUrl(request)}/sse`,
      protocol_version: '2024-11-05',
      capabilities: {
        tools: {
          list_changed: false
        },
        resources: {
          subscribe: false,
          list_changed: false
        },
        prompts: {
          list_changed: false
        }
      }
    }
  };
  
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
    }
  });
}
```

#### 3.2 Well-Known Discovery
```typescript
// Add to main router
if (url.pathname === '/.well-known/mcp-manifest') {
  return handleManifest(request, env);
}
```

### Phase 4: Testing & Validation (Week 3)

#### 4.1 OAuth Flow Testing
```typescript
// test/oauth.spec.ts
describe('OAuth 2.0 Flow', () => {
  test('client registration', async () => {
    const response = await env.fetch('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Test Claude Client',
        redirect_uris: ['https://claude.ai/oauth/callback'],
        scope: 'read:listening_history read:recommendations'
      })
    });
    
    expect(response.status).toBe(201);
    const client = await response.json();
    expect(client.client_id).toBeDefined();
    expect(client.client_secret).toBeDefined();
  });
  
  test('authorization code flow', async () => {
    // Test complete OAuth flow
    const clientId = 'test-client';
    const redirectUri = 'https://claude.ai/oauth/callback';
    
    // 1. Authorization request
    const authUrl = `/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read:listening_history&state=test-state`;
    
    const authResponse = await env.fetch(authUrl);
    expect(authResponse.status).toBe(302);
    
    // Should redirect to Last.fm auth since no session
    const location = authResponse.headers.get('Location');
    expect(location).toContain('last.fm');
  });
  
  test('token exchange', async () => {
    // Assuming valid authorization code
    const code = 'test-auth-code';
    
    const tokenResponse = await env.fetch('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: 'test-client',
        client_secret: 'test-secret',
        redirect_uri: 'https://claude.ai/oauth/callback'
      })
    });
    
    expect(tokenResponse.status).toBe(200);
    const token = await tokenResponse.json();
    expect(token.access_token).toBeDefined();
    expect(token.token_type).toBe('Bearer');
  });
});
```

#### 4.2 MCP Integration Testing
```typescript
// test/mcp-oauth.spec.ts
describe('MCP with OAuth', () => {
  test('authenticated MCP request', async () => {
    const accessToken = 'valid-jwt-token';
    
    const response = await env.fetch('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      })
    });
    
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.result.tools).toBeDefined();
  });
  
  test('unauthenticated request rejection', async () => {
    const response = await env.fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      })
    });
    
    expect(response.status).toBe(401);
  });
});
```

## Security Implementation

### OAuth Security Best Practices

#### 1. PKCE Support (Recommended)
```typescript
// Enhanced authorization flow with PKCE
interface AuthorizationRequest {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: 'S256' | 'plain';
}

export async function handleAuthorizeWithPKCE(
  params: AuthorizationRequest,
  env: Env
): Promise<Response> {
  // Validate PKCE challenge if provided
  if (params.code_challenge) {
    if (!params.code_challenge_method) {
      return new Response('code_challenge_method required with code_challenge', { status: 400 });
    }
    
    // Store challenge for later verification
    // ... implementation
  }
  
  // Continue with standard authorization flow
}
```

#### 2. Rate Limiting
```typescript
// src/middleware/rate-limit.ts
export async function rateLimitOAuth(
  request: Request,
  env: Env
): Promise<Response | null> {
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const endpoint = new URL(request.url).pathname;
  const key = `oauth_rl:${endpoint}:${clientIp}`;
  
  const current = await env.MCP_RL.get(key);
  const count = current ? parseInt(current) : 0;
  
  // Allow 10 requests per minute for OAuth endpoints
  if (count >= 10) {
    return new Response('Rate limit exceeded', { status: 429 });
  }
  
  await env.MCP_RL.put(key, (count + 1).toString(), { expirationTtl: 60 });
  return null; // Continue processing
}
```

#### 3. Token Security
```typescript
// src/auth/tokens.ts
export async function generateSecureToken(): Promise<string> {
  // Use crypto.getRandomValues for secure random generation
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}
```

## Migration & Deployment Strategy

### Backward Compatibility Approach

```typescript
// Dual authentication support during transition
export async function getAuthContext(request: Request, env: Env): Promise<AuthContext | null> {
  // 1. Try OAuth Bearer token first (native Claude)
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const oauthContext = await validateOAuthToken(token, env);
    if (oauthContext) {
      return oauthContext;
    }
  }
  
  // 2. Fall back to connection ID system (mcp-remote)
  const connectionId = request.headers.get('x-connection-id');
  if (connectionId) {
    const session = await getSessionByConnectionId(connectionId, env);
    if (session) {
      return {
        userId: session.userId,
        username: session.username,
        scope: ['read:listening_history', 'read:recommendations'],
        clientId: 'mcp-remote',
        isAuthenticated: true
      };
    }
  }
  
  // 3. Check for legacy JWT in cookies
  const legacySession = await getLegacySession(request, env);
  if (legacySession) {
    return {
      userId: legacySession.userId,
      username: legacySession.username,
      scope: ['read:listening_history', 'read:recommendations'],
      clientId: 'legacy',
      isAuthenticated: true
    };
  }
  
  return null;
}
```

### Deployment Phases

#### Phase 1: Development & Testing (Week 1)
- Implement OAuth 2.0 server
- Add OAuth endpoints
- Create comprehensive tests
- Deploy to staging environment

#### Phase 2: Beta Testing (Week 2)
- Deploy OAuth-enabled version alongside existing auth
- Test with Claude Desktop beta
- Gather user feedback
- Refine implementation

#### Phase 3: Production Launch (Week 3)
- Full production deployment
- Submit to Claude integration directory
- Monitor performance and errors
- Documentation and support materials

## Debugging & Troubleshooting

### Debugging Tools

#### 1. MCP Inspector Usage
```bash
# Install MCP Inspector
npm install -g @modelcontextprotocol/inspector

# Test OAuth-enabled server
mcp-inspector --url https://your-server.com/
```

#### 2. OAuth Flow Debugging
```typescript
// Enhanced logging for OAuth flow
export async function debugOAuthFlow(
  step: string,
  data: any,
  env: Env
): Promise<void> {
  const logEntry = {
    timestamp: new Date().toISOString(),
    step,
    data: sanitizeForLogging(data),
    trace_id: generateTraceId()
  };
  
  await env.MCP_LOGS.put(
    `oauth_debug:${Date.now()}:${generateId()}`,
    JSON.stringify(logEntry),
    { expirationTtl: 24 * 60 * 60 } // 24 hours
  );
}

function sanitizeForLogging(data: any): any {
  const sanitized = { ...data };
  
  // Remove sensitive fields
  delete sanitized.client_secret;
  delete sanitized.access_token;
  delete sanitized.authorization_code;
  
  // Truncate long values
  Object.keys(sanitized).forEach(key => {
    if (typeof sanitized[key] === 'string' && sanitized[key].length > 100) {
      sanitized[key] = sanitized[key].substring(0, 100) + '...';
    }
  });
  
  return sanitized;
}
```

#### 3. Health Check Endpoint
```typescript
// src/endpoints/health.ts
export async function handleHealthCheck(request: Request, env: Env): Promise<Response> {
  const checks = {
    oauth_endpoints: await checkOAuthEndpoints(env),
    mcp_protocol: await checkMCPProtocol(env),
    lastfm_api: await checkLastfmAPI(env),
    database: await checkDatabase(env)
  };
  
  const allHealthy = Object.values(checks).every(check => check.healthy);
  
  return new Response(JSON.stringify({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks
  }), {
    status: allHealthy ? 200 : 503,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

## Documentation & Support

### User Documentation Required

1. **Setup Guide**: How to enable the integration in Claude
2. **Feature Overview**: What tools and capabilities are available
3. **Privacy Policy**: Data handling and storage practices
4. **Troubleshooting**: Common issues and solutions
5. **API Reference**: For developers wanting to understand the implementation

### Developer Documentation

1. **OAuth Implementation Guide**: Technical details of the OAuth flow
2. **MCP Protocol Adaptations**: Changes made for Claude compatibility
3. **Deployment Guide**: How to deploy your own instance
4. **Contributing Guide**: How to contribute to the project

## Success Metrics

### Technical Metrics
- OAuth flow completion rate
- Token validation success rate
- MCP request latency
- Error rate reduction vs mcp-remote

### User Experience Metrics
- Integration activation rate
- Tool usage frequency
- User retention
- Support ticket volume

## Resources & References

### Official Documentation
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Claude Custom Integrations Guide](https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp)
- [Building Remote MCP Servers](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers)  
- [MCP Debugging Tools](https://modelcontextprotocol.io/docs/tools/debugging)
- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [OAuth 2.0 Security Best Practices](https://datatracker.ietf.org/doc/html/rfc8252)

### Key Technical Insights from Research

**Claude Integration Requirements:**
- Supports SSE and Streamable HTTP-based servers ✅ (We have both)
- Requires Dynamic Client Registration support (Need to implement)
- Follows 3/26 auth specification
- Supports tools, prompts, and resources ✅ (We have all)
- Supports text, binary, and image-based tool results ✅ (We support text)

**Testing & Validation:**
- Use MCP Inspector tool for protocol validation
- Test with Claude Desktop integration sandbox
- Monitor logs in `~/Library/Logs/Claude/mcp*.log` on macOS
- Chrome DevTools available for advanced debugging

### Example Implementations
- [Cloudflare MCP Server](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)
- [Azure API Management MCP](https://devblogs.microsoft.com/blog/claude-ready-secure-mcp-apim)

### Development Tools
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector) - Protocol testing
- [OAuth 2.0 Playground](https://www.oauth.com/playground/) - OAuth flow testing
- [JWT.io](https://jwt.io/) - JWT debugging
- [Postman OAuth 2.0 Guide](https://learning.postman.com/docs/sending-requests/authorization/#oauth-20)

## Risk Assessment & Mitigation

### Technical Risks
1. **OAuth Implementation Complexity**
   - Risk: Security vulnerabilities in custom OAuth server
   - Mitigation: Use established patterns, comprehensive testing, security audit

2. **Session Management Complexity**
   - Risk: Token/session confusion during migration
   - Mitigation: Clear separation of concerns, extensive logging

3. **Performance Impact**
   - Risk: OAuth validation overhead
   - Mitigation: Efficient token caching, async processing

### Business Risks
1. **User Migration Difficulty**
   - Risk: Users struggle to switch from mcp-remote
   - Mitigation: Maintain backward compatibility, clear migration guide

2. **Claude Integration Approval**
   - Risk: Rejection from Claude integration directory
   - Mitigation: Follow all specifications exactly, test thoroughly

## Conclusion

The claude-native branch analysis reveals that native Claude Integration support is highly achievable. The previous implementation got 90% of the way there but was derailed by a simple error handling bug and incomplete integration testing.

**Key Insights**:
1. **OAuth 2.0 Infrastructure Works**: Core authentication, token management, and storage are solid
2. **Integration Challenges Are Manageable**: The issues found are straightforward to fix
3. **Test Coverage Approach Was Correct**: Comprehensive test suite identified the problems
4. **Architecture Decisions Were Sound**: JWT tokens, KV storage, and backward compatibility design

**Benefits Remain Compelling**:
- Direct Claude integration without mcp-remote dependency
- Official listing in Claude's integration directory  
- Better user experience with native OAuth 2.0 flow
- Enterprise-ready deployment
- Future-proof architecture aligned with Claude's roadmap

**Immediate Next Steps** (Based on Lessons Learned):
1. Apply the error handling fix from claude-native branch analysis
2. Complete SSE endpoint OAuth integration
3. Run comprehensive end-to-end tests with MCP Inspector
4. Test with Claude Desktop integration sandbox

The path to native Claude integration is now clear and well-validated.