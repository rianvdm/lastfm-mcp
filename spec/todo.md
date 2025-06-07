# Discogs MCP Server – Development Checklist

> Use this file as a living checklist. Mark each `[ ]` entry as `[x]` when complete.

---

## Chunk A – Project Skeleton

- [x] **A1** Initialize Git repo & add root `README.md`
- [x] **A2** Run `wrangler init discogs-mcp --ts` and commit scaffold
- [ ] **A3** Add ESLint & Prettier configs and npm scripts (`lint`, `format`)
- [ ] **A4** Create GitHub Actions workflow for `lint`, `test`, and `build`

## Chunk B – Hello MCP

- [ ] **B1** Create `src/router.ts` with basic dispatcher (`ping` → `pong`)
- [ ] **B2** Update `src/index.ts` to call router and return Markdown response
- [ ] **B3** Add Jest test for `ping` and unknown command cases

## Chunk C – Authentication Layer

- [ ] **C1** Implement Discogs OAuth utility (`src/auth/discogs.ts`)
- [ ] **C2** Add `/login` + `/callback` routes for OAuth handshake
- [ ] **C3** Persist user session via signed JWT cookie
- [ ] **C4** Add middleware to block unauthenticated MCP commands
- [ ] **C5** Write Jest tests mocking Discogs endpoints

## Chunk D – Infrastructure Utilities

- [ ] **D1** Create `kvLogger` module (Workers KV request logging)
- [ ] **D2** Implement `rateLimit` middleware (per-user sliding window)
- [ ] **D3** Wire logger & limiter into main handler
- [ ] **D4** Add unit tests for logging and rate limiting

## Chunk E – Catalog Basics

- [ ] **E1** Build Discogs REST client (`src/clients/discogs.ts`)
- [ ] **E2** Add `release <id>` MCP command (basic release lookup)
- [ ] **E3** Add `search <query>` MCP command (limit 3 results)
- [ ] **E4** Snapshot-test Markdown outputs for release & search

## Chunk F – Collection Insights

- [ ] **F1** Fetch user collection and compute aggregate stats
- [ ] **F2** Implement `stats` command with Markdown sections
- [ ] **F3** Add unit tests with mocked collection data

## Chunk G – Recommendations

- [ ] **G1** Design rule-based recommendation engine (mood/genre/decade)
- [ ] **G2** Integrate optional Last.fm play-count filtering
- [ ] **G3** Expose `listen` command returning up to 3 releases
- [ ] **G4** Snapshot-test recommendation Markdown output

## Chunk H – Polish & Test Coverage

- [ ] **H1** Add global error boundary with friendly Markdown messages
- [ ] **H2** Implement unknown-command help template
- [ ] **H3** Increase Jest/MSW coverage to ≥ 80 percent
- [ ] **H4** Add end-to-end test: OAuth → `release` flow

## Chunk I – Deployment

- [ ] **I1** Configure Wrangler environments & secrets (`wrangler.toml`)
- [ ] **I2** Extend CI workflow to publish to production on `main`
- [ ] **I3** Verify production deploy & add monitoring/logging alerts

---

### Ongoing Quality Gates

- [ ] Lint passes (`npm run lint`)
- [ ] Unit tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Code coverage ≥ 80 percent
- [ ] Markdown response snapshots up-to-date

> **Tip:** re-order or add tasks as the project evolves. This file should always reflect the current development plan.
