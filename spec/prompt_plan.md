# Prompt Plan

Below is a complete roadmap that goes from "big picture" → "progressively smaller chunks" → "atomic, right-sized steps" → "ready-to-paste LLM prompts".  
All prompts are wrapped in triple-back-tick blocks with the language tag `text`.

---

## 1 – High-Level Blueprint

1. Foundation & Tooling  
   1.1 Repository, CI, linting/formatting  
   1.2 Wrangler-based Cloudflare Workers scaffold (TypeScript)
2. Core Runtime  
   2.1 HTTP handler + MCP envelope  
   2.2 Command router & parser
3. Security & Observability  
   3.1 Discogs OAuth flow  
   3.2 Workers KV request logging  
   3.3 Per-user rate limiting
4. Core Features  
   4.1 Basic release lookup  
   4.2 Detailed release lookup  
   4.3 Search  
   4.4 Collection stats  
   4.5 Recommendations (w/ optional Last.fm)
5. UX & Resilience  
   5.1 Friendly error handling + unknown-command help  
   5.2 Markdown response templates
6. Quality Gates  
   6.1 Unit tests, integration tests, snapshot tests  
   6.2 CI workflow, preview deploys on push
7. Launch & Beyond  
   7.1 Production deploy  
   7.2 Post-launch monitoring, future enhancements

---

## 2 – First Pass: Iterative Chunks

Chunk A – Project Skeleton  
• Create repo → Wrangler init → TypeScript, ESLint & Prettier → GitHub CI

Chunk B – Hello MCP  
• Minimal Worker handler → Echo MCP messages ("ping" → "pong")

Chunk C – Auth Layer  
• Discogs OAuth endpoints → Session cookie/JWT → Guard router

Chunk D – Infra Utilities  
• KV logging module → Rate limiter middleware

Chunk E – Catalog Basics  
• Discogs REST client → `/release <id>` & `/search` commands

Chunk F – Collection Insights  
• Stats computation helpers → `stats` command

Chunk G – Recommendations  
• Rule-based recommender → optional Last.fm enrichment

Chunk H – Polish & Tests  
• Markdown templates → Error fallbacks → Jest & MSW tests → CI green

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

Chunk B – Hello MCP  
B1 Create `src/router.ts` with simple string-based dispatcher  
B2 Update `src/index.ts` to call router and return Markdown echo  
B3 Write first Jest test: "ping" → "pong"

Chunk C – Auth Layer  
C1 Create `src/auth/discogs.ts` wrapper (request token, callback, access token)  
C2 Add `/login` and `/callback` routes in Worker  
C3 Persist user session in cookie (signed JWT)  
C4 Middleware to reject unauthenticated MCP commands

Chunk D – Infra Utilities  
D1 Write `kvLogger` (put entry + TTL)  
D2 Create `rateLimit` middleware (KV counter + 429)  
D3 Wire logger & limiter into main handler and extend tests

Chunk E – Catalog Basics  
E1 Implement Discogs REST client util (`/releases/{id}`, `/database/search`)  
E2 Add `/release <id>` MCP command (basic fields)  
E3 Add `/search <query>` command (limit 3)  
E4 Snapshot-test Markdown output

Chunk F – Collection Insights  
F1 Add `/collection/stats` API call sequence  
F2 Compute aggregates (genres, decades, etc.)  
F3 Expose `stats` command with Markdown sections

Chunk G – Recommendations  
G1 Draft rule engine (mood, genre, decade filters)  
G2 Integrate optional Last.fm playcounts (mock if not linked)  
G3 `listen` command returns up to 3 releases

Chunk H – Polish & Tests  
H1 Global error boundary returns friendly Markdown  
H2 Unknown-command help template  
H3 Increase Jest coverage (router, auth, utilities)  
H4 Add end-to-end MSW test: full OAuth → `/release`

Chunk I – Deploy  
I1 Add `.dev.vars` & `wrangler.toml` prod vars (KV, secrets)  
I2 GitHub Action: test → build → `wrangler publish` on `main`

---

## 4 – Right-Sized Step Check

• Each step touches ≤ 2 files (avg) or adds a new isolated module.  
• Every new module is imported by the end of its step—no orphans.  
• Tests or build run green after every step.  
• No step mixes unrelated concerns (e.g., auth vs. Discogs client).  
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

### Prompt 04 – Router Skeleton

```text
Implement a simple command router.

Files to create/modify:
• src/router.ts
    - export `route(command: string): Promise<string>`
    - if command === 'ping' → 'pong'
    - unknown → 'Unknown command'
• src/index.ts
    - parse raw text body
    - call `route()` and return Markdown response
• Add Jest test router.test.ts covering ping & unknown.
```

### Prompt 05 – Discogs OAuth (Part 1)

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

### Prompt 06 – Discogs OAuth (Part 2)

```text
Wire OAuth routes.

Modify src/index.ts:
• GET /login → redirect user to Discogs authorize URL.
• GET /callback → exchange tokens, set signed JWT cookie, return "Logged in!"
• All MCP commands after auth must check cookie and 401 if missing.

Add Jest test mocking fetch to Discogs endpoints.
```

### Prompt 07 – KV Logger

```text
Create src/utils/kvLogger.ts.

• Export async log(userId, original, intent, meta) → put JSON into KV namespace MCP_LOGS with TTL 30d.
• Inject logger middleware into main handler (after auth).
• Update tests to assert KV put is called.
```

### Prompt 08 – Rate Limiter

```text
Implement per-user rate limiting.

• src/utils/rateLimit.ts — sliding window: X/min, Y/hour (env vars).
• Use KV MCP_RL with atomic increments.
• Middleware returns 429 with Markdown advice when exceeded.
Add unit tests for limit reset & block.
```

### Prompt 09 – Discogs Client

```text
Add REST wrapper.

File src/clients/discogs.ts:
• getRelease(id)
• search(query, opts)
Both include User-Agent header and user OAuth token.

Include type defs for minimal fields needed in spec.
```

### Prompt 10 – `/release` Command

```text
Extend router.

• Command pattern: `release <id>`
• Call getRelease(), map fields: title, artist, year, format, genres, url, thumb.
• Return Markdown table.

Add Jest snapshot test.
```

### Prompt 11 – `/search` Command

```text
Add `search <terms>` routing.

• Limit 3 results.
• Return bulleted Markdown list with title – artist (year) link.

Update tests & snapshots.
```

### Prompt 12 – Collection Stats

```text
Implement `stats` command.

• Hit Discogs collection endpoints (per-user).
• Compute: total, top genres, top artists, decade histogram.
• Format as Markdown with subsections.

Provide unit test with mocked API response.
```

### Prompt 13 – Recommendations

```text
Add `listen [mood|genre|decade]` command.

• Filter by params.
• If Last.fm linked → exclude high play-count releases.
• Return up to 3 suggestions with cover thumbnails.

Stub Last.fm client (returns empty list if not linked).
```

### Prompt 14 – Error & Help

```text
Global enhancements:

1. Wrap router in try/catch → user-friendly error Markdown.
2. Unknown command → Markdown help hinting at 'release', 'search', 'stats', 'listen'.
3. Snapshot tests for error & help responses.
```

### Prompt 15 – Test Suite & Coverage

```text
Increase coverage to ≥ 80%.

• Add MSW to mock Discogs & Last.fm in integration tests.
• Add snapshot tests for Markdown outputs.
• Ensure `npm run test` passes with coverage threshold.
```

### Prompt 16 – Deploy Workflow

```text
Update `.github/workflows/ci.yml`:

• On push to `main`, after tests build & publish with `wrangler publish --env production`.
• Store secrets: CF_API_TOKEN, CF_ACCOUNT_ID, Discogs keys in repo settings.

Add a "Deploy succeeded" comment to PRs on success.
```

---

You now have an actionable, incremental build plan and a corresponding set of self-contained LLM prompts that progressively assemble the Discogs MCP Server without large leaps in complexity or unintegrated code.
