# Discogs MCP Server – Development Checklist

> Use this file as a living checklist. Mark each `[ ]` entry as `[x]` when complete.

---

## Chunk A – Project Skeleton

- [x] **A1** Initialize Git repo & add root `README.md`
- [x] **A2** Run `wrangler init discogs-mcp --ts` and commit scaffold
- [x] **A3** Add ESLint & Prettier configs and npm scripts (`lint`, `format`)
- [x] **A4** Create GitHub Actions workflow for `lint`, `test`, and `build`

## Chunk B – MCP Protocol Foundation

- [x] **B1** Create JSON-RPC message parser and types
- [x] **B2** Implement MCP initialize/initialized flow
- [x] **B3** Add SSE transport endpoints
- [x] **B4** Write tests for protocol handling

## Chunk C – Authentication Layer

- [x] **C1** Implement Discogs OAuth utility (`src/auth/discogs.ts`)
- [x] **C2** Add `/login` + `/callback` routes for OAuth handshake
- [x] **C3** Persist user session via signed JWT cookie
- [x] **C4** Add auth check to MCP handlers (except initialize)
- [x] **C5** Write tests mocking Discogs endpoints

## Chunk D – Infrastructure Utilities

- [x] **D1** Create `kvLogger` module (Workers KV request logging)
- [x] **D2** Implement `rateLimit` middleware (per-user sliding window)
- [x] **D3** Wire logger & limiter into main handler
- [x] **D4** Add unit tests for logging and rate limiting

## Chunk E – MCP Resources

- [x] **E1** Build Discogs REST client (`src/clients/discogs.ts`)
- [x] **E2** Add resources/list handler
- [x] **E3** Add resources/read handler for releases and collection
- [x] **E4** Test resource responses

## Chunk F – MCP Tools

- [x] **F1** Add tools/list handler
- [x] **F2** Implement search_collection tool (✅ Fixed: Now properly filters collection with client-side search)
- [x] **F3** Implement get_release and get_collection_stats tools
- [x] **F4** Implement get_recommendations tool

## Chunk G – MCP Prompts

- [x] **G1** Add prompts/list handler
- [x] **G2** Implement browse_collection prompt
- [x] **G3** Implement find_music and collection_insights prompts
- [x] **G4** Test prompt responses

## Chunk H – Polish & Test Coverage

- [x] **H1** Proper JSON-RPC error responses
- [x] **H2** MCP protocol compliance validation
- [x] **H3** Integration tests with mock MCP client
- [x] **H4** End-to-end test: initialize → auth → use tools

## Chunk I – Deployment

- [x] **I1** Configure Wrangler environments & secrets (`wrangler.toml`)
- [x] **I2** Extend CI workflow to publish to production on `main`
- [x] **I3** Verify production deploy & test with Claude Desktop

---

### Ongoing Quality Gates

- [x] Lint passes (`npm run lint`)
- [x] Unit tests pass (`npm test`) - 182 tests passing
- [x] Build succeeds (`npm run build`)
- [ ] Code coverage ≥ 80 percent
- [x] MCP protocol compliance validated

> **Tip:** This checklist now reflects building a proper MCP server that will work with Claude Desktop and other MCP clients.
