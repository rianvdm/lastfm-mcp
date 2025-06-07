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
- [ ] **C3** Persist user session via signed JWT cookie
- [ ] **C4** Add auth check to MCP handlers (except initialize)
- [ ] **C5** Write tests mocking Discogs endpoints

## Chunk D – Infrastructure Utilities

- [ ] **D1** Create `kvLogger` module (Workers KV request logging)
- [ ] **D2** Implement `rateLimit` middleware (per-user sliding window)
- [ ] **D3** Wire logger & limiter into main handler
- [ ] **D4** Add unit tests for logging and rate limiting

## Chunk E – MCP Resources

- [ ] **E1** Build Discogs REST client (`src/clients/discogs.ts`)
- [ ] **E2** Add resources/list handler
- [ ] **E3** Add resources/read handler for releases and collection
- [ ] **E4** Test resource responses

## Chunk F – MCP Tools

- [ ] **F1** Add tools/list handler
- [ ] **F2** Implement search_collection tool
- [ ] **F3** Implement get_release and get_collection_stats tools
- [ ] **F4** Implement get_recommendations tool

## Chunk G – MCP Prompts

- [ ] **G1** Add prompts/list handler
- [ ] **G2** Implement browse_collection prompt
- [ ] **G3** Implement find_music and collection_insights prompts
- [ ] **G4** Test prompt responses

## Chunk H – Polish & Test Coverage

- [ ] **H1** Proper JSON-RPC error responses
- [ ] **H2** MCP protocol compliance validation
- [ ] **H3** Integration tests with mock MCP client
- [ ] **H4** End-to-end test: initialize → auth → use tools

## Chunk I – Deployment

- [ ] **I1** Configure Wrangler environments & secrets (`wrangler.toml`)
- [ ] **I2** Extend CI workflow to publish to production on `main`
- [ ] **I3** Verify production deploy & test with Claude Desktop

---

### Ongoing Quality Gates

- [ ] Lint passes (`npm run lint`)
- [ ] Unit tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Code coverage ≥ 80 percent
- [ ] MCP protocol compliance validated

> **Tip:** This checklist now reflects building a proper MCP server that will work with Claude Desktop and other MCP clients.
