# Landing Page Redesign and llms.txt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sterile landing page at `/` with the warm "your history is the wave" design, add a `/llms.txt` that lets an agent set the server up, and make the page share and rank well (share card, FAQ, structured data).

**Architecture:** The page and the agent instructions become real files (`src/pages/landing.html`, `src/pages/llms.md`) imported as strings through a wrangler `Text` module rule. Small builder functions fill `{{ORIGIN}}` (and `{{TOOLS}}` for llms.txt) per request, and `src/index-oauth.ts` routes `GET /` and `GET /llms.txt` to them. A `Data` rule imports the share-card PNGs. FAQ items live once as data and render both the visible FAQ and its JSON-LD. `src/marketing-page.ts` is deleted.

**Tech Stack:** Cloudflare Workers (workerd), TypeScript strict, wrangler module rules, vitest 4 with `@cloudflare/vitest-pool-workers` 0.22, Node 22, plain HTML/CSS/canvas JS, Bricolage Grotesque from Google Fonts.

**Spec:** `docs/superpowers/specs/2026-11-12-landing-page-redesign-design.md` (read it in full; copy, colours and section order come from there). Approved mockups: `.superpowers/brainstorm/87951-1794523815/content/hero-c-v3.html` and `page-layout.html` (gitignored, reference only).

## Global Constraints

- Work only in `/Users/rian/git/lastfm-mcp`, on branch `feat/landing-page-redesign`. Do not switch branches, pull, or touch other repos, except Task 6's elezea.com step.
- A merge to `main` deploys production. Never merge; never run `npm run deploy:prod`. Staging (`npm run deploy`) only in Task 7.
- Every `.ts` file starts with exactly two `// ABOUTME:` lines. `landing.html` gets the two lines as one HTML comment after `<!DOCTYPE html>`. `llms.md` gets none (its first lines are served to agents).
- Prettier: tabs, no semicolons, single quotes, 140 columns. `npm run lint` and `npm run format:check` must pass at every commit.
- Palette (exact): background `#ece6dc`, raised `#f7f3ec`, border `#d9d0c3`, heading `#22201d`, body `#504a43`/`#5a534b`, muted `#6d665e`, accent `#b8432f`, code bg `#22201d` with text `#efe7da`. Wave layers `#b8432f`, `#d39b3f`, `#8a9a72`, `#6f8aa3`, `#8c6278` at ~0.85 opacity.
- Only third-party request on the page: Google Fonts (Bricolage Grotesque 400 and 700, opsz 12..96). No unpkg, no icon CDN.
- Canonical, OG/Twitter URLs, `og:image`, JSON-LD and FAQ answers stay hardcoded to `https://lastfm-mcp.com`. Everything the visitor copies uses `{{ORIGIN}}`.
- `<title>` is exactly "Last.fm MCP: Connect your Last.fm history to Claude, ChatGPT, and other AI assistants" (subject to Task 2's ChatGPT ruling in the spec). No `keywords` meta. No `Crawl-delay` or per-bot groups in `robots.txt`.
- Never claim access can be revoked on Last.fm. Never claim any tool works without sign-in.
- Layout works at 375px with a 16px gutter and no horizontal scroll. Don't put `overflow-x: hidden` on `body` (it breaks vertical scrolling); use `overflow-x: clip` on `html` if needed.
- Any element hidden with the `hidden` attribute whose class sets `display` needs a `[hidden] { display: none }` rule, or it stays visible.
- Copy follows the spec verbatim except where Task 2's verification changes it; record every change in Task 2's notes file.

## Review Focus

1. **Requests from staging, workers.dev or localhost:** every copyable URL, the agent prompt and `/llms.txt` show that origin, and no `{{ORIGIN}}` or `{{TOOLS}}` text is ever left in a response. Tests in Tasks 1, 3 and 4.
2. **Visitor without JavaScript:** all three setup panels are readable, stacked. The served HTML must not carry `hidden` on any panel; the script adds it. Test in Task 4.
3. **Tab panels hidden by script but still showing** because `.panel { display: block }` beats the `hidden` attribute. CSS rule required; check in Task 7's browser pass.
4. **Reduced motion / background tab:** with `prefers-reduced-motion: reduce` the wave draws one static frame and labels don't cycle; the loop stops when the tab is hidden or the hero is off screen. Manual check in Task 7, code in Task 5.
5. **Visible FAQ and FAQ JSON-LD disagreeing** after someone edits one: both must come from the same data. Test in Task 6.
6. **Clipboard unavailable or denied** (Safari permission, insecure context): the copy button must not fail silently. It shows "Press ⌘C / Ctrl+C" and selects the text. Code in Task 4, manual check in Task 7.

---

### Task 1: Text-module plumbing and the origin filler

Proves the spec's chosen approach. **If the import can't be made to work in vitest-pool-workers without hacks, stop and report back**: the fallback (TypeScript string modules, same file names with `.ts`) changes Tasks 3 and 4.

**Files:**
- Modify: `wrangler.toml` (top level, before `[observability]`)
- Create: `src/types/text-modules.d.ts`
- Create: `src/pages/template.ts`
- Create: `test/fixtures/text-module.html` (one line: `<p>{{ORIGIN}}/mcp</p>`)
- Test: `test/pages/template.test.ts`, `test/wrangler-config.test.ts` (add a case)

**Interfaces:**
- Produces: `fillPlaceholders(template: string, values: Record<string, string>): string` in `src/pages/template.ts`. Replaces every `{{KEY}}` for each key in `values`; throws `Error('Unfilled placeholder: {{NAME}}')` if any `{{UPPER_SNAKE}}` token remains afterwards.
- Produces: `import x from '<path>.html'` / `'<path>.md'` yields a `string`, and `'<path>.png'` yields an `ArrayBuffer`, in `src/` and `test/`.

- [ ] **Step 1: Write failing tests** in `test/pages/template.test.ts`:
  - `it('imports an .html file as a string')`: `import fixture from '../fixtures/text-module.html'`; `expect(typeof fixture).toBe('string')`; `expect(fixture).toContain('{{ORIGIN}}/mcp')`.
  - `it('fills every occurrence of a placeholder')`: `fillPlaceholders('{{ORIGIN}}/mcp and {{ORIGIN}}/llms.txt', { ORIGIN: 'https://x.dev' })` → `'https://x.dev/mcp and https://x.dev/llms.txt'`.
  - `it('throws when a placeholder is left unfilled')`: `fillPlaceholders('{{ORIGIN}} {{TOOLS}}', { ORIGIN: 'a' })` throws `/Unfilled placeholder: {{TOOLS}}/`.
  - In `test/wrangler-config.test.ts`, add a case asserting both staging and production config (read the same way the file reads the other bindings, via `unstable_readConfig` in `vitest.config.mts` if needed) include a rule with `type: 'Text'` and globs `['**/*.html', '**/*.md']`, and a rule with `type: 'Data'` and globs `['**/*.png']`. If `rules` isn't inherited by `[env.production]`, declare it there too.
- [ ] **Step 2: Run** `npx vitest run test/pages/template.test.ts test/wrangler-config.test.ts`. Expected: FAIL (module not found / no rule).
- [ ] **Step 3: Implement.** In `wrangler.toml`:
  ```toml
  # Landing page and llms.txt sources are imported as strings (src/pages/).
  [[rules]]
  type = "Text"
  globs = ["**/*.html", "**/*.md"]
  fallthrough = true

  # Share-card images (src/pages/share/) are imported as ArrayBuffers.
  [[rules]]
  type = "Data"
  globs = ["**/*.png"]
  fallthrough = true
  ```
  `src/types/text-modules.d.ts` declares `'*.html'` and `'*.md'` modules with a `string` default export and `'*.png'` with an `ArrayBuffer` default export. Make sure `test/` sees the declaration (tests are excluded from `tsconfig.json`; check how vitest resolves types and add a reference only if type errors appear). Implement `fillPlaceholders`.
- [ ] **Step 4: Run** the same tests, then `npm run build` and `npx wrangler deploy --dry-run --env production`. Expected: tests PASS; both dry runs finish without a module-type error.
- [ ] **Step 5: Run** `npx vitest run`, `npm run lint`, `npm run format:check`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(pages): import .html, .md and .png files as modules and add the placeholder filler`.

### Task 2: Verify the copy before it's written into files

No code. The deliverable is `docs/superpowers/plans/2026-11-12-landing-page-verified-copy.md`, which Tasks 3 and 4 copy from.

**Files:**
- Create: `docs/superpowers/plans/2026-11-12-landing-page-verified-copy.md`

**Interfaces:**
- Produces: a notes file with three sections: **Example questions** (final list, each with the tools that answer it and the result of trying it), **Setup steps** (final wording per client with a source link), **FAQ** (final answers for the six questions in the spec's "Sharing and search" section, each fact with its source), **Changes from the spec** (every deviation and why).

- [ ] **Step 1: Example questions.** For each of the seven questions in the spec, name the tools that answer it (read `src/mcp/tools/*.ts`), then ask it through the local `lastfm` MCP connection against Rian's account. Mark each PASS (good answer), WEAK (answers but poorly), or FAIL. Reword WEAK ones once and retry; drop FAILs. Keep at least five questions.
- [ ] **Step 2: Setup steps.** Check current official docs for each client and record exact UI labels or config syntax with a link: Claude app custom connectors (labels "Settings → Connectors", "Add custom connector", "Add", "Connect"); Claude Code (`claude mcp add --transport http …` and signing in through `/mcp`); ChatGPT custom MCP connectors (plan requirements, where the setting lives, whether OAuth servers work); Codex (`~/.codex/config.toml` syntax for a remote HTTP server and how sign-in starts); Cursor, Windsurf and OpenCode (compare against the existing snippets in `src/marketing-page.ts`); `mcp-remote`. Anything you can't confirm from an official or primary source is marked CUT.
- [ ] **Step 3: FAQ facts.** Confirm each FAQ answer against the code or a primary source: no API key needed (OAuth flow in `src/auth/`), MIT licence (`LICENSE`), read-only (every tool in `src/mcp/tools/` is a read), the MCP definition (modelcontextprotocol.io), and the ChatGPT answer from Step 2. Apply the spec's ChatGPT rule: conditions go in the answer; ChatGPT leaves the title, subline and card only if it can't connect at all.
- [ ] **Step 4: Write the notes file** with the four sections above. Expected: every question and client has a status and, for setup, a link.
- [ ] **Step 5: Commit** `docs: verified copy for the landing page and llms.txt`.

### Task 3: `/llms.txt`

**Files:**
- Create: `src/pages/llms.md`
- Create: `src/pages/llms-txt.ts`
- Modify: `src/index-oauth.ts` (new route next to `/robots.txt`)
- Test: `test/pages/llms-txt.test.ts`, `test/index-oauth.test.ts` (`static endpoints` block)

**Interfaces:**
- Consumes: `fillPlaceholders` (Task 1); `PUBLIC_TOOL_CATALOG`, `AUTHENTICATED_TOOL_CATALOG`, `ToolListEntry` from `src/mcp/tools/catalog.ts`; Task 2's notes.
- Produces: `renderLlmsToolSection(): string` and `buildLlmsTxt(origin: string): string` in `src/pages/llms-txt.ts`.

- [ ] **Step 1: Write failing tests** in `test/pages/llms-txt.test.ts`:
  - `it('lists every catalog tool exactly once')`: for each name in both catalogs, the section contains `` `name` `` exactly once.
  - `it('says once that all tools need sign-in')`: contains `All tools need you to sign in to Last.fm first.`; does not match `/no auth|without (signing in|auth)|public/i`.
  - `it('groups tools')`: `get_artist_info` appears under `Music lookups` with the AUTHENTICATED summary (`Get detailed artist information`); `get_recent_tracks` under `Your listening history`; `ping`, `server_info`, `lastfm_auth_status` under `Diagnostics`, which comes last.
  - `it('fills the origin and leaves no placeholders')`: `buildLlmsTxt('https://staging.example')` contains `https://staging.example/mcp`, contains no `{{`, and starts with `# Last.fm MCP`.
  - In `test/index-oauth.test.ts`: `GET https://example.com/llms.txt` → 200, `content-type` `text/plain; charset=utf-8`, `cache-control` `public, max-age=86400`, body contains `https://example.com/mcp`.
- [ ] **Step 2: Run** `npx vitest run test/pages/llms-txt.test.ts test/index-oauth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write `src/pages/llms.md`** in the spec's order (title and blockquote; For agents setting this up; Setup by client; What you can ask; `{{TOOLS}}`; Links), using `{{ORIGIN}}` for every server URL and Task 2's verified wording. The "For agents" section must end with: the agent can't complete the Last.fm sign-in, so its last step is telling the human exactly how to sign in for their client (for Claude Code: run `/mcp`, pick `lastfm`).
- [ ] **Step 4: Implement** `renderLlmsToolSection` (groups and dedupe rule from the spec's `/llms.txt` section) and `buildLlmsTxt(origin)` (`fillPlaceholders(llms, { ORIGIN: origin, TOOLS: renderLlmsToolSection() })`). Add the route: `GET /llms.txt` returns `buildLlmsTxt(url.origin)` with the headers above.
- [ ] **Step 5: Run** `npx vitest run`, `npm run lint`, `npm run format:check`. Expected: all pass.
- [ ] **Step 6: Commit** `feat: serve /llms.txt with setup steps for agents and a generated tool list`.

### Task 4: The landing page (markup, styles, setup tabs)

The wave canvas is a placeholder `<canvas>` here; Task 5 animates it.

**Files:**
- Create: `src/pages/landing.html`
- Create: `src/pages/landing.ts`
- Modify: `src/index-oauth.ts` (`GET /` serves `buildLandingPage(url.origin)`; drop the `MARKETING_PAGE_HTML` import)
- Delete: `src/marketing-page.ts`
- Test: `test/pages/landing.test.ts`, `test/index-oauth.test.ts` (update `should return marketing page for GET /`)

**Interfaces:**
- Consumes: `fillPlaceholders` (Task 1); Task 2's notes.
- Produces: `buildLandingPage(origin: string): string` in `src/pages/landing.ts`. In the HTML: `<canvas id="wave" aria-hidden="true">` inside `<section class="hero">`, and two label elements `.wave-label` with `aria-hidden="true"` for Task 5.

- [ ] **Step 1: Write failing tests** in `test/pages/landing.test.ts` against `buildLandingPage('https://staging.example')`:
  - contains `Ask your AI about everything you've ever listened to.`
  - contains `https://staging.example/mcp` and `https://staging.example/llms.txt`; contains no `{{`
  - canonical is still `<link rel="canonical" href="https://lastfm-mcp.com">`
  - contains `fonts.googleapis.com` and does not contain `unpkg.com`
  - does not contain `revoke` (case-insensitive)
  - every element with `role="tabpanel"` lacks a `hidden` attribute in the served HTML (Review Focus 2)
  - has ids `ask` and `setup`, and `<link rel="alternate" type="text/plain" href="/llms.txt"`
  - Update the `GET /` test in `test/index-oauth.test.ts`: `content-type` `text/html; charset=utf-8`, `cache-control` `public, max-age=3600`, body contains the headline and `https://example.com/mcp`.
- [ ] **Step 2: Run** `npx vitest run test/pages/landing.test.ts test/index-oauth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write `src/pages/landing.html`** to the spec's "Page structure and copy" section and the `page-layout.html` mockup: head (title and description per Global Constraints, `theme-color`, SVG favicon, fonts, llms.txt alternate link; share tags and JSON-LD come in Task 6), nav, hero, Things you can ask (Task 2's final questions), a `<!-- FAQ -->` marker comment between Set it up and What you're agreeing to (Task 6 replaces it), Set it up (three tabs: ARIA tab pattern with arrow-key support; the script adds `hidden` to inactive panels on load; Other apps as `<details>` per app with verified snippets), What you're agreeing to (spec copy verbatim), footer (spec copy, plus "Built on the Last.fm API"). Copy buttons: clipboard write, and on rejection or a missing `navigator.clipboard` select the code text and show "Press ⌘C / Ctrl+C" (Review Focus 5). Inline SVG only, no icon CDN.
- [ ] **Step 4: Implement** `buildLandingPage(origin)` and the route; delete `src/marketing-page.ts`.
- [ ] **Step 5: Run** `npx vitest run`, `npm run lint`, `npm run format:check`, `npm run build`. Expected: all pass.
- [ ] **Step 6: Look at it.** `npm run dev`, then take headless Chrome screenshots of `http://localhost:8787/` at 1300px and with CDP mobile emulation at 375px (headless `--window-size` clamps below 500px). Compare with the mockup; fix layout drift.
- [ ] **Step 7: Commit** `feat: redesign the landing page around plain-language setup`.

### Task 5: The wave

**Files:**
- Modify: `src/pages/landing.html` (inline script and label CSS)
- Test: `test/pages/landing.test.ts` (add cases)

**Interfaces:**
- Consumes: `#wave` canvas and `.wave-label` elements from Task 4.

- [ ] **Step 1: Write failing tests**: the page contains all six labels from the spec verbatim (`2009 · post-rock phase` … `2026 · everything at once`), contains `prefers-reduced-motion`, and contains `visibilitychange`.
- [ ] **Step 2: Run** `npx vitest run test/pages/landing.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the streamgraph from `hero-c-v3.html` (five stacked layers from layered sines, flowing right to left, DPR-aware resize), the two cross-fading labels cycling through the six lines, and motion rules: reduced motion draws one static frame and never starts the label timer, and reacts to the media query changing; the animation loop and label timer stop when `document.hidden` or when an `IntersectionObserver` reports the hero off screen, and resume when back.
- [ ] **Step 4: Run** `npx vitest run`, `npm run lint`, `npm run format:check`. Expected: all pass.
- [ ] **Step 5: Look at it** in `npm run dev` (a short screen recording or two screenshots a few seconds apart showing the stream moved and a label changed).
- [ ] **Step 6: Commit** `feat: animate the listening-history wave on the landing page`.

### Task 6: Share card, FAQ and search metadata

**Files:**
- Create: `src/pages/share/og-card.html` (1200×630 card, option A from the spec), `src/pages/share/icon.html` (180×180)
- Create: `scripts/render-share-images.mjs` (headless Chrome renders both HTML files to PNG)
- Create (generated, committed): `src/pages/share/og.png`, `src/pages/share/apple-touch-icon.png`
- Create: `src/pages/faq.ts`
- Modify: `src/pages/landing.html`, `src/pages/landing.ts`, `src/index-oauth.ts` (routes `/og.png`, `/apple-touch-icon.png`; robots; sitemap)
- Test: `test/pages/faq.test.ts`, `test/pages/landing.test.ts`, `test/index-oauth.test.ts`

**Interfaces:**
- Consumes: `buildLandingPage`, `fillPlaceholders`, the `<!-- FAQ -->` marker (Task 4); the `Data` rule (Task 1); Task 2's FAQ answers.
- Produces: in `src/pages/faq.ts`: `interface FaqItem { question: string; answer: string }` (answer is plain text; links, if any, are rendered by `renderFaqHtml`), `FAQ_ITEMS: FaqItem[]`, `renderFaqHtml(items: FaqItem[]): string`, `faqJsonLd(items: FaqItem[]): object`. In `src/pages/landing.ts`: `LANDING_PAGE_UPDATED: string` (ISO date, `'2026-11-12'` until the deploy date is known; set it to the merge date in Task 8).

- [ ] **Step 1: Write failing tests.**
  - `test/pages/faq.test.ts`: `FAQ_ITEMS` has the spec's six questions in order; `renderFaqHtml` emits one `<h3>` per question and wraps the section in `id="faq"`; `faqJsonLd` returns `@type: 'FAQPage'` with one `Question` per item whose `acceptedAnswer.text` equals `answer`.
  - `test/pages/landing.test.ts`: the `<title>` from Global Constraints; meta description from the spec; no `name="keywords"`; `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url` `https://lastfm-mcp.com/`, `og:image` `https://lastfm-mcp.com/og.png`, `og:image:width` `1200`, `og:image:height` `630`, `og:image:alt`, `twitter:card` `summary_large_image`, `twitter:image`, `twitter:image:alt`; `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`; the JSON-LD block `JSON.parse`s and its `@graph` has `WebSite`, `SoftwareApplication` (with `author.name` `Rian van der Merwe`, `applicationCategory` `MultimediaApplication`, no `softwareVersion`) and `FAQPage`; every `FAQ_ITEMS` question appears in the visible HTML and in the JSON-LD (Review Focus 5); no `<!-- FAQ -->` marker remains.
  - `test/index-oauth.test.ts`: `GET /og.png` → 200, `image/png`, `public, max-age=86400`, first 8 bytes are the PNG signature, IHDR width 1200 and height 630 (bytes 16–23, big-endian); `GET /apple-touch-icon.png` → 200 `image/png`, 180×180; `GET /robots.txt` contains `Allow: /llms.txt` and `Allow: /og.png` and not `Crawl-delay`; `GET /sitemap.xml` twice → identical bodies, `<lastmod>` equals `LANDING_PAGE_UPDATED`, no `changefreq` or `priority`.
- [ ] **Step 2: Run** `npx vitest run test/pages test/index-oauth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Build the card and icon.** `og-card.html` follows the spec's share-card description and the `og-card.html` mockup (static wave frame, fonts loaded before capture). `scripts/render-share-images.mjs` (with `// ABOUTME:` header) runs Chrome headless with `--screenshot`, `--window-size` set exactly to each image's size and `--virtual-time-budget` long enough for fonts, writing into `src/pages/share/`. Note: `--window-size` below 500 is clamped, so render the 180×180 icon from a 500×500 window with the icon scaled to fill it and downscale with `sips -z 180 180`, or use CDP device metrics. Run it; look at both PNGs.
- [ ] **Step 4: Implement** `faq.ts`; in `landing.ts` replace the marker with `renderFaqHtml(FAQ_ITEMS)` and add the share tags and the `@graph` JSON-LD (spec "Structured data"); routes for both PNGs; robots and sitemap changes per the spec.
- [ ] **Step 5: Run** `npx vitest run`, `npm run lint`, `npm run format:check`, `npm run build`. Expected: all pass.
- [ ] **Step 6: Commit** `feat: share card, FAQ and structured data for search and AI answer engines`.

### Task 7: Docs and the privacy page

**Files:**
- Modify: `AGENTS.md` (architecture block: replace `marketing-page.ts` with `pages/` and describe `landing.html`, `llms.md`, `template.ts`; File Headers section: note the `.html`/`.md` exception from Global Constraints; mention the `Text` rule)
- Modify: `README.md` (point readers to `/llms.txt` for agent setup if the README has a setup section; keep its tool list)
- Elsewhere: `/Users/rian/git/elezea.com/src/content/pages/privacy.md`

- [ ] **Step 1: Update** `AGENTS.md` and `README.md`. Run `npm run format:check`. Expected: pass.
- [ ] **Step 2: Commit** `docs: describe src/pages and the llms.txt route`.
- [ ] **Step 3: Privacy page.** In elezea.com, read its `AGENTS.md`/`CLAUDE.md`, check status and branch, then on a new branch change the sentence "The lastfm-mcp.com home page also loads an icon stylesheet from unpkg.com." to say it loads fonts from Google Fonts (and nothing from unpkg). Commit; do not push or open a PR. Report the branch name and diff for Rian.

### Task 8: Staging check and copy review

**Files:** none unless fixes are needed.

- [ ] **Step 1: Deploy staging:** `npm run deploy`. Note the staging URL.
- [ ] **Step 2: Agent prompt check.** In a fresh Claude Code session in an empty scratch directory, paste the page's agent prompt with the staging `llms.txt` URL. Expected: it runs `claude mcp add` with the staging `/mcp` URL and tells the human to run `/mcp` to sign in. Remove the test server afterwards (`claude mcp remove lastfm`).
- [ ] **Step 3: Browser pass** on staging, Chrome and Safari, desktop and 375px: no horizontal scroll; tabs switch with mouse and arrow keys and inactive panels are actually hidden (Review Focus 3); with JavaScript off all panels show; copy buttons work, and in a context where clipboard is denied they show the fallback (Review Focus 5); reduced motion gives a still wave and still labels (Review Focus 4); switching tabs away and back resumes the animation.
- [ ] **Step 4: Search and sharing.** On staging: paste the page into validator.schema.org (no errors); check every share tag is in the served HTML; open staging's `/og.png` and `/apple-touch-icon.png`. Read-only zone check with the `cf` CLI (read product-ai's `01-context/corrections/workers-platform.md` cf section first): the lastfm-mcp.com zone isn't blocking AI search crawlers via AI bot or crawler controls and isn't prepending a managed `robots.txt`. Report anything blocked; change nothing. Set `LANDING_PAGE_UPDATED` to the intended merge date and commit.
- [ ] **Step 5: Copy review.** Send the visible page text and `llms.txt` to a Codex reviewer (`xhigh`) per product-ai's Herdr reviewer hand-off; apply agreed fixes; commit.
- [ ] **Step 6: Hand to Rian:** staging URL, screenshots (page and share card), the Task 2 notes, the review changes, the zone-check result, and the elezea.com privacy branch. Rian decides on push, PR and merge. After the production deploy: paste the URL into Slack or iMessage and an Open Graph preview tool once to confirm the unfurl.
