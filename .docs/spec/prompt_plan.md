# Last.fm MCP Server - Conversion Plan

This document outlines the conversion of the Discogs MCP Server to a Last.fm MCP Server. The plan builds on the existing architecture while adapting to Last.fm's API and data structures.

---

## 1 – Conversion Strategy

1. **Foundation Updates**  
   1.1 Update project metadata and documentation  
   1.2 Modify API client from Discogs to Last.fm
2. **Authentication Changes**  
   2.1 Replace Discogs OAuth with Last.fm API key authentication  
   2.2 Update session management
3. **Data Model Updates**  
   3.1 Replace Discogs data types with Last.fm equivalents  
   3.2 Update resource and tool schemas
4. **Core Feature Adaptation**  
   4.1 MCP Resources (tracks, albums, artists, user data)  
   4.2 MCP Tools (recent tracks, top artists, loved tracks, etc.)  
   4.3 MCP Prompts (listening history, music discovery, stats)  
   4.4 Listening statistics and insights  
   4.5 Music recommendations based on listening history
5. **Configuration Updates**  
   5.1 Update Cloudflare Workers configuration  
   5.2 Environment variables and secrets
6. **Testing & Validation**  
   6.1 Update tests for Last.fm API integration  
   6.2 Validate MCP protocol compliance
7. **Documentation**  
   7.1 Update README and usage instructions  
   7.2 Create Last.fm-specific examples

---

## 2 – Conversion Chunks

Chunk A – Project Metadata  
• Update package.json, README, and project documentation for Last.fm

Chunk B – API Client Replacement  
• Replace Discogs client with Last.fm API client → Update data types

Chunk C – Authentication Overhaul  
• Replace OAuth with Last.fm API key → Update auth middleware

Chunk D – Resource Updates  
• Update MCP resources for Last.fm data → Tracks, albums, artists, user profile

Chunk E – Tool Conversion  
• Convert tools to Last.fm equivalents → Recent tracks, top artists, loved tracks

Chunk F – Prompt Adaptation  
• Update prompts for Last.fm use cases → Listening insights, music discovery

Chunk G – Configuration Updates  
• Update Wrangler config → Environment variables → Secrets management

Chunk H – Testing & Validation  
• Update test suites → Validate Last.fm integration → MCP compliance

Chunk I – Documentation  
• Update README → Usage examples → API documentation

---

## 3 – Detailed Conversion Steps

Chunk A – Project Metadata  
A1 Update package.json name, description, and keywords for Last.fm  
A2 Update README.md with Last.fm-specific information  
A3 Update spec files (spec.md, todo.md) for Last.fm requirements  
A4 Update example configurations for Last.fm API

Chunk B – API Client Replacement  
B1 Create new `src/clients/lastfm.ts` API client  
B2 Update data types in `src/types/` for Last.fm responses  
B3 Remove Discogs-specific client and types  
B4 Update imports throughout codebase

Chunk C – Authentication Overhaul  
C1 Replace OAuth with API key authentication in `src/auth/lastfm.ts`  
C2 Update authentication middleware for API key validation  
C3 Remove OAuth routes and update session management  
C4 Update environment variables and secrets

Chunk D – Resource Updates  
D1 Update resource URIs for Last.fm (lastfm://track/{id}, etc.)  
D2 Implement resource handlers for tracks, albums, artists  
D3 Add user profile and listening history resources  
D4 Test new resource implementations

Chunk E – Tool Conversion  
E1 Replace collection tools with Last.fm equivalents  
E2 Implement get_recent_tracks, get_top_artists, get_loved_tracks  
E3 Implement get_listening_stats and get_music_recommendations  
E4 Update tool schemas and parameter validation

Chunk F – Prompt Adaptation  
F1 Update prompts for Last.fm use cases  
F2 Create listening_insights, music_discovery prompts  
F3 Update browse_music prompt for Last.fm data  
F4 Test prompt generation and responses

Chunk G – Configuration Updates  
G1 Update wrangler.toml for Last.fm environment  
G2 Update environment variable names and secrets  
G3 Update Claude Desktop configuration examples  
G4 Test deployment configuration

Chunk H – Testing & Validation  
H1 Update test suites for Last.fm API mocking  
H2 Validate all MCP protocol compliance  
H3 Add integration tests for Last.fm scenarios  
H4 End-to-end testing with Claude Desktop

Chunk I – Documentation  
I1 Update README with Last.fm setup instructions  
I2 Create Last.fm-specific usage examples  
I3 Update API documentation and schemas  
I4 Add troubleshooting guide for Last.fm issues

---

## 4 – Right-Sized Step Check

• Each step touches ≤ 2 files (avg) or adds a new isolated module.  
• Every new module is imported by the end of its step—no orphans.  
• Tests or build run green after every step.  
• No step mixes unrelated concerns (e.g., auth vs. MCP protocol).  
Result: steps are "small enough to be safe, big enough to advance".

---

## 5 – LLM Prompt Series

Copy-paste each prompt (in order) into your favorite code-gen LLM.  
Every prompt assumes all previous code now exists.

### Prompt 01 – Project Metadata Update

```text
Update the cloned Last.fm MCP server project metadata.

Task:
1. Update `package.json` name to "lastfm-mcp" and description to reference Last.fm.
2. Update keywords to include "lastfm", "music", "scrobbling".
3. Update the main README.md to describe Last.fm MCP server purpose.
4. Update any Discogs references to Last.fm throughout the project.

Return only the modified files with full contents.
```

### Prompt 02 – Lint & Format

```text
Add ESLint and Prettier support.

Requirements:
• Install `eslint`, `@typescript-eslint/*`, `prettier`, `eslint-config-prettier`.
• Create `.eslintrc.cjs` extending `@typescript-eslint/recommended` + Prettier.
• Add `.prettierrc` (singleQuote=true, semi=false).
• Add npm scripts: "lint", "format", "format:check".
Update any existing ts files to satisfy the linter (no unused vars).
```

### Prompt 03 – CI Workflow

```text
Create `.github/workflows/ci.yml`.

Jobs:
1. Install → lint → test → build.
2. Cache npm deps.
3. Run on push and pull_request.

Assume current scripts: lint, test, build exist.
```

### Prompt 04 – JSON-RPC Parser

```text
Implement JSON-RPC 2.0 message handling for MCP.

Files to create/modify:
• src/types/jsonrpc.ts
    - Define Request, Response, Error, Notification types
    - Follow JSON-RPC 2.0 spec
• src/protocol/parser.ts
    - parseMessage(body: string): validate and parse JSON-RPC
    - createResponse(id, result): create success response
    - createError(id, code, message): create error response
• Add tests for message parsing and creation
```

### Prompt 05 – MCP Initialize Handler

```text
Implement MCP initialize/initialized protocol flow.

Create src/protocol/handlers.ts:
• handleInitialize(params): validate protocol version, return capabilities
• Server capabilities: resources, tools, prompts
• Protocol version: "2024-11-05"

Update src/index.ts:
• Route "initialize" method to handler
• Send capabilities response
• Handle "initialized" notification

Add tests for initialization flow.
```

### Prompt 06 – SSE Transport

```text
Add Server-Sent Events transport for MCP.

Modify src/index.ts:
• GET /sse → SSE endpoint for server-to-client messages
• POST / → receive JSON-RPC messages from client
• Store SSE connections for bidirectional communication

Create src/transport/sse.ts:
• SSE connection management
• Message broadcasting
• Connection cleanup

Test SSE message flow.
```

### Prompt 07 – Last.fm Web Authentication

```text
Replace Discogs OAuth with Last.fm web authentication flow.

Steps:
1. Create src/auth/lastfm.ts with functions:
    - getAuthUrl(apiKey: string, callbackUrl: string)
    - getSessionKey(token: string, apiKey: string, secret: string)
    - generateMethodSignature(params: object, secret: string)
2. Implement MD5 signing for authenticated requests.
3. Store Last.fm API key and shared secret in Wrangler secrets.
4. Add /login and /callback routes for authentication flow.

Return full code and placeholder env names.
```

### Prompt 08 – Last.fm Authentication Routes

```text
Wire Last.fm authentication routes.

Modify src/index.ts:
• GET /login → redirect user to Last.fm authorize URL.
• GET /callback → exchange token for session key, set signed JWT cookie, return "Logged in!"
• Add auth check to MCP handlers (except initialize)

Add tests mocking fetch to Last.fm endpoints.
```

### Prompt 09 – KV Logger

```text
Create src/utils/kvLogger.ts.

• Export async log(userId, method, params, result) → put JSON into KV namespace MCP_LOGS with TTL 30d.
• Log all MCP method calls
• Include timestamp and latency
• Update tests to assert KV put is called.
```

### Prompt 10 – Rate Limiter

```text
Implement per-user rate limiting.

• src/utils/rateLimit.ts — sliding window: X/min, Y/hour (env vars).
• Use KV MCP_RL with atomic increments.
• Return JSON-RPC error -32000 with rate limit message when exceeded.
Add unit tests for limit reset & block.
```

### Prompt 11 – Last.fm Client

```text
Replace Discogs client with Last.fm API wrapper.

File src/clients/lastfm.ts:
• getRecentTracks(username, apiKey, limit?, from?, to?)
• getTopArtists(username, apiKey, period?, limit?)
• getTopAlbums(username, apiKey, period?, limit?)
• getLovedTracks(username, apiKey, limit?)
• getTrackInfo(artist, track, apiKey, username?)
• getArtistInfo(artist, apiKey, username?)
• getAlbumInfo(artist, album, apiKey, username?)
• getUserInfo(username, apiKey)
• getSimilarArtists(artist, apiKey, limit?)
• getSimilarTracks(artist, track, apiKey, limit?)

Include User-Agent header, Last.fm API rate limiting, retry logic.
Include comprehensive type definitions for Last.fm API responses.
Add error handling for API failures and rate limits.
```

### Prompt 12 – Last.fm Resources Implementation

```text
Implement MCP resources for Last.fm.

Add to src/protocol/handlers.ts:
• handleListResources(): return available Last.fm resources
• handleReadResource(uri): read specific Last.fm resource

Resources:
• lastfm://track/{artist}/{track}
• lastfm://artist/{artist}
• lastfm://album/{artist}/{album}
• lastfm://user/{username}/recent
• lastfm://user/{username}/top-artists
• lastfm://user/{username}/top-albums
• lastfm://user/{username}/loved
• lastfm://user/{username}/profile
• lastfm://artist/{artist}/similar
• lastfm://track/{artist}/{track}/similar

Return proper MCP resource format with Last.fm data.
Include pagination support and error handling.
```

### Prompt 13 – Last.fm Tools Implementation

```text
Implement MCP tools for Last.fm.

Add to src/protocol/handlers.ts:
• handleListTools(): return Last.fm tool definitions
• handleCallTool(name, arguments): execute Last.fm tool

Tools:
• get_recent_tracks(username, limit?, from?, to?)
• get_top_artists(username, period?, limit?)
• get_top_albums(username, period?, limit?)
• get_loved_tracks(username, limit?)
• get_track_info(artist, track, username?)
• get_artist_info(artist, username?)
• get_album_info(artist, album, username?)
• get_user_info(username)
• get_similar_artists(artist, limit?)
• get_similar_tracks(artist, track, limit?)
• get_listening_stats(username, period?)
• get_music_recommendations(username, genre?, limit?)

Include proper schemas, validation, and descriptions for Last.fm data.
Add comprehensive error handling and parameter validation.
```

### Prompt 14 – Last.fm Prompts Implementation

```text
Implement MCP prompts for Last.fm.

Add to src/protocol/handlers.ts:
• handleListPrompts(): return Last.fm prompt definitions
• handleGetPrompt(name, arguments?): return prompt messages

Prompts:
• listening_insights(username)
• music_discovery(username, genre?)
• track_analysis(artist, track)
• album_analysis(artist, album)
• artist_analysis(artist)
• listening_habits(username)

Return proper MCP prompt format for Last.fm use cases.
```

### Prompt 15 – Error Handling

```text
Enhance error handling for MCP compliance.

1. Wrap all handlers in try/catch → proper JSON-RPC errors
2. Map Last.fm API errors to MCP error codes
3. Add comprehensive request validation
4. Handle rate limiting gracefully
5. Implement retry logic with exponential backoff
6. Add timeout handling
7. Test all error scenarios
8. Provide user-friendly error messages
```

### Prompt 16 – Integration Tests

```text
Add comprehensive MCP protocol tests.

• Test full initialize flow
• Test authentication flow end-to-end
• Test resources/list and resources/read for all resource types
• Test tools/list and tools/call for all tools
• Test prompts/list and prompts/get for all prompts
• Test error handling and edge cases
• Mock Last.fm API responses with realistic data
• Test rate limiting behavior
• Validate JSON-RPC compliance
• Test with different user scenarios
```

### Prompt 17 – Deploy Workflow

```text
Update `.github/workflows/ci.yml`:

• On push to `main`, after tests build & publish with `wrangler publish --env production`.
• Store secrets: CF_API_TOKEN, CF_ACCOUNT_ID, Last.fm API key and secret in repo settings.
• Add environment-specific deployments (dev, staging, production).
• Include health checks after deployment.
• Add rollback capability on deployment failure.
• Monitor deployment metrics and logs.

Add a "Deploy succeeded" comment to PRs on success.
```

---

You now have an actionable, incremental build plan and a corresponding set of self-contained LLM prompts that progressively assemble the Discogs MCP Server without large leaps in complexity or unintegrated code.
