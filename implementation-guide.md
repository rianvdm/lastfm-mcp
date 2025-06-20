# Technical Implementation Guide: Migrating Last.fm MCP to Native Claude Integration

## Overview

This guide provides step-by-step implementation details for migrating the Last.fm MCP server from using `mcp-remote` to native Claude Custom Integration support.

## Prerequisites

- Cloudflare Workers account
- Last.fm API credentials
- Understanding of OAuth 2.0 flows
- Familiarity with TypeScript and MCP protocol

## Implementation Steps

### Step 1: Set Up OAuth Provider Infrastructure

First, install the required dependencies:

```bash
npm install @cloudflare/workers-oauth-provider
```

Create `src/oauth/provider.ts`:

```typescript
import { WorkerOAuthProvider } from '@cloudflare/workers-oauth-provider';
import { Env } from '../types';

export function createOAuthProvider(env: Env) {
  return new WorkerOAuthProvider({
    clientIdGenerator: () => crypto.randomUUID(),
    
    clientRegistry: {
      supportsDynamicClientRegistration: true,
      
      async registerClient(client) {
        // Store client in KV
        await env.KV.put(`oauth:client:${client.client_id}`, JSON.stringify(client));
        return client;
      },
      
      async getClient(clientId) {
        const data = await env.KV.get(`oauth:client:${clientId}`);
        return data ? JSON.parse(data) : null;
      }
    },
    
    tokenGenerator: {
      async generateTokens(client, user, scopes) {
        const accessToken = crypto.randomUUID();
        const refreshToken = crypto.randomUUID();
        
        // Store tokens with user context
        await env.KV.put(`oauth:token:${accessToken}`, JSON.stringify({
          clientId: client.client_id,
          userId: user.id,
          scopes,
          expiresAt: Date.now() + 3600000 // 1 hour
        }), { expirationTtl: 3600 });
        
        return {
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: scopes.join(' ')
        };
      }
    },
    
    userAuthenticator: {
      async authenticateUser(request) {
        // Bridge to Last.fm authentication
        const sessionCookie = getCookie(request, 'lastfm_session');
        if (!sessionCookie) {
          return null;
        }
        
        const session = await env.KV.get(`session:${sessionCookie}`);
        if (!session) {
          return null;
        }
        
        const userData = JSON.parse(session);
        return {
          id: userData.username,
          // Additional user data
        };
      }
    }
  });
}
```

### Step 2: Implement SSE Transport

Create `src/transport/sse.ts`:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Env } from '../types';

export async function handleSSEConnection(
  request: Request,
  env: Env,
  server: Server
): Promise<Response> {
  // Validate OAuth token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  const token = authHeader.substring(7);
  const tokenData = await env.KV.get(`oauth:token:${token}`);
  
  if (!tokenData) {
    return new Response('Invalid token', { status: 401 });
  }
  
  const { userId, expiresAt } = JSON.parse(tokenData);
  
  if (Date.now() > expiresAt) {
    return new Response('Token expired', { status: 401 });
  }
  
  // Set up SSE transport
  const transport = new SSEServerTransport('/messages');
  
  // Connect server with user context
  server.setContext({ userId, env });
  await server.connect(transport);
  
  // Return SSE response
  return transport.response;
}
```

### Step 3: Update Main Worker Entry Point

Update `src/index.ts`:

```typescript
import { createOAuthProvider } from './oauth/provider';
import { handleSSEConnection } from './transport/sse';
import { createMCPServer } from './mcp/server';
import { Env } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // CORS headers for browser-based auth
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };
    
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    try {
      // OAuth endpoints
      const oauthProvider = createOAuthProvider(env);
      
      if (url.pathname === '/oauth/authorize') {
        return oauthProvider.authorize(request, env);
      }
      
      if (url.pathname === '/oauth/token') {
        return oauthProvider.token(request, env);
      }
      
      if (url.pathname === '/oauth/client' && request.method === 'POST') {
        return oauthProvider.registerClient(request, env);
      }
      
      // SSE endpoint for MCP
      if (url.pathname === '/sse' && request.method === 'GET') {
        const server = createMCPServer(env);
        const response = await handleSSEConnection(request, env, server);
        
        // Add CORS headers to SSE response
        Object.entries(corsHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
        
        return response;
      }
      
      // Last.fm auth bridge endpoints
      if (url.pathname === '/auth/lastfm/login') {
        return handleLastFmLogin(request, env);
      }
      
      if (url.pathname === '/auth/lastfm/callback') {
        return handleLastFmCallback(request, env);
      }
      
      return new Response('Not Found', { status: 404 });
      
    } catch (error) {
      console.error('Worker error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};
```

### Step 4: Update MCP Server Implementation

Create `src/mcp/server.ts`:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import { Env } from '../types';
import { LastFmAPI } from '../lastfm/api';

export function createMCPServer(env: Env): Server {
  const server = new Server(
    {
      name: 'lastfm-mcp',
      version: '2.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );
  
  // Register tools with user context awareness
  server.setRequestHandler(async (request, context) => {
    const { userId } = context;
    const lastfm = new LastFmAPI(env);
    
    switch (request.method) {
      case 'tools/list':
        return {
          tools: [
            {
              name: 'get_recent_tracks',
              description: 'Get your recent listening history',
              inputSchema: {
                type: 'object',
                properties: {
                  limit: { type: 'number', default: 50 },
                  page: { type: 'number', default: 1 }
                }
              }
            },
            // ... other tools
          ]
        };
        
      case 'tools/call':
        const { name, arguments: args } = request.params;
        
        switch (name) {
          case 'get_recent_tracks':
            // Use userId from OAuth context
            const tracks = await lastfm.getRecentTracks(userId, args);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(tracks, null, 2)
              }]
            };
            
          // ... handle other tools
        }
    }
  });
  
  return server;
}
```

### Step 5: Implement Last.fm Authentication Bridge

Create `src/auth/lastfm-bridge.ts`:

```typescript
import { Env } from '../types';

export async function handleLastFmLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get('state'); // OAuth state parameter
  
  if (!state) {
    return new Response('Missing state parameter', { status: 400 });
  }
  
  // Store state for validation
  await env.KV.put(`auth:state:${state}`, 'pending', { expirationTtl: 600 });
  
  // Redirect to Last.fm auth
  const lastFmAuthUrl = new URL('https://www.last.fm/api/auth');
  lastFmAuthUrl.searchParams.set('api_key', env.LASTFM_API_KEY);
  lastFmAuthUrl.searchParams.set('cb', `${url.origin}/auth/lastfm/callback?state=${state}`);
  
  return Response.redirect(lastFmAuthUrl.toString());
}

export async function handleLastFmCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const state = url.searchParams.get('state');
  
  if (!token || !state) {
    return new Response('Missing parameters', { status: 400 });
  }
  
  // Validate state
  const stateValid = await env.KV.get(`auth:state:${state}`);
  if (!stateValid) {
    return new Response('Invalid state', { status: 400 });
  }
  
  // Get Last.fm session
  const session = await getLastFmSession(token, env);
  
  if (!session) {
    return new Response('Authentication failed', { status: 401 });
  }
  
  // Store session and redirect back to OAuth flow
  const sessionId = crypto.randomUUID();
  await env.KV.put(`session:${sessionId}`, JSON.stringify({
    username: session.name,
    key: session.key
  }), { expirationTtl: 86400 });
  
  // Set cookie and redirect
  const response = Response.redirect(`${url.origin}/oauth/authorize?state=${state}`);
  response.headers.set('Set-Cookie', `lastfm_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax`);
  
  return response;
}
```

### Step 6: Update wrangler.toml

```toml
name = "lastfm-mcp"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[env.production]
workers_dev = false
route = { pattern = "lastfm-mcp-prod.rian-db8.workers.dev/*", zone_name = "rian-db8.workers.dev" }

[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"

[vars]
# Non-secret variables

[[migrations]]
tag = "v2"
new_classes = ["LastFmMCP"]
```

### Step 7: Testing Strategy

1. **Local Testing with MCP Inspector**:
```bash
# Start local development
wrangler dev

# Test with MCP Inspector
# URL: http://localhost:8787/sse
# Transport: SSE
```

2. **OAuth Flow Testing**:
```javascript
// Test Dynamic Client Registration
const response = await fetch('http://localhost:8787/oauth/client', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_name: 'Test Client',
    redirect_uris: ['http://localhost:5173/callback']
  })
});
```

3. **Integration Testing Script**:
```typescript
// test/integration.ts
import { describe, it, expect } from 'vitest';

describe('OAuth Integration', () => {
  it('should register a client dynamically', async () => {
    // Test implementation
  });
  
  it('should complete auth flow', async () => {
    // Test implementation
  });
});
```

### Step 8: Deployment

```bash
# Set secrets
wrangler secret put LASTFM_API_KEY --env production
wrangler secret put LASTFM_SHARED_SECRET --env production

# Deploy
wrangler deploy --env production

# Test production
curl -X POST https://lastfm-mcp-prod.rian-db8.workers.dev/oauth/client \
  -H "Content-Type: application/json" \
  -d '{"client_name": "Claude Desktop", "redirect_uris": ["https://claude.ai/oauth/callback"]}'
```

### Step 9: Claude Desktop Configuration

Once deployed, users will configure Claude Desktop without mcp-remote:

```json
{
  "customIntegrations": {
    "lastfm": {
      "url": "https://lastfm-mcp-prod.rian-db8.workers.dev/sse"
    }
  }
}
```

## Error Handling and Edge Cases

### Token Expiration
```typescript
// Implement token refresh
if (isTokenExpired(token)) {
  const refreshToken = await getRefreshToken(token);
  if (refreshToken) {
    return await refreshAccessToken(refreshToken);
  }
  return new Response('Token expired', { status: 401 });
}
```

### Rate Limiting
```typescript
// Add rate limiting per user
const rateLimitKey = `ratelimit:${userId}:${Date.now() / 60000 | 0}`;
const count = await env.KV.get(rateLimitKey);
if (count && parseInt(count) > 100) {
  return new Response('Rate limit exceeded', { status: 429 });
}
```

## Migration Checklist

- [ ] Implement OAuth provider with Dynamic Client Registration
- [ ] Create SSE transport handler
- [ ] Bridge Last.fm authentication to OAuth
- [ ] Update all tool implementations for OAuth context
- [ ] Add comprehensive error handling
- [ ] Implement rate limiting
- [ ] Add monitoring and logging
- [ ] Test with MCP Inspector
- [ ] Test with Claude Desktop
- [ ] Create migration documentation for users
- [ ] Deploy to production
- [ ] Monitor for issues

## Conclusion

This implementation guide provides a complete path from the current mcp-remote setup to a native Claude Custom Integration. The key is properly implementing OAuth 2.0 with Dynamic Client Registration while maintaining the excellent Last.fm functionality users expect.