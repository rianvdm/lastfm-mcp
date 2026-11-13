# Landing Page Redesign and llms.txt: Design Spec

**Date:** 2026-11-12
**Status:** Draft
**Branch:** `feat/landing-page-redesign`

---

## Why

The page at [lastfm-mcp.com](https://lastfm-mcp.com) looks like a generic developer tool: near-black background, glowing red buttons, glass cards, and a wall of tool names like `get_weekly_artist_chart`. The first sentence explains what an "MCP server" is before it says what the visitor gets. Rian finds it sterile, and thinks a typical visitor would struggle to follow it.

The typical visitor is reasonably technical but not a developer. They use Claude Desktop, or a bit of terminal (Claude Code). They know Last.fm and want to talk to their AI about their listening. Most don't know what MCP is and don't need to.

Rian also wants the "just tell your agent to set this up" path that other projects offer: one prompt the visitor copies into their agent, which then reads setup instructions from the site and does the work.

## Goals

- A visitor understands what this does and why they'd want it from the headline and subline, without knowing what MCP is.
- A Claude app user can get from the page to a working connector by following four plain steps.
- A Claude Code (or other agent) user can paste one prompt and have their agent set it up, then sign in themselves.
- The page feels warm and a little playful, with a sound wave animation that says something about the product.
- `/llms.txt` gives an agent everything it needs: setup per client, the tool list, and what the human still has to do.
- A link to the site unfurls as a clear, on-brand card in Slack, iMessage, Bluesky and LinkedIn.
- Search engines and AI answer engines (Google, ChatGPT search, Perplexity, Claude) can find the page and quote it when someone asks how to connect Last.fm to their AI. (Added 2026-11-12 after the first approval.)

## Non-goals

- Any change to `/mcp`, OAuth, the consent page, the tools, or the server card at `/.well-known/mcp.json`.
- A live demo that draws a visitor's own Last.fm history. That needs a public endpoint using the shared API key, with its own rate limiting. It's a separate feature if it ever happens.
- A dark mode. The sand palette is the page's identity. This is Claude's call, not Rian's; flag it in review if it bothers you.
- Changing the deploy model (Workers Static Assets). See Approaches.

## Anti-goals

- **Cartoony or bright.** Muted earth colours, no mascots, no emoji decoration.
- **Tech-bro gloss.** No glow, no glassmorphism, no near-black-and-neon.
- **Claims that aren't true.** Every example question must be answerable by the current tools, every setup step must match the client's current UI or docs, and the trust section must match the code and the [privacy page](https://elezea.com/privacy/#lastfm-mcp-server). A friendly page that lies about revocation is worse than the sterile one.
- **An agent prompt that implies the agent can finish alone.** The Last.fm sign-in always needs the human.

## Approaches

Today the page is one 934-line HTML string in `src/marketing-page.ts`, returned by `src/index-oauth.ts` for `GET /`.

1. **Real `.html` and `.md` files imported as text modules (chosen).** Wrangler `[[rules]]` with `type = "Text"` lets the Worker `import` a `.html` or `.md` file as a string. The Worker keeps owning every route; `/llms.txt` is one new branch. The page becomes a real HTML file that editors highlight and format, and a stray backtick or `${` can no longer break the build. The risk is that `@cloudflare/vitest-pool-workers` must honour the same rule, which is checked first (see Build).
2. **Keep the TypeScript string pattern.** Rewrite `marketing-page.ts` in place and add a string for `llms.txt`. Fewest moving parts, but you keep hand-editing a few hundred lines of HTML and CSS inside a template literal. This is the fallback if option 1's check fails.
3. **Workers Static Assets.** Serve the page, `llms.txt` and self-hosted fonts from `public/` with the Worker running first for dynamic routes. Cleanest for files and fonts, but it changes routing in both environments on a Worker that deploys to production on every merge, with OAuth in the path. Too much risk for a landing page.

Rian picked option 1.

## Design

### Visual direction

Picked from three live mockups ("Your history is the wave"). The approved mockups are in `.superpowers/brainstorm/87951-1794523815/content/` (`hero-c-v3.html` for the hero, `page-layout.html` for the full page). That folder is gitignored, so treat these as reference, not source.

- **Background:** sand `#ece6dc`; raised surfaces `#f7f3ec`; borders `#d9d0c3`.
- **Text:** `#22201d` for headings, `#504a43` / `#5a534b` for body, `#6d665e` for muted.
- **Accent:** terracotta `#b8432f` for the primary button and copy buttons.
- **Code blocks:** dark `#22201d` with `#efe7da` text, monospace.
- **Type:** Bricolage Grotesque (400 and 700, optical sizes 12..96) from Google Fonts for everything except code. Headline about 44px desktop, bold, slight negative tracking.
- **Icons:** none from a CDN. The Phosphor stylesheet from unpkg goes away; use inline SVG where an icon earns its place (the copy button, maybe the GitHub link).
- **Responsive:** works at 375px wide with a 16px side gutter and no horizontal scroll. Setup tabs wrap or stack on narrow screens.

### The wave

A streamgraph along the bottom of the hero: five stacked layers in terracotta `#b8432f`, ochre `#d39b3f`, sage `#8a9a72`, dusty blue `#6f8aa3` and plum `#8c6278`, about 0.85 opacity, flowing slowly right to left. It stands for a listening life moving between phases. Layer thicknesses come from layered sines (see `hero-c-v3.html`), not from real data.

Two small labels sit above the stream and cross-fade every few seconds through hand-written lines:

- 2009 · post-rock phase
- 2011 · that one Bon Iver winter
- 2016 · one album on repeat
- 2019 · back to the 90s
- 2024 · jazz, apparently
- 2026 · everything at once

Post-review change (2026-11-12): the 2016 line was "2016 · 400 plays of one album"; the copy review flagged the exact count as unmeasured on a synthetic graphic.

The labels are decorative and get `aria-hidden="true"`. With `prefers-reduced-motion: reduce`, draw one static frame and don't cycle the labels. Pause the animation when the tab is hidden or the hero is off screen, as the current page does with its `running` flag.

### Page structure and copy

Copy below is the approved draft. Final wording gets Rian's review before merge (see Review).

Post-review change (2026-11-12): the final copy review changed the subline, the button, the setup-panel instructions, the trust copy, the FAQ and `llms.txt` wording; the quotes below that it touched show the new text, and git history has the earlier wording.

**Head.** See "Sharing and search" below for the title, meta tags, share card and structured data. Add `<link rel="alternate" type="text/plain" href="/llms.txt" title="Setup instructions for AI agents">`. Keep the SVG favicon.

**Nav.** Wordmark "Last.fm MCP" on the left. Links: Set up (`#setup`), What you can ask (`#ask`), GitHub.

**Hero.**
- Headline: "Ask your AI about everything you've ever listened to."
- Subline: "Connect your Last.fm history to Claude, ChatGPT, or another supported app. Ask when you first played an album, what you had on repeat last summer, or what to play next."
- Primary button "Set it up" → `#setup`. Beside it, muted: "Free, open source, read-only".
- The wave across the bottom.

**Things you can ask (`#ask`).** Replaces both "How it works" and the numbered question grid.
- Lede: "Ask in your own words. It reads your scrobbles, charts, and loved tracks, and works out days like "yesterday" in your own timezone."
- Questions as speech bubbles (alternating corner radius and three soft fills, as in the mockup):
  - When did I start listening to Radiohead?
  - What was I obsessed with last summer?
  - How has my taste changed since 2015?
  - What did I listen to yesterday?
  - Find me artists like my top five, but ones I've never played
  - What's the essential album by Talk Talk?
  - Which albums did I play to death and then forget about?
- Each question must be verified against the tools before shipping (see Verification). Drop or reword any that the tools can't answer well.

**Set it up (`#setup`).** Lede: "Pick the app you use. Either way, you'll sign in to Last.fm once at the end." Three tabs, Claude app open by default. Tabs must work with the keyboard (ARIA tab pattern) and without JavaScript all three panels show stacked.

1. *Claude app:*
   1. Open Claude (desktop or claude.ai) and go to **Settings → Connectors**
   2. Click **Add custom connector** and paste this address: `https://lastfm-mcp.com/mcp` (copy button)
   3. Click **Add**, then **Connect**, and sign in to Last.fm
   4. Start a new chat and ask something
2. *Claude Code or another agent:*
   - "Paste this into your agent to set up the connection. It will tell you how to sign in." → `Set up the Last.fm MCP server for me. Instructions are at https://lastfm-mcp.com/llms.txt` (copy button)
   - "Or do it yourself", then "Using Claude Code? Run this in your terminal:" → `claude mcp add --scope user --transport http lastfm https://lastfm-mcp.com/mcp` (copy button), then "Start Claude Code, run `/mcp`, choose **lastfm**, then **Authenticate**, and sign in to Last.fm in your browser."
3. *Other apps:* "Choose your app below for setup and sign-in instructions." A grid of apps, each expanding (`<details>`) to its exact config: ChatGPT, Cursor (`~/.cursor/mcp.json`), Windsurf (`~/.codeium/windsurf/mcp_config.json`), OpenCode (`opencode.json`), Codex (`~/.codex/config.toml`), and "Other apps that run MCP tools on your computer" via `mcp-remote`. Carry the existing Cursor, Windsurf, OpenCode and `mcp-remote` snippets over from `marketing-page.ts`; ChatGPT and Codex are new.

**Questions (`#faq`).** A short FAQ between Set it up and What you're agreeing to. Each question is an `h3` with its answer in plain paragraphs, always visible (not collapsed), so crawlers and answer engines read the same text people do. See "Sharing and search" for the questions and the matching structured data.

**What you're agreeing to.** Three short columns:
- *It only reads:* "It can look at your listening history. It can't scrobble, love tracks, or change anything on your account."
- *You sign in on Last.fm:* "You sign in on Last.fm's own page, so this site never receives your password. You'll need to sign in again after 30 days."
- *Open source:* "Every line is on GitHub. The privacy page spells out exactly what's stored and for how long." (links to GitHub and the privacy page)

Do not say the user can revoke access on Last.fm. Reads use the API key plus the username, so revoking the app on Last.fm doesn't stop them ([#56](https://github.com/rianvdm/lastfm-mcp/issues/56)).

**Footer.** Left: "Made by Rian van der Merwe · Not affiliated with Last.fm" (link Rian's name to elezea.com). Right: GitHub · Release notes · Privacy · Report a bug · For agents: llms.txt. Keep the current footer's "Built on the Last.fm API" credit.

**Removed:** the "What's MCP?" pill, the "How it works" cards, the tool-name wall (moves to `llms.txt` and the README), and the always-expanded config blocks.

### `/llms.txt`

`GET /llms.txt` returns Markdown as `text/plain; charset=utf-8`, cached like `robots.txt` (`public, max-age=86400`). Add it to `robots.txt` as `Allow: /llms.txt`.

Source is `src/pages/llms.md`, with a placeholder the Worker replaces with the tool list rendered from `PUBLIC_TOOL_CATALOG` and `AUTHENTICATED_TOOL_CATALOG` in `src/mcp/tools/catalog.ts`, so the list can't drift from the code.

Every tool needs sign-in: each `/mcp` request needs an OAuth token, and the "public" catalog only means the tool doesn't use the user's Last.fm session. So the list must not suggest any tool works without signing in. *(Claude's call, from the builder check.)* Render it as one line, "All tools need you to sign in to Last.fm first.", followed by two groups:
- **Music lookups:** the tools in `PUBLIC_TOOL_CATALOG` except `ping`, `server_info` and `lastfm_auth_status`, which go in a short **Diagnostics** group at the end.
- **Your listening history:** the tools that appear only in `AUTHENTICATED_TOOL_CATALOG`.

The seven tools in both catalogs (`get_track_info`, `get_artist_info`, `get_album_info`, `get_artist_top_tracks`, `get_artist_top_albums`, `get_similar_artists`, `get_similar_tracks`) are listed once, under Music lookups, with the `AUTHENTICATED_TOOL_CATALOG` summary (the "detailed" wording).

Contents, in order:
1. `# Last.fm MCP` and a one-line blockquote summary (llms.txt convention).
2. **For agents setting this up:** the server URL; that it uses streamable HTTP with OAuth and needs no Last.fm API key or hand-copied tokens, though every tool still requires sign-in; and that the agent cannot finish sign-in, so its last step is to tell the human how to sign in for their client.
3. **Setup by client:** Claude Code (the `claude mcp add` command, then `/mcp` to sign in), Claude app (the human steps, since an agent can't do them), ChatGPT, Codex, Cursor, Windsurf, OpenCode, `mcp-remote`. Same facts as the page's setup tabs.
4. **What you can ask:** the example questions.
5. **Tools:** generated list.
6. **Links:** GitHub, privacy page, release notes.

### Sharing and search (SEO and AEO)

Today the share image is a stock photo at 1200×797 that previews crop, the sitemap's `lastmod` changes on every request, and the JSON-LD is a bare `SoftwareApplication`. Live checks on 2026-11-12: `robots.txt` allows everything except `/mcp`, `/authorize` and `/oauth`, and spoofed GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot and Googlebot user agents all get 200.

**Title and description.**
- `<title>`: "Last.fm MCP: connect your Last.fm history to Claude, ChatGPT, and other AI assistants". The visible headline stays "Ask your AI about everything you've ever listened to."
- Meta description: "Ask your AI when you first played an album, what you had on repeat last summer, or what to play next. Free and open source, and it only reads."
- Remove the `keywords` meta tag.
- `<meta name="theme-color" content="#ece6dc">`.

**Share card (Rian picked option A, "the hero as a card").** A 1200×630 PNG: sand background, "Last.fm MCP" wordmark top left, the headline "Ask your AI about everything you've ever listened to." in Bricolage Grotesque 700 at about 76px, and a still frame of the wave along the bottom. Mockup: `.superpowers/brainstorm/9184-1794525134/content/og-card.html` (gitignored, reference only).
- Source: `src/pages/share/og-card.html`, rendered to `src/pages/share/og.png` by a script with headless Chrome (`--screenshot`, exact window size). Both files are committed; the script reruns only when the card changes.
- Served by the Worker at `GET /og.png` (`image/png`, `public, max-age=86400`), imported through a wrangler `Data` module rule for `**/*.png`.
- Also render `src/pages/share/apple-touch-icon.png` (180×180: sand square with a small wave), served at `/apple-touch-icon.png` and linked with `<link rel="apple-touch-icon">`.
- Tags: `og:type` website, `og:site_name` "Last.fm MCP", `og:title`, `og:description`, `og:url` `https://lastfm-mcp.com/`, `og:image` `https://lastfm-mcp.com/og.png`, `og:image:width` 1200, `og:image:height` 630, `og:image:alt` "Last.fm MCP: Ask your AI about everything you've ever listened to."; `twitter:card` `summary_large_image` with matching title, description, image and `twitter:image:alt`. Image and canonical URLs stay hardcoded to production.

Post-review change (2026-11-12): the title gained an Oxford comma and the description says "first played" instead of "first heard", since Last.fm only knows what was scrobbled. The headline, alt text and share card are unchanged. The shipped FAQ lives in `src/pages/faq.ts`: the review added the Authenticate step to the Claude answer, and the ChatGPT answer now says "on the web" and points to the setup section instead of promising that any other app works.

**FAQ.** Draft questions and answers below; Task 2's verification may change them, and the ChatGPT answer must match what the docs confirm.
- *How do I connect Last.fm to Claude?* In Claude, go to Settings → Connectors, click Add custom connector, paste `https://lastfm-mcp.com/mcp`, and sign in to Last.fm. In Claude Code, run `claude mcp add --transport http lastfm https://lastfm-mcp.com/mcp`, then `/mcp` to sign in.
- *Does it work with ChatGPT?* Yes, in ChatGPT plans that allow custom connectors (the exact plan and menu come from Task 2). Otherwise: any app that supports remote MCP servers.

If Task 2 finds ChatGPT can connect only under conditions (a paid plan, developer mode), keep ChatGPT in the title, subline and share card and spell the conditions out in this answer. Drop ChatGPT from all of them only if it can't connect at all. *(Claude's call, from the second builder check.)*
- *Do I need a Last.fm API key?* No. You sign in with your normal Last.fm account.
- *Is it free?* Yes. It's free and open source under the MIT licence.
- *Can it change my Last.fm account?* No. It only reads: it can't scrobble, love tracks, or edit your profile.
- *What is MCP?* The Model Context Protocol is an open standard that lets AI assistants connect to outside data and tools. This is an MCP server for Last.fm.

The FAQ items live once, as data, and the Worker renders both the visible section and the `FAQPage` JSON-LD from them, so the two can't drift. FAQ answers use the production URL, not `{{ORIGIN}}`: they're reference text, not something to copy into a client.

**Structured data.** One `application/ld+json` block with an `@graph`:
- `WebSite`: name "Last.fm MCP", url.
- `SoftwareApplication`: name, description, url, `applicationCategory` "MultimediaApplication", `operatingSystem` "Any", free `Offer`, MIT `license`, `author` as a `Person` (Rian van der Merwe, `https://elezea.com`), `codeRepository`-style link to GitHub via `sameAs`, `featureList` (a few plain phrases), `screenshot` `https://lastfm-mcp.com/og.png`.
- `FAQPage` from the FAQ items.

No `softwareVersion`: it would go stale between releases.

**Crawlers.**
- `robots.txt`: keep `User-agent: *` with the existing rules; add `Allow: /llms.txt` and `Allow: /og.png`. No per-bot groups and no `Crawl-delay` (a Crawl-delay-only group can merge into the next group's Disallow in Google's parser).
- `sitemap.xml`: `lastmod` comes from a `LANDING_PAGE_UPDATED` date constant next to the page builder, changed when the page changes; drop `changefreq` and `priority`, which Google ignores.
- Zone check (read-only): confirm the lastfm-mcp.com zone isn't blocking AI search crawlers through Cloudflare's AI bot or crawler controls, and isn't prepending a managed `robots.txt`. A spoofed user agent can't prove this, because those controls use verified bot identity. If something is blocked, report it to Rian; don't change zone settings.

### Server address

The page's setup snippets, the agent prompt and `/llms.txt` use the origin they're served from, filled in by the Worker per request from a `{{ORIGIN}}` placeholder (production gives `https://lastfm-mcp.com`). That way the staging agent-prompt check sets up staging, not production. The canonical URL, OG/Twitter URLs and JSON-LD stay hardcoded to `https://lastfm-mcp.com`. *(Claude's call, from the builder check.)*

### Build

- Add to `wrangler.toml`: `[[rules]] type = "Text" globs = ["**/*.html", "**/*.md"] fallthrough = true`, and a second rule `type = "Data"` for `["**/*.png"]` (imports as `ArrayBuffer`). Confirm it applies to `[env.production]` (check `npx wrangler deploy --dry-run --env production` bundles both files).
- Add a module declaration so TypeScript accepts `import landingHtml from './pages/landing.html'` and the `.md` import.
- **First task: prove the rule works in tests.** Import a tiny `.html` file in a throwaway test under vitest-pool-workers. If it can't be made to work without hacks, stop and fall back to option 2 (TypeScript strings), keeping everything else in this spec.
- Delete `src/marketing-page.ts` once nothing imports it.
- Check Prettier and ESLint behaviour on the new files (`npm run format:check`, `npm run lint`). Formatting the HTML with Prettier is fine; the repo's tabs/no-semicolons style applies to inline JS.
- `// ABOUTME:` headers: `.html` and `.md` files can't take `//` comments. Use an HTML comment in `landing.html` and leave `llms.md` without one (its first lines are served to agents). Note this exception in AGENTS.md.
- Update AGENTS.md's architecture block (`marketing-page.ts` → `pages/`).

### Privacy page

The [privacy page](https://elezea.com/privacy/#lastfm-mcp-server) currently says the home page "loads an icon stylesheet from unpkg.com". After this change it loads fonts from Google Fonts instead. Update that sentence in elezea.com (`src/content/pages/privacy.md`) and merge it before or with the landing page deploy, as with earlier lastfm-mcp privacy changes.

### Tests

- Update `should return marketing page for GET /` in `test/index-oauth.test.ts` to assert on new content (for example the headline and the MCP URL).
- `GET /llms.txt`: 200, `text/plain; charset=utf-8`, contains the server URL, and contains every tool name from both catalogs.
- `robots.txt` includes `Allow: /llms.txt` and `Allow: /og.png`, and has no `Crawl-delay`.
- `GET /og.png` and `GET /apple-touch-icon.png`: 200, `image/png`, body starts with the PNG signature; `og.png` is 1200×630 (read the IHDR bytes).
- The page has every tag listed under "Sharing and search", no `keywords` meta, and a JSON-LD block that parses as JSON with `WebSite`, `SoftwareApplication` and `FAQPage` nodes; every FAQ question appears both in the visible section and in the JSON-LD.
- `sitemap.xml`'s `lastmod` equals `LANDING_PAGE_UPDATED` and doesn't change between requests.

### Verification before merge

- **Example questions:** for each one, confirm which tools answer it and try it against Rian's account (via the local `lastfm` MCP connection). Drop or reword failures.
- **Setup steps:** check the Claude app, ChatGPT and Codex steps against each vendor's current docs, with links in the PR. Anything that can't be confirmed is cut, not guessed.
- **Agent prompt:** run the "paste this to your agent" prompt in a fresh Claude Code session on staging (with the URL pointed at staging) and confirm it adds the server and tells the human to run `/mcp`.
- **Share and search:** on staging, the page passes validator.schema.org with no errors, every share tag is present, and staging's own `/og.png` renders at 1200×630. Staging's `og:image` still points at production, which has no `/og.png` until merge, so the full unfurl check (Slack or iMessage, plus an Open Graph preview tool) happens once, right after the production deploy. *(Claude's call, from the second builder check.)*
- **Visual:** staging deploy (`npm run deploy`), checked in Chrome and Safari, at desktop and phone width, with reduced motion on and off.

### Review

The page and `llms.txt` are public text, so the final copy goes to Rian before merge, after a Codex review per product-ai's review rule. No version bump: `SERVER_VERSION` tracks server behaviour, and this change touches none. Whether to cut a GitHub release for it is Rian's call at merge time.

## Left to the builder

- Exact CSS, spacing, and breakpoints, matching the mockups.
- How the wave's sine parameters are tuned, as long as it reads as a slow, organic stream.
- Copy-button implementation (the current `copyCode` is fine to keep).
- ChatGPT and Codex config details, from current docs.
