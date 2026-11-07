# Consent Page and OAuth Provider 1.x Upgrade: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `@cloudflare/workers-oauth-provider` to 1.x without breaking existing sessions or any current client, then put a consent page in front of the Last.fm redirect on `/authorize` (issue #40).

**Architecture:** PR 1 pins today's OAuth behaviour with tests, captures real 0.10.3 KV records as a fixture, adds a narrow `resource` rewrite (`<origin>/mcp` → `<origin>`) ahead of the library, and upgrades with the canonical resource set per request origin. PR 2 adds a pure consent-page renderer and wires the library's consent and upstream helpers into `/authorize` and `/lastfm-callback`, replacing the hand-rolled `oauth-pending:{state}` KV record.

**Tech Stack:** TypeScript (strict), Cloudflare Workers (workerd), `@cloudflare/workers-oauth-provider` 1.x, vitest 4 + `@cloudflare/vitest-pool-workers`, Node 22.

**Spec:** `docs/superpowers/specs/2026-10-25-consent-page-design.md`

## Global Constraints

- Follow the repo `CLAUDE.md`: two `// ABOUTME:` lines on every file, tabs, no semicolons, single quotes, 140 columns, `describe`/`it`, `import type` for types, no file extensions on relative imports.
- Node 22 (`.nvmrc`). Run tests with `npx vitest run`.
- **Lockfile:** `npm install` on this Mac strips `libc` fields and flips `dev`/`devOptional` flags in `package-lock.json`. Never commit that churn. For the version bump, hand-edit the `@cloudflare/workers-oauth-provider` entries (`version`, `resolved`, `integrity` from `npm view @cloudflare/workers-oauth-provider@<v> dist.integrity`) and the `package.json` range, then run `npm ci` to confirm the lockfile is valid. `git diff package-lock.json` must touch only that package.
- Library version: latest `1.x` at execution time (1.2.4 on 2026-10-25; it has no dependencies). Read `node_modules/@cloudflare/workers-oauth-provider/docs/migration-1.x.md`, `docs/consent-page.md` and `docs/upstream-sign-in.md` from the installed package before Tasks 4 and 6.
- Canonical resource: `${new URL(request.url).origin}` exactly (no trailing slash, no path).
- Resource rewrite: only a `resource` value equal to exactly `${origin}/mcp`, only on `GET /authorize` (query) and `POST /oauth/token` (`application/x-www-form-urlencoded` body).
- Leave `allowPrivateUseRedirectUris` off.
- `CONSENT_SECRET`: a Worker secret of at least 32 characters. Remember approvals for 30 days (library default) with no `subject`.
- The consent page renders client-supplied strings (name, domain, hostname) escaped, always.
- Consent page copy, exact:
  - Wordmark: `Last.fm MCP`
  - Headline: `An app wants to read your Last.fm listening data`
  - Intro: `If you continue, Last.fm will ask you to sign in. The app gets read-only access to your listening history and profile. It can't scrobble or change anything.`
  - CIMD note: `Published by {clientDomain} (verified)`
  - DCR note: `The app chose this name itself. It hasn't been checked.` (name shown in quotes)
  - Row labels: `App`, `Access goes to`
  - Loopback warning: `This sends access to an app on your computer. Continue only if you just started connecting from that app.`
  - Buttons: `Continue to Last.fm` (`name="decision" value="approve"`), `Don't allow` (`value="deny"`)
  - Non-loopback fine print: `You won't be asked again for this app for 30 days.`
  - Privacy link: `https://elezea.com/privacy/#lastfm-mcp-server`
- Visual tokens (from elezea.com): background `#fff`, text `#444`, headings `#1b1b1b`, muted `#767676`, rules `#ddd`, accent `#ff6c00`, warning border `#ffe670` on `#fff8d6`, 5px radius, 17px body, max column width 560px, serif stack `Georgia, Cambria, "Times New Roman", Times, serif`. No external fonts or scripts.
- Consent response headers: the library's `beginConsent()` headers, plus `Content-Type: text/html; charset=utf-8`. No `form-action` directive in any CSP on `/authorize`.
- **Production actions** (KV reads beyond what's done, `wrangler secret put`, `npm run deploy`, `npm run deploy:prod`, rollback): prepare the exact command, then stop and wait for Rian's go-ahead.

## Review Focus

1. A client that sends `resource=https://lastfm-mcp.com/mcp` on refresh while holding an origin-bound grant (any client that signed in after the upgrade). It must refresh normally. Test: Task 1's matrix refreshes with the same variant it signed in with, after the upgrade.
2. A consent form submitted from a different browser than the one that opened it, submitted twice, or submitted after ten minutes. It must get a local "start again" page, never a redirect to the client. Test: Task 7, "replayed handle" and "POST without the binding cookie".
3. The staging Worker on its workers.dev host. It must use its own origin as the resource, not `https://lastfm-mcp.com`. Test: Task 1's matrix runs once on `https://lastfm-mcp.rian-db8.workers.dev`.
4. Approve and Deny redirects in Chrome. A `form-action` CSP would block them silently. Test: Task 7 asserts the `/authorize` response CSP has no `form-action`. Task 8 checks it in a real browser.
5. A client name containing HTML or quotes. It must render as text. Test: Task 6, the escaping case.

---

## PR 1: Library upgrade

### Task 1: Characterization tests for the OAuth round trip on 0.10.3

**Files:**
- Create: `test/helpers/oauth-flow.ts`
- Create: `test/oauth-resource-compat.test.ts`

**Interfaces:**
- Produces, in `test/helpers/oauth-flow.ts`:
  - `type ResourceVariant = { label: string; resource: (origin: string) => string | undefined }`
  - `const RESOURCE_VARIANTS: ResourceVariant[]` covers: none → `undefined`; origin → `origin`; origin with slash → `` `${origin}/` ``; mcp → `` `${origin}/mcp` ``.
  - `registerPublicClient(worker, env, origin: string, redirectUri: string): Promise<string>` returns `client_id`.
  - `signIn(worker, env, opts: { origin: string; clientId: string; redirectUri: string; resource?: string }): Promise<{ code: string; codeVerifier: string }>` runs `/authorize` → Last.fm `cb` → `/lastfm-callback` → client redirect. It carries cookies between steps (`headers.getSetCookie()` → `Cookie`) so PR 2 can add the consent step in one place.
  - `exchangeCode(worker, env, opts: { origin; clientId; redirectUri; code; codeVerifier; resource? }): Promise<Response>`
  - `refresh(worker, env, opts: { origin; clientId; refreshToken; resource? }): Promise<Response>`
  - `callMcp(worker, env, origin: string, accessToken: string): Promise<Response>` sends `initialize`.
- The helper does not mock Last.fm. Each test file keeps its own `vi.mock('../src/auth/lastfm', …)` (same class mock as `test/oauth-roundtrip.test.ts`).

- [ ] **Step 1: Write `test/oauth-resource-compat.test.ts`**

`describe.each` over two origins: `https://lastfm-mcp.com` and `https://lastfm-mcp.rian-db8.workers.dev`. Inside, `it.each(RESOURCE_VARIANTS)`:
`'should sign in, exchange, call a tool, refresh and call again when the client requests $label'`. Assertions:
- token exchange `200` with `access_token` and `refresh_token`
- `callMcp` → `200`
- `refresh` (same `resource` variant) → `200` with a new `access_token`
- `callMcp` with the new token → `200`

- [ ] **Step 2: Run it on 0.10.3 and confirm it passes**

Run: `npx vitest run test/oauth-resource-compat.test.ts`
Expected: 8 passing. If any fail on 0.10.3, stop and report: that's today's behaviour, and the plan assumed otherwise.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add test/helpers/oauth-flow.ts test/oauth-resource-compat.test.ts
git commit -m "test(auth): pin the OAuth round trip for every requested resource variant"
```

### Task 2: Capture a 0.10.3 KV fixture

**Files:**
- Create (temporary, deleted in this task): `test/capture-0x-grants.test.ts`
- Create: `test/fixtures/oauth-0x-grants.ts`

**Interfaces:**
- Produces `test/fixtures/oauth-0x-grants.ts`:
  - `interface CapturedGrant { label: 'none' | 'origin' | 'origin-slash' | 'mcp'; origin: string; clientId: string; refreshToken: string; requestedResource?: string }`
  - `const OAUTH_0X_KV: { key: string; value: string; metadata?: unknown }[]` holds every `OAUTH_KV` entry after the captures.
  - `const OAUTH_0X_GRANTS: CapturedGrant[]`
  - `loadOAuth0xFixture(kv: KVNamespace): Promise<void>` writes every entry, with no expiration.

- [ ] **Step 1: Write the capture test**

For each variant on `https://lastfm-mcp.com`, run `registerPublicClient` → `signIn` → `exchangeCode` with the helpers from Task 1. Each client signs in as its own Last.fm user (`capture-none`, `capture-origin`, `capture-origin-slash`, `capture-mcp`), so grants don't replace each other; mock `getSessionKey` per call. Then `env.OAUTH_KV.list()` and `get(key, 'text')` / `getWithMetadata` for every key. Print one line `FIXTURE_JSON <json>` containing the KV entries and the `CapturedGrant` list.

- [ ] **Step 2: Run it and write the fixture file**

Run: `npx vitest run test/capture-0x-grants.test.ts 2>&1 | grep '^FIXTURE_JSON' | head -1`
Write the JSON into `test/fixtures/oauth-0x-grants.ts` as typed constants. Add the ABOUTME lines, and a comment noting it was captured from 0.10.3 on the execution date and must never be regenerated on 1.x.

- [ ] **Step 3: Delete the capture test and confirm the suite passes**

Run: `rm test/capture-0x-grants.test.ts && npx vitest run`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/oauth-0x-grants.ts
git commit -m "test(auth): capture 0.10.3 OAuth KV records as an upgrade fixture"
```

### Task 3: Map `<origin>/mcp` to the origin before the provider sees it

**Files:**
- Create: `src/auth/resource-indicator.ts`
- Modify: `src/index-oauth.ts` (route-specific branches for `/authorize` and `/oauth/token` in the default export's `fetch`, just before `oauthProvider.fetch`)
- Test: `test/auth/resource-indicator.test.ts`

**Prior art:** discogs-mcp solved this on 2026-10-06 (`~/git/discogs-mcp/src/index-oauth.ts`: `normalizeAuthorizeResource`, `stripResourceParam`, `getOAuthProvider`). Read it before starting and reuse its names, wiring and request-rebuilding code. Two deliberate differences:
- `/oauth/token` gets the same narrow rewrite as `/authorize`. discogs strips `resource` from every token request. Rian chose the narrow rewrite on 2026-11-07 so the library keeps rejecting any other value with `invalid_target`.
- Repeated `resource` params are each checked. discogs checks only the first.

The functions live in their own module so they can be unit-tested and later copied back to discogs-mcp.

**Interfaces:**
- Produces, in `src/auth/resource-indicator.ts`:
  - `normalizeAuthorizeResource(request: Request, url: URL): Request` (same name and signature as discogs-mcp's)
  - `normalizeTokenResource(request: Request): Promise<Request>` (narrow-rewrite counterpart of discogs-mcp's `stripResourceParam`; same `POST` and `application/x-www-form-urlencoded` checks)
- Each one returns the same `Request` object when nothing changes, and otherwise a new `Request` with every `resource` value equal to `${origin}/mcp` replaced by the origin. Method, headers (including `Authorization`) and all other parameters are preserved.
- `src/index-oauth.ts` calls `normalizeAuthorizeResource` only when `url.pathname === '/authorize'` and `normalizeTokenResource` only when `url.pathname === '/oauth/token'`, as discogs-mcp does.

- [ ] **Step 1: Write the failing unit tests**

`describe('normalizeAuthorizeResource')` and `describe('normalizeTokenResource')`, with origin `https://lastfm-mcp.com`:
- `GET /authorize?resource=https://lastfm-mcp.com/mcp&state=x` → `resource` is `https://lastfm-mcp.com` and `state` is `x`.
- `POST /oauth/token`, form body `grant_type=refresh_token&refresh_token=r&resource=https%3A%2F%2Flastfm-mcp.com%2Fmcp` → body `resource` is `https://lastfm-mcp.com`, the other fields are unchanged, and `Authorization: Basic abc` is preserved.
- Unchanged (same object, `toBe`), in both functions, for each `resource` value:
  - `https://evil.example/mcp`
  - `https://lastfm-mcp.com/mcp/x`
  - `https://lastfm-mcp.com/mcp?x=1`
  - `https://lastfm-mcp.com/mcp-other`
  - `https://lastfm-mcp.com`
  - no `resource`
- `normalizeTokenResource` also leaves unchanged: `GET /oauth/token`, and `POST /oauth/token` with `Content-Type: application/json`.
- On a request to `https://lastfm-mcp.rian-db8.workers.dev/authorize`, `resource=https://lastfm-mcp.com/mcp` is unchanged, because a different host isn't mapped. Same for the token function.
- Repeated `resource` params, in both functions: each value equal to `${origin}/mcp` is replaced and the others are kept.
- Routing, in a worker-level test: `POST /oauth/register` and `GET /mcp?resource=https://lastfm-mcp.com/mcp` reach the provider untouched (neither function is called on those paths).

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run test/auth/resource-indicator.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both functions and wire them into `src/index-oauth.ts`**

Compare strings with `` `${url.origin}/mcp` ``, not with parsed URLs, so dot segments or encodings never match. The doc comment cites RFC 8707 §2.2 and the upstream issue (link added in Task 5).

- [ ] **Step 4: Run the unit tests and the full suite**

Run: `npx vitest run`
Expected: all pass, including Task 1's matrix on 0.10.3.

- [ ] **Step 5: Commit**

```bash
git add src/auth/resource-indicator.ts src/index-oauth.ts test/auth/resource-indicator.test.ts
git commit -m "feat(auth): map the /mcp resource indicator to the server origin"
```

### Task 4: Upgrade `@cloudflare/workers-oauth-provider` to 1.x

**Files:**
- Modify: `package.json`, `package-lock.json` (hand-edited, see Global Constraints)
- Modify: `src/index-oauth.ts` (provider per origin, `onError`, `WWW-Authenticate` rewrite)
- Modify: `src/auth/oauth-handler.ts` (delete `handleProtectedResourceMetadata` and its route)
- Create: `test/oauth-upgrade-survival.test.ts`
- Modify: `test/oauth-authorize-errors.test.ts` (add invalid-resource cases)

**Interfaces:**
- Consumes: `loadOAuth0xFixture`, `OAUTH_0X_GRANTS` (Task 2), the helpers (Task 1), `normalizeAuthorizeResource` and `normalizeTokenResource` (Task 3).
- Produces `getOAuthProvider(origin: string): OAuthProvider` in `src/index-oauth.ts`. It's memoized in a module-level `Map`, and every instance shares the same `apiHandler`, `defaultHandler` and options, with `resourceMetadata: { resource: origin }`.

- [ ] **Step 1: Write the survival test**

`beforeEach`: `loadOAuth0xFixture(env.OAUTH_KV)`. Then:
- `it.each` over the `none`, `origin` and `origin-slash` grants: `'should refresh a 0.10.3 grant bound to $label and call a tool'`. Refresh with the variant's `requestedResource` gives `200`, then `callMcp` with the new token gives `200`.
- `'should answer a refresh of a /mcp-bound 0.10.3 grant with invalid_grant so the client signs in again'`: `400`, body `error` is `invalid_grant`, and not `invalid_target`.

- [ ] **Step 2: Add the invalid-resource cases to `test/oauth-authorize-errors.test.ts`**

`GET /authorize` with `resource` set to `https://evil.example/mcp`, `https://lastfm-mcp.com/other` and `https://lastfm-mcp.com/mcp/x` → `400`, no `Location`.

- [ ] **Step 3: Run on 0.10.3 to see what fails**

Run: `npx vitest run test/oauth-upgrade-survival.test.ts test/oauth-authorize-errors.test.ts`
Expected: the `/mcp` `invalid_grant` case FAILS (0.10.3 refreshes it). Some invalid-resource cases may also fail on 0.10.3. Record which.

- [ ] **Step 4: Bump the dependency**

Set `"@cloudflare/workers-oauth-provider": "^<latest 1.x>"`, hand-edit the lockfile entry, then run `npm ci`.
Check: `git diff --stat package-lock.json` shows one small hunk.

- [ ] **Step 5: Apply the migration**

Work through `skills/migrate-to-1.x/SKILL.md` in the installed package. Specifically:
- Build `getOAuthProvider(origin)` with `resourceMetadata: { resource: origin }`. Call it in `fetch` with `url.origin`, after the Task 3 normalizers, as discogs-mcp does.
- Add `onError: ({ status, code, internal }) => console.warn('[OAUTH] error', { status, code, ...internal })`.
- Delete `handleProtectedResourceMetadata` and its `case`.
- Keep the `WWW-Authenticate` rewrite only if a test needs it. The existing round-trip assertion (`resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`) must still pass, and `test/oauth-discovery.test.ts` must still see `resource` equal to `BASE_URL` with no trailing slash.

- [ ] **Step 6: Run everything**

Run: `npx vitest run && npm run lint && npx tsc --noEmit && npm run build`
Expected: all green. This includes Task 1's matrix on both origins, the survival test, and the invalid-resource cases.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/index-oauth.ts src/auth/oauth-handler.ts test/oauth-upgrade-survival.test.ts test/oauth-authorize-errors.test.ts
git commit -m "feat(auth): upgrade workers-oauth-provider to 1.x with the origin as the canonical resource"
```

### Task 5: Ship PR 1 through staging to production

No code. Each bullet marked **(gate)** waits for Rian's go-ahead.

- [ ] **Step 1:** Draft the upstream issue on `cloudflare/workers-oauth-provider`, asking for path descendants of an origin resource to be mapped like query-carrying ones. Rian files it, or approves filing it. Put its link in the doc comments in `src/auth/resource-indicator.ts` and commit.
- [ ] **Step 2:** Push the branch and open PR 1 with `gh pr create`. List the safety evidence in the body: test names and fixture origin. **(gate)**
- [ ] **Step 3:** Before deploying, Rian signs in to the staging Worker with Claude Code (a `/mcp` sender) and with one origin sender (Claude or MCP Inspector), then confirms a tool call works in each.
- [ ] **Step 4:** `npm run deploy` (staging). **(gate)** Then confirm: both existing sessions still call tools, and a fresh sign-in from each client works.
- [ ] **Step 5:** Rollback rehearsal. Run `npx wrangler rollback` on staging to the pre-upgrade version **(gate)**, confirm both sessions still work, then run `npm run deploy` again. If sessions break after rollback, record that production rollback isn't a safe escape hatch, and tell Rian before Step 6.
- [ ] **Step 6:** Merge, then `npm run deploy:prod`. **(gate)**
- [ ] **Step 7:** After a few hours and again the next day, query Workers Observability for `[OAUTH] error` and count by `reason`. Expect at most 7 `grant_audience_unbound` and no `invalid_target` at `/authorize` or `/oauth/token` for `/mcp` requests. Report the counts to Rian.

---

## PR 2: Consent page

### Task 6: Consent page renderer

**Files:**
- Create: `src/auth/consent-page.ts`
- Test: `test/auth/consent-page.test.ts`

**Interfaces:**
- Consumes: `ConsentDescription` (library type), `sanitizeText` from `src/utils/security.ts`.
- Produces:
  - `interface ConsentBranding { productName: string; accessSentence: string; privacyUrl: string }`
  - `const LASTFM_CONSENT_BRANDING: ConsentBranding` contains the exact copy from Global Constraints.
  - `renderConsentPage(details: ConsentDescription, handle: string, branding: ConsentBranding): string`
  - `renderConsentErrorPage(message: string, branding: ConsentBranding): string`, with a "start again" sentence telling the user to return to their app and connect again.
- No `env`, KV or `Request` access in this file.

- [ ] **Step 1: Write the failing tests**

Using a base `ConsentDescription` fixture:
- `'should show the verified domain for a CIMD client'`: contains `Published by claude.ai (verified)` and doesn't contain `hasn't been checked`.
- `'should quote the name and flag it as unchecked for a registered client'`: contains `“Music Helper”` (curly quotes) and `The app chose this name itself. It hasn&#039;t been checked.` (or the unescaped apostrophe, if the copy is written as a literal rather than passed through `sanitizeText`)
- `'should show the redirect hostname'`: contains `musichelper.example`.
- `'should warn and omit the 30-day line for a loopback redirect'`: contains the loopback warning and not `30 days`.
- `'should show the 30-day line and no warning otherwise'`.
- `'should escape client-supplied strings'`: `clientName` `<script>alert(1)</script>"` and `redirectHost` `a"><img>` produce no `<script>` and no `<img>`.
- `'should post the handle back to /authorize'`: contains `method="post"`, `action="/authorize"` and `name="handle" value="<escaped handle>"`, plus both buttons with the exact `name`/`value` pairs.
- `'should not name the app in the headline'`: the `<h1>` text equals the exact headline.
- `'should load nothing from other origins'`: no `<link`, `<script` or `src=`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run test/auth/consent-page.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the renderer**

Use layout A from the spec, and the tokens and copy from Global Constraints. Inline `<style>`, a `<meta name="viewport">`, and readable layout at 375px width. Layout reference: `.superpowers/brainstorm/62724-1792940238/content/consent-layout-v2.html`, layout A (local only).

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/auth/consent-page.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/consent-page.ts test/auth/consent-page.test.ts
git commit -m "feat(auth): add the consent page renderer"
```

### Task 7: Consent flow on /authorize and /lastfm-callback

**Files:**
- Modify: `src/auth/oauth-handler.ts` (`/authorize` GET and POST, `/lastfm-callback`, remove `oauth-pending:` KV use)
- Modify: `src/types/env.ts` (`CONSENT_SECRET: string`), `wrangler.toml` secrets comment, `vitest.config.mts` (test binding with a 32+ char value)
- Modify: `test/helpers/oauth-flow.ts` (`signIn` posts `decision=approve` with the handle and cookies)
- Modify: `test/oauth-roundtrip.test.ts`, `test/oauth-cimd.test.ts`, `test/oauth-authorize-errors.test.ts` (expect the consent page where they expected a 302 to Last.fm)
- Create: `test/oauth-consent.test.ts`

**Interfaces:**
- Consumes: `renderConsentPage`, `renderConsentErrorPage` and `LASTFM_CONSENT_BRANDING` (Task 6), plus the helpers (Task 1).
- Produces, in `test/helpers/oauth-flow.ts`: `openConsent(worker, env, authorizeUrl: URL, cookies?: string): Promise<{ response: Response; handle: string; cookies: string }>` and `submitConsent(worker, env, origin, handle, decision: 'approve' | 'deny', cookies: string): Promise<Response>`. `signIn` uses both.

Flow and error handling follow the spec's Part 2 and the table in `docs/consent-page.md`. `beginUpstream` state goes into the `cb` URL as `/lastfm-callback?state=…`.

- [ ] **Step 1: Write `test/oauth-consent.test.ts`**

- `'should show the consent page instead of redirecting to Last.fm'`: `GET /authorize` → `200`, `text/html`, body contains the headline, response has `X-Frame-Options: DENY`, no `Location`, and no CSP with `form-action`.
- `'should redirect to Last.fm with state only after approval'`: approve → `302` to `www.last.fm` whose `cb` has `state`. Then the full `signIn` → `exchangeCode` → `callMcp` → `200`.
- `'should send access_denied with the original state when the user declines'`: deny → `302` to the client `redirect_uri` with `error=access_denied` and the original `state`.
- `'should refuse a replayed handle without redirecting'`: approve twice with the same handle and cookies. The second gets `400`, `text/html`, no `Location`.
- `'should refuse an approval without the binding cookie without redirecting'`: `400`, no `Location`.
- `'should refuse an expired consent without redirecting'`: advance time 11 minutes, or delete the consent KV record, at the implementer's choice. Expect `400` and no `Location`.
- `'should skip the page for a remembered client and redirect URI'`: approve with a non-loopback `https://client.example.com/oauth/callback`, then a second `GET /authorize` with the approvals cookie → `302` to Last.fm.
- `'should ask again for a different redirect URI'`: same client, second registered URI → `200` page.
- `'should ask again for a loopback client on a new port'`: approve `http://localhost:51000/callback`, then request `http://localhost:51001/callback` → `200` page.
- `'should show a CIMD client its verified domain'`: reuse the metadata fetch mock from `test/oauth-cimd.test.ts`. The page contains `Published by client.example.com (verified)`.
- `'should send access_denied when Last.fm returns without a token'`: `GET /lastfm-callback?state=<valid>` with no `token` → `302` to the client with `error=access_denied`.
- `'should refuse a callback whose state was never approved'`: `GET /lastfm-callback?state=made-up&token=t` → `400`, no `Location`.

- [ ] **Step 2: Run to confirm failures**

Run: `npx vitest run test/oauth-consent.test.ts`
Expected: FAIL (`/authorize` still returns `302`).

- [ ] **Step 3: Implement the flow, the secret binding and the helper changes**

Then update the three existing OAuth test files to go through consent where they expected the immediate Last.fm redirect.

- [ ] **Step 4: Run everything**

Run: `npx vitest run && npm run lint && npx tsc --noEmit && npm run build`
Expected: all green, including Task 1's matrix and the survival test, now through consent.

- [ ] **Step 5: Commit**

```bash
git add src/auth/oauth-handler.ts src/types/env.ts wrangler.toml vitest.config.mts test/
git commit -m "feat(auth): ask for consent before redirecting to Last.fm (#40)"
```

### Task 8: Ship PR 2 and close #40

- [ ] **Step 1:** Open PR 2. **(gate)**
- [ ] **Step 2:** `wrangler secret put CONSENT_SECRET` for staging, then `--env production`, each with a fresh 48-character random value. Rian runs these, or approves running them. **(gate)**
- [ ] **Step 3:** `npm run deploy` (staging). **(gate)** In Chrome, check Approve end to end, Deny back to the client, a second connect that skips the page (fixed-callback client), the localhost warning (Claude Code), and the page at phone width.
- [ ] **Step 4:** Last.fm repeat-authorization check: open `/authorize` for a client already approved on Last.fm and note whether Last.fm prompts again.
- [ ] **Step 5:** Merge, then `npm run deploy:prod`. **(gate)** Repeat one approve run on production.
- [ ] **Step 6:** Comment on #40 with the Last.fm finding and the PR links, and close it.
