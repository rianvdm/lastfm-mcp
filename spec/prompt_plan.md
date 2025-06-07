# Prompt Plan

Below is a complete roadmap that goes from "big picture" → "progressively smaller chunks" → "atomic, right-sized steps" → "ready-to-paste LLM prompts".  
All prompts are wrapped in triple-back-tick blocks with the language tag `text`.

---

## 1 – High-Level Blueprint

1. Foundation & Tooling  
   1.1 Repository, CI, linting/formatting  
   1.2 Wrangler-based Cloudflare Workers scaffold (TypeScript)
2. Core Runtime  
   2.1 HTTP handler + MCP JSON-RPC envelope  
   2.2 MCP protocol implementation (initialize, capabilities)
3. Security & Observability  
   3.1 Discogs OAuth flow  
   3.2 Workers KV request logging  
   3.3 Per-user rate limiting
4. Core Features  
   4.1 MCP Resources (release, collection, search)  
   4.2 MCP Tools (search_collection, get_release, etc.)  
   4.3 MCP Prompts (browse, find, insights)  
   4.4 Collection stats tool  
   4.5 Recommendations tool (w/ optional Last.fm)
5. UX & Resilience  
   5.1 Proper JSON-RPC error handling  
   5.2 MCP-compliant error responses
6. Quality Gates  
   6.1 Unit tests, integration tests, MCP protocol tests  
   6.2 CI workflow, preview deploys on push
7. Launch & Beyond  
   7.1 Production deploy  
   7.2 Post-launch monitoring, future enhancements

---

## 2 – First Pass: Iterative Chunks

Chunk A – Project Skeleton  
• Create repo → Wrangler init → TypeScript, ESLint & Prettier → GitHub CI

Chunk B – MCP Protocol Foundation  
• HTTP SSE transport → JSON-RPC parser → MCP initialize handler

Chunk C – Auth Layer  
• Discogs OAuth endpoints → Session cookie/JWT → Guard MCP methods

Chunk D – Infra Utilities  
• KV logging module → Rate limiter middleware

Chunk E – MCP Resources  
• Implement resources/list → resources/read → Release & collection resources

Chunk F – MCP Tools  
• Implement tools/list → tools/call → Search, stats, recommendations

Chunk G – MCP Prompts  
• Implement prompts/list → prompts/get → Browse, find, insights prompts

Chunk H – Polish & Tests  
• Error handling → MCP compliance tests → Integration tests

Chunk I – Deploy  
• Prod Wrangler environment → Preview + prod GitHub actions

---

## 3 – Second Pass: Atomic Steps

Below, each chunk is split into 2-to-4 digestible steps that fit in a single PR/session.

Chunk A – Project Skeleton  
A1 Initialize Git repo & README  
A2 Run `wrangler init discogs-mcp --ts` & commit  
A3 Add ESLint + Prettier configs & npm scripts  
A4 Add GitHub Actions workflow (`test`, `lint`, `build`)

Chunk B – MCP Protocol Foundation  
B1 Create JSON-RPC message parser and types  
B2 Implement MCP initialize/initialized flow  
B3 Add SSE transport endpoints  
B4 Write tests for protocol handling

Chunk C – Auth Layer  
C1 Create `src/auth/discogs.ts` wrapper (request token, callback, access token)  
C2 Add `/login` and `/callback` routes in Worker  
C3 Persist user session in cookie (signed JWT)  
C4 Middleware to reject unauthenticated MCP methods

Chunk D – Infra Utilities  
D1 Write `kvLogger` (put entry + TTL)  
D2 Create `rateLimit` middleware (KV counter + 429)  
D3 Wire logger & limiter into main handler and extend tests

Chunk E – MCP Resources  
E1 Implement Discogs REST client util  
E2 Add resources/list handler  
E3 Add resources/read handler for releases and collection  
E4 Test resource responses

Chunk F – MCP Tools  
F1 Add tools/list handler  
F2 Implement search_collection tool  
F3 Implement get_release and get_collection_stats tools  
F4 Implement get_recommendations tool

Chunk G – MCP Prompts  
G1 Add prompts/list handler  
G2 Implement browse_collection prompt  
G3 Implement find_music and collection_insights prompts  
G4 Test prompt responses

Chunk H – Polish & Tests  
H1 Proper JSON-RPC error responses  
H2 MCP protocol compliance validation  
H3 Integration tests with mock MCP client  
H4 End-to-end test: initialize → auth → use tools

Chunk I – Deploy  
I1 Add `.dev.vars` & `wrangler.toml` prod vars (KV, secrets)  
I2 GitHub Action: test → build → `wrangler publish` on `main`

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

### Prompt 01 – Repo & Wrangler Init

```text
You are coding in an empty Git repo called "discogs-mcp".

Task:
1. Run `wrangler init discogs-mcp --ts`.
2. Ensure `package.json` uses "type": "module" and Node ≥ 20.
3. Add `.gitignore` for node_modules & Wrangler artifacts.
4. Add a minimal `README.md` describing the project purpose.

Return only the created/modified files with full contents.
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

### Prompt 07 – Discogs OAuth (Part 1)

```text
Add Discogs OAuth utilities.

Steps:
1. Create src/auth/discogs.ts with functions:
    - getRequestToken()
    - getAccessToken(oauthToken, oauthVerifier)
2. Use oauth-1.0a + crypto (HMAC-SHA1).
3. Store consumer key/secret in Wrangler secrets.

Return full code and placeholder env names.
```

### Prompt 08 – Discogs OAuth (Part 2)

```text
Wire OAuth routes.

Modify src/index.ts:
• GET /login → redirect user to Discogs authorize URL.
• GET /callback → exchange tokens, set signed JWT cookie, return "Logged in!"
• Add auth check to MCP handlers (except initialize)

Add Jest test mocking fetch to Discogs endpoints.
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

### Prompt 11 – Discogs Client

```text
Add REST wrapper.

File src/clients/discogs.ts:
• getRelease(id, token)
• searchCollection(query, token, opts)
• getCollectionStats(token)
Both include User-Agent header and user OAuth token.

Include type defs for Discogs API responses.
```

### Prompt 12 – Resources Implementation

```text
Implement MCP resources.

Add to src/protocol/handlers.ts:
• handleListResources(): return available resources
• handleReadResource(uri): read specific resource

Resources:
• discogs://release/{id}
• discogs://collection
• discogs://search?q={query}

Return proper MCP resource format with contents.
```

### Prompt 13 – Tools Implementation

```text
Implement MCP tools.

Add to src/protocol/handlers.ts:
• handleListTools(): return tool definitions
• handleCallTool(name, arguments): execute tool

Tools:
• search_collection(query, limit?)
• get_release(release_id)
• get_collection_stats()
• get_recommendations(mood?, genre?, decade?)

Include proper schemas and descriptions.
```

### Prompt 14 – Prompts Implementation

```text
Implement MCP prompts.

Add to src/protocol/handlers.ts:
• handleListPrompts(): return prompt definitions
• handleGetPrompt(name, arguments?): return prompt messages

Prompts:
• browse_collection
• find_music(query)
• collection_insights

Return proper MCP prompt format.
```

### Prompt 15 – Error Handling

```text
Enhance error handling for MCP compliance.

1. Wrap all handlers in try/catch → proper JSON-RPC errors
2. Map Discogs API errors to MCP error codes
3. Add request validation
4. Test error scenarios
```

### Prompt 16 – Integration Tests

```text
Add comprehensive MCP protocol tests.

• Test full initialize flow
• Test resources/list and resources/read
• Test tools/list and tools/call
• Test error handling
• Mock Discogs API responses
• Validate JSON-RPC compliance
```

### Prompt 17 – Deploy Workflow

```text
Update `.github/workflows/ci.yml`:

• On push to `main`, after tests build & publish with `wrangler publish --env production`.
• Store secrets: CF_API_TOKEN, CF_ACCOUNT_ID, Discogs keys in repo settings.

Add a "Deploy succeeded" comment to PRs on success.
```

---

You now have an actionable, incremental build plan and a corresponding set of self-contained LLM prompts that progressively assemble the Discogs MCP Server without large leaps in complexity or unintegrated code.
