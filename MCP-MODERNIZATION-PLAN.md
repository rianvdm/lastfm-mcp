# Last.fm MCP Server Modernization Plan

## Executive Summary

The MCP (Model Context Protocol) landscape has evolved significantly since this project was started. The current implementation uses a **custom hand-rolled MCP server** built directly on Cloudflare Workers, which predates the official Cloudflare Agents SDK and the latest MCP specification changes.

**Decision**: Migrate to the **Cloudflare Agents SDK** using `createMcpHandler` for official support, automatic spec compliance, and reduced maintenance burden.

---

## Current State

### What We Have

| File | Purpose | Keep/Migrate/Remove |
|------|---------|---------------------|
| `src/index.ts` | Main worker entry, routing | **Migrate** - simplify to use SDK |
| `src/protocol/handlers.ts` | MCP method handlers | **Migrate** - convert to SDK tools/resources |
| `src/protocol/parser.ts` | JSON-RPC parsing | **Remove** - SDK handles this |
| `src/protocol/validation.ts` | Request validation | **Remove** - SDK + Zod handles this |
| `src/types/mcp.ts` | MCP type definitions | **Remove** - SDK provides types |
| `src/transport/sse.ts` | Legacy SSE transport | **Remove** - deprecated |
| `src/auth/lastfm.ts` | Last.fm OAuth | **Keep** - still needed |
| `src/auth/jwt.ts` | JWT session management | **Keep** - still needed |
| `src/clients/lastfm.ts` | Last.fm API client | **Keep** - still needed |
| `src/clients/cachedLastfm.ts` | Cached API client | **Keep** - still needed |
| `src/types/lastfm-mcp.ts` | Tool/resource definitions | **Migrate** - convert to SDK format |
| `src/utils/*.ts` | Rate limiting, logging | **Keep** - still needed |

### What's Working (Keep These)

- ✅ Last.fm API client with caching
- ✅ Last.fm OAuth authentication flow  
- ✅ JWT session management
- ✅ Rate limiting and logging utilities
- ✅ KV storage for sessions

### What's Being Replaced

- ❌ Custom JSON-RPC parsing → SDK handles
- ❌ Custom protocol validation → Zod schemas
- ❌ Custom transport handling → `createMcpHandler`
- ❌ Legacy SSE endpoint → Streamable HTTP only
- ❌ Multiple endpoints confusion → Single `/mcp` endpoint

---

## Target Architecture

### New Code Structure

```
src/
├── index.ts                    # Main entry - routes + createMcpHandler
├── mcp/
│   ├── server.ts               # McpServer configuration
│   ├── tools/
│   │   ├── index.ts            # Tool registration
│   │   ├── public.ts           # ping, server_info, get_track_info, etc.
│   │   └── authenticated.ts    # get_recent_tracks, get_top_artists, etc.
│   ├── resources/
│   │   └── lastfm.ts           # Resource templates
│   └── prompts/
│       └── analysis.ts         # Prompt definitions
├── auth/
│   ├── lastfm.ts               # Last.fm OAuth (existing)
│   └── jwt.ts                  # JWT sessions (existing)
├── clients/
│   ├── lastfm.ts               # Last.fm API (existing)
│   └── cachedLastfm.ts         # Cached client (existing)
├── utils/
│   ├── rateLimit.ts            # Rate limiting (existing)
│   └── kvLogger.ts             # Logging (existing)
├── types/
│   └── env.ts                  # Environment types (existing)
└── marketing-page.ts           # Landing page HTML (existing)
```

### Endpoint Structure (Backward Compatible)

| Endpoint | Method | Purpose | Notes |
|----------|--------|---------|-------|
| `/` | GET | Marketing page | |
| `/` | POST | MCP JSON-RPC | **Keep for backward compat** |
| `/mcp` | POST | MCP JSON-RPC | Primary endpoint going forward |
| `/mcp` | GET | SSE stream (optional) | SDK handles this |
| `/login` | GET | Last.fm auth redirect | |
| `/callback` | GET | Last.fm auth callback | |
| `/health` | GET | Health check | |
| `/.well-known/mcp.json` | GET | Server discovery | |

### Breaking Changes

| Change | Impact | Mitigation |
|--------|--------|------------|
| `/sse` endpoint removed | Users with `/sse` in config | Low impact - most use root or `/mcp` |
| `POST /` still works | None | Keeping for backward compat |
| Protocol internals | None visible to users | SDK handles same JSON-RPC format |

---

## Migration Checklist

Use this checklist across multiple coding sessions. Check off items as completed.

### Session 1: Setup & Dependencies

- [ ] **1.1** Create feature branch: `git checkout -b feature/agents-sdk-migration`
- [ ] **1.2** Install dependencies:
  ```bash
  npm install agents @modelcontextprotocol/sdk zod
  ```
- [ ] **1.3** Verify dependencies work with Cloudflare Workers (check wrangler compatibility)
- [ ] **1.4** Create `src/mcp/` directory structure
- [ ] **1.5** Create basic `src/mcp/server.ts` with empty McpServer
- [ ] **1.6** Test that worker still builds: `npm run build`

### Session 2: Public Tools Migration

- [ ] **2.1** Create `src/mcp/tools/public.ts`
- [ ] **2.2** Migrate `ping` tool with Zod schema
- [ ] **2.3** Migrate `server_info` tool
- [ ] **2.4** Migrate `get_track_info` tool
- [ ] **2.5** Migrate `get_artist_info` tool
- [ ] **2.6** Migrate `get_album_info` tool
- [ ] **2.7** Migrate `get_similar_artists` tool
- [ ] **2.8** Migrate `get_similar_tracks` tool
- [ ] **2.9** Register all public tools in `src/mcp/server.ts`
- [ ] **2.10** Write/update tests for public tools
- [ ] **2.11** Test with MCP Inspector (public tools only)

### Session 3: Authenticated Tools Migration

- [ ] **3.1** Create `src/mcp/tools/authenticated.ts`
- [ ] **3.2** Implement session/auth context passing to tools
- [ ] **3.3** Migrate `lastfm_auth_status` tool
- [ ] **3.4** Migrate `get_recent_tracks` tool
- [ ] **3.5** Migrate `get_top_artists` tool
- [ ] **3.6** Migrate `get_top_albums` tool
- [ ] **3.7** Migrate `get_loved_tracks` tool
- [ ] **3.8** Migrate `get_user_info` tool
- [ ] **3.9** Migrate `get_listening_stats` tool
- [ ] **3.10** Migrate `get_music_recommendations` tool
- [ ] **3.11** Migrate `get_weekly_chart_list` tool
- [ ] **3.12** Migrate `get_weekly_artist_chart` tool
- [ ] **3.13** Migrate `get_weekly_track_chart` tool
- [ ] **3.14** Register all authenticated tools
- [ ] **3.15** Write/update tests for authenticated tools

### Session 4: Resources & Prompts Migration

- [ ] **4.1** Create `src/mcp/resources/lastfm.ts`
- [ ] **4.2** Migrate user resources (recent, top-artists, top-albums, loved, profile)
- [ ] **4.3** Migrate track/artist/album resources
- [ ] **4.4** Migrate similar artist/track resources
- [ ] **4.5** Register resources in server
- [ ] **4.6** Create `src/mcp/prompts/analysis.ts`
- [ ] **4.7** Migrate `listening_insights` prompt
- [ ] **4.8** Migrate `music_discovery` prompt
- [ ] **4.9** Migrate `track_analysis` prompt
- [ ] **4.10** Migrate `album_analysis` prompt
- [ ] **4.11** Migrate `artist_analysis` prompt
- [ ] **4.12** Migrate `listening_habits` prompt
- [ ] **4.13** Register prompts in server
- [ ] **4.14** Test resources and prompts

### Session 5: Main Entry Point & Routing

- [ ] **5.1** Update `src/index.ts` to use `createMcpHandler`
- [ ] **5.2** Keep `/` for marketing page (GET only)
- [ ] **5.3** Route `/mcp` to `createMcpHandler`
- [ ] **5.4** Keep `/login`, `/callback` for auth flow
- [ ] **5.5** Keep `/health` endpoint
- [ ] **5.6** Update `/.well-known/mcp.json` to point to `/mcp`
- [ ] **5.7** Integrate session management with SDK
- [ ] **5.8** Integrate rate limiting
- [ ] **5.9** Test full request flow locally

### Session 6: Authentication Integration

- [ ] **6.1** Ensure auth flow works with new structure
- [ ] **6.2** Test session persistence across MCP requests
- [ ] **6.3** Test unauthenticated → authenticated flow
- [ ] **6.4** Verify session ID handling in `Mcp-Session-Id` header
- [ ] **6.5** Test auth with Claude Code
- [ ] **6.6** Test auth with Claude Desktop

### Session 7: Testing & Validation

- [ ] **7.1** Run full test suite: `npm test`
- [ ] **7.2** Test with MCP Inspector (all features)
- [ ] **7.3** Test with Claude Code: `claude mcp add --transport http lastfm-local http://localhost:8787/mcp`
- [ ] **7.4** Test with Claude Desktop (Connectors UI)
- [ ] **7.5** Test with Windsurf (`serverUrl` config)
- [ ] **7.6** Verify all tools work
- [ ] **7.7** Verify all resources work
- [ ] **7.8** Verify all prompts work
- [ ] **7.9** Verify authentication flow end-to-end
- [ ] **7.10** Performance testing (rate limits, caching)

### Session 8: Cleanup & Deployment

- [ ] **8.1** Remove old files:
  - [ ] `src/protocol/handlers.ts`
  - [ ] `src/protocol/parser.ts`
  - [ ] `src/protocol/validation.ts`
  - [ ] `src/transport/sse.ts`
  - [ ] `src/types/mcp.ts`
  - [ ] `src/types/jsonrpc.ts`
- [ ] **8.2** Remove unused dependencies from `package.json`
- [ ] **8.3** Update `CLAUDE.md` with new architecture
- [ ] **8.4** Update `README.md` with new client configs
- [ ] **8.5** Update `TODO.md` to remove completed items
- [ ] **8.6** Run linting: `npm run lint`
- [ ] **8.7** Run formatting: `npm run format`
- [ ] **8.8** Final test suite run
- [ ] **8.9** Deploy to staging: `npm run deploy`
- [ ] **8.10** Test staging deployment
- [ ] **8.11** Deploy to production: `npm run deploy:prod`
- [ ] **8.12** Verify production deployment
- [ ] **8.13** Merge PR to main

---

## Code Examples

### Basic Server Setup

```typescript
// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const server = new McpServer({
  name: "lastfm-mcp",
  version: "1.0.0",
});

// Import and register tools, resources, prompts
import { registerPublicTools } from "./tools/public";
import { registerAuthenticatedTools } from "./tools/authenticated";
import { registerResources } from "./resources/lastfm";
import { registerPrompts } from "./prompts/analysis";

registerPublicTools(server);
registerAuthenticatedTools(server);
registerResources(server);
registerPrompts(server);
```

### Tool Registration Example

```typescript
// src/mcp/tools/public.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPublicTools(server: McpServer) {
  server.tool(
    "get_track_info",
    "Get detailed information about a track",
    {
      artist: z.string().describe("Artist name"),
      track: z.string().describe("Track name"),
    },
    async ({ artist, track }) => {
      // Get client from context or create new
      const client = getCachedLastfmClient(env);
      const data = await client.getTrackInfo(artist, track);
      
      return {
        content: [{
          type: "text",
          text: formatTrackInfo(data),
        }],
      };
    }
  );
}
```

### Main Entry Point

```typescript
// src/index.ts
import { createMcpHandler } from "agents/mcp";
import { server } from "./mcp/server";
import { MARKETING_PAGE_HTML } from "./marketing-page";
import type { Env } from "./types/env";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // MCP endpoint - primary (/mcp) and backward compat (POST /)
    if (url.pathname === "/mcp" || (url.pathname === "/" && request.method === "POST")) {
      return createMcpHandler(server)(request, env, ctx);
    }

    // Marketing page (GET / only)
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(MARKETING_PAGE_HTML, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Auth endpoints (keep existing)
    if (url.pathname === "/login") {
      return handleLogin(request, env);
    }
    if (url.pathname === "/callback") {
      return handleCallback(request, env);
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
```

---

## Client Configuration Reference

After migration, update documentation with these configs:

### Claude Code

```bash
claude mcp add --transport http lastfm https://lastfm-mcp-prod.rian-db8.workers.dev/mcp
```

### Claude Desktop (Connectors UI)

1. Open Claude Desktop → Settings → Connectors
2. Click "Add Connector"
3. Enter: `https://lastfm-mcp-prod.rian-db8.workers.dev/mcp`
4. Click "Add"

### Claude Desktop (Config File with mcp-remote)

```json
{
  "mcpServers": {
    "lastfm": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://lastfm-mcp-prod.rian-db8.workers.dev/mcp"]
    }
  }
}
```

### Windsurf

Edit `~/.codeium/mcp_config.json`:

```json
{
  "mcpServers": {
    "lastfm": {
      "serverUrl": "https://lastfm-mcp-prod.rian-db8.workers.dev/mcp"
    }
  }
}
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector https://lastfm-mcp-prod.rian-db8.workers.dev/mcp
```

---

## Known Challenges & Solutions

### Challenge 1: Passing Environment to Tools

The SDK's `server.tool()` doesn't directly receive `env`. Solutions:

1. **Closure approach**: Create server in a function that receives env
2. **Context approach**: Use SDK's context mechanism if available
3. **Global approach**: Store env reference (less ideal)

```typescript
// Option 1: Factory function
export function createServer(env: Env) {
  const server = new McpServer({ name: "lastfm-mcp", version: "1.0.0" });
  const client = new CachedLastfmClient(new LastfmClient(env.LASTFM_API_KEY), env.MCP_SESSIONS);
  
  server.tool("get_track_info", "...", schema, async (args) => {
    // client is available via closure
    return await client.getTrackInfo(args.artist, args.track);
  });
  
  return server;
}
```

### Challenge 2: Authentication Context

Need to pass session info to authenticated tools. Options:

1. **Request header parsing**: Extract `Mcp-Session-Id` in handler, lookup session
2. **Middleware pattern**: Wrap handler with auth check
3. **SDK hooks**: Use SDK's built-in auth mechanisms if available

### Challenge 3: Backward Compatibility

During migration, may need to support both old and new endpoints temporarily:

```typescript
// Support both during transition
if (url.pathname === "/mcp" || url.pathname === "/") {
  if (request.method === "POST") {
    return createMcpHandler(server)(request, env, ctx);
  }
}
```

---

## Progress Tracking

Use this section to track progress across sessions:

| Session | Status | Date | Notes |
|---------|--------|------|-------|
| 1. Setup & Dependencies | ⬜ Not Started | | |
| 2. Public Tools | ⬜ Not Started | | |
| 3. Authenticated Tools | ⬜ Not Started | | |
| 4. Resources & Prompts | ⬜ Not Started | | |
| 5. Entry Point & Routing | ⬜ Not Started | | |
| 6. Authentication | ⬜ Not Started | | |
| 7. Testing | ⬜ Not Started | | |
| 8. Cleanup & Deploy | ⬜ Not Started | | |

Legend: ⬜ Not Started | 🟡 In Progress | ✅ Complete | ❌ Blocked

---

## References

- [MCP Specification (Latest)](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Cloudflare Agents SDK - createMcpHandler](https://developers.cloudflare.com/agents/model-context-protocol/mcp-handler-api/)
- [Cloudflare Agents SDK - McpAgent](https://developers.cloudflare.com/agents/model-context-protocol/mcp-agent-api/)
- [Cloudflare MCP Worker Example](https://github.com/cloudflare/agents/tree/main/examples/mcp-worker)
- [Windsurf MCP Documentation](https://docs.windsurf.com/windsurf/cascade/mcp)
- [Claude Desktop Remote MCP](https://modelcontextprotocol.io/docs/develop/connect-remote-servers)
- [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
