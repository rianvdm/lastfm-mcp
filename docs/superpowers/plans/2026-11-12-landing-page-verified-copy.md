# Landing page and llms.txt: verified copy

**Date:** 2026-11-12
**For:** Tasks 3, 4 and 6 of `2026-11-12-landing-page-redesign.md`. Copy text from here, not from the spec, wherever the two differ.
**Account used for questions:** `bordesak` (164,688 scrobbles since December 2008), through the local `lastfm` MCP connection.

Statuses: **PASS** (good answer, or confirmed against an official source), **WEAK** (answers, but poorly), **FAIL**, **CUT** (couldn't confirm, so it doesn't ship), **HEDGED** (confirmed in part; the wording below only claims the confirmed part).

In every snippet below, `{{ORIGIN}}` is the placeholder the Worker fills in per request. FAQ answers use the production URL `https://lastfm-mcp.com` instead, per the spec.

---

## Example questions

Final list for the "Things you can ask" bubbles and the "What you can ask" section of `llms.txt`, in this order:

1. When did I start listening to Radiohead?
2. What was I obsessed with last summer?
3. How has my taste changed since 2015?
4. What did I listen to yesterday?
5. Find me artists like my top five, but ones I've never played
6. Where should I start with Talk Talk, given what I already like?
7. Which albums did I play to death and then forget about?

Final lede: "Ask in your own words. It reads your scrobbles, charts and loved tracks, and works out days like "yesterday" in your own timezone."

| # | Question | Tools that answer it | Result |
|---|---|---|---|
| 1 | When did I start listening to Radiohead? | `get_artist_info` (with username, for "Your plays"), `get_weekly_artist_chart` with arbitrary `from`/`to` ranges, narrowed year → half → month | **PASS.** 1,159 plays overall. Year charts for 2009–2014 don't list Radiohead; it first shows in July 2015 (8 plays), then 56 plays in 2017 and 99 in 2018. Took about 15 calls. Caveat: each chart lists only the top 30 artists, so a handful of earlier plays could be hidden in a busy period. An assistant that narrows the range finds them; one that doesn't will say "around mid-2015". |
| 2 | What was I obsessed with last summer? | `get_weekly_artist_chart`, `get_weekly_track_chart` (June 1 to September 1, 2026) | **PASS.** Nils Frahm with 301 plays, far ahead of Boards of Canada (117) and Death Cab for Cutie (114); top tracks led by Aurenza and Nightwhisper. |
| 3 | How has my taste changed since 2015? | `get_weekly_artist_chart` per year, `get_top_artists` (`12month`) | **PASS.** 2015 is worship and indie pop (Troye Sivan, Gungor, Hillsong Worship); the last 12 months are ambient and modern classical (Nils Frahm 981 plays, Stars of the Lid, Boards of Canada) plus 70s–80s rock (Genesis, Pink Floyd, Phil Collins). |
| 4 | What did I listen to yesterday? | `get_recent_tracks` with `date` and `timezone` | **PASS.** 55 scrobbles on 2026-11-11 in America/Los_Angeles: The War on Drugs and Ethel Cain in the morning, *The Bends* in the afternoon, ambient at night. Minor quirk, not a copy problem: the "now playing" track with no timestamp is included in a past-day result ("Showing 56 tracks out of 55 total"). |
| 5 | Find me artists like my top five, but ones I've never played | `get_top_artists` (`overall`, limit 5), `get_similar_artists` per artist, `get_artist_info` with username per candidate ("Your plays: 0") | **PASS.** Top five: Nils Frahm, The Midnight, Genesis, Phil Collins, David Crowder Band. Gentle Giant and Van der Graaf Generator (similar to Genesis) both show 0 plays; Siamese Youth (similar to The Midnight) shows 3, so it's correctly excluded. Note: `get_music_recommendations` alone does **not** filter out artists you've played (it suggested Ólafur Arnalds & Nils Frahm and Kalax, both played), so the assistant has to check plays per candidate. It does, given the question. |
| 6 | ~~What's the essential album by Talk Talk?~~ | `get_artist_top_albums` | **WEAK.** The tool returns popularity, not "essential": It's My Life ranks first by listeners. A good answer (Spirit of Eden or Laughing Stock) comes from the model's own knowledge, not your data, so it doesn't show off the product. Reworded once (row 6b). |
| 6b | Where should I start with Talk Talk, given what I already like? | `get_artist_info` (with username), `get_artist_top_albums`, `get_album_info` (with username, for tags and your plays), `get_top_artists` (`12month`) for your taste | **PASS.** You've played Talk Talk twice. Top albums: It's My Life, The Colour of Spring, Spirit of Eden, Laughing Stock. Spirit of Eden is tagged post-rock and ambient, which lines up with your last 12 months (Nils Frahm, Stars of the Lid), so there's a grounded, personal answer. |
| 7 | Which albums did I play to death and then forget about? | `get_top_albums` (`overall`, limit 30) against `get_top_albums` (`12month`, limit 100) | **PASS.** The Midnight's *Heroes* (675 plays), Coldplay's *X&Y* (374), Anberlin's *Never Take Friendship Personal* (342), Mae's *The Everglow* (328) and Death Cab for Cutie's *Plans* (305) are all in the all-time top 30 and missing from the last year's top 100 (under 36 plays each). |

Lede check: `get_loved_tracks` works (344 loved tracks). The timezone claim holds for day questions: `get_recent_tracks` computes day boundaries from the `timezone` the assistant passes (`src/mcp/tools/authenticated.ts`). Weekly charts and the `7day`/`1month`/… periods are UTC or rolling windows, so the spec's "works out dates in your own timezone" overreaches slightly; the lede above narrows it.

---

## Setup steps

### Claude app — PASS (labels changed from the spec)

Source: [Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/add-unlisted) (Claude docs) and [Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) (Claude Help Center). Both say **Customize → Connectors**, not "Settings → Connectors", and the dialog now asks for a name and has a **Continue** step before **Add**.

1. Open Claude (desktop app or claude.ai) and go to **Customize → Connectors**
2. Click **Add**, then **Add custom connector**. Name it Last.fm, paste this address, and click **Continue**: `{{ORIGIN}}/mcp` (copy button)
3. Leave the sign-in settings as they are and click **Add**, then **Connect**, and sign in to Last.fm
4. Start a new chat and ask something

Small print under the steps: "On the Free plan you can add one custom connector. On Team and Enterprise plans, an Owner adds it under Organization settings → Connectors, then you click Connect."

Facts behind it:
- Custom connectors work on Free, Pro, Max, Ultra, Team and Enterprise; Free is limited to one. Same source.
- "Leave the sign-in settings as they are": the dialog pre-selects settings it detects from the server and marks them **Detected**; the docs say to keep them. Our server advertises both Client ID Metadata Documents (`clientIdMetadataDocumentEnabled: true` in `src/index-oauth.ts`) and Dynamic Client Registration, which are the two automatic options.
- "**Connect**": the docs say "If the connector shows **Connect**, click it and sign in." Our server requires OAuth, so it will.
- If a chat doesn't use it: the docs say to click **+** in the chat, choose **Connectors** and turn it on. Optional line for `llms.txt`.

### Claude Code — PASS (command changed from the spec)

Source: [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp) and the [MCP quickstart](https://code.claude.com/docs/en/mcp-quickstart). Also checked against `claude mcp add --help` (Claude Code 2.1.322).

- Agent prompt (unchanged, verified in Task 8): `Set up the Last.fm MCP server for me. Instructions are at {{ORIGIN}}/llms.txt`
- "Or do it yourself. Run this in your terminal:" `claude mcp add --scope user --transport http lastfm {{ORIGIN}}/mcp` (copy button)
- Then: "Start Claude Code, run `/mcp`, choose **lastfm**, then **Authenticate**, and sign in to Last.fm in your browser."

Why `--scope user`: without it, `claude mcp add` uses `local` scope, which the quickstart describes as "registered to you, in this project: if you start Claude Code in a different project, this server isn't active there." A visitor who runs the command from their home folder would find Last.fm missing everywhere else. The quickstart's own all-projects example is `claude mcp add --scope user --transport http …`.

Sign-in wording is the quickstart's: "Select `sentry` from the list, press Enter, and choose `Authenticate`. Your browser opens to Sentry's sign-in page." Shell alternative for `llms.txt`: `claude mcp login lastfm` (listed in `claude mcp --help`).

### ChatGPT — HEDGED (conditional; see the ruling under FAQ)

Source for the steps: [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server) (OpenAI developer docs) and [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt). ChatGPT now calls these **plugins**; the old "Settings → Connectors → Advanced → Developer mode" path is gone from current docs.

Source for plans: the OpenAI Help Center article [Connecting custom MCP servers in ChatGPT](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt). That site returns 403 to WebFetch and curl, so plan facts come from search-engine extracts of the article, not a direct read. What they say: custom MCP servers are available on ChatGPT Pro (read and fetch only) and on Business, Enterprise and Edu (full support), on the web; on Business, Enterprise and Edu, admins and owners control who can add them. Neither the article extracts nor the [connectors article](https://help.openai.com/en/articles/11487775-connectors-in-chatgpt) list Free or Plus.

Steps for the "Other apps → ChatGPT" panel:

1. Open ChatGPT on the web and go to **Plugins** (chatgpt.com/plugins). Custom MCP servers need ChatGPT Pro, or a Business, Enterprise or Edu workspace that allows them.
2. Click **+**, then **Add custom MCP server**
3. Name it Last.fm and paste this as the **Server URL**: `{{ORIGIN}}/mcp`
4. Choose **OAuth** for authentication, read the warning, then click **I understand and want to continue** and **Create as a plugin**
5. Install the plugin and sign in to Last.fm when ChatGPT asks. In a chat, type **@** and pick Last.fm.

Confirmed in the developer docs: web access; the button labels in steps 2 and 4; "Supported MCP protocols: SSE and streaming HTTP"; authentication options **OAuth**, **No authentication**, **OAuth or no authentication**; OAuth via CIMD or DCR (our server offers both); "Install it before using it in a conversation"; type `@` to pick the plugin. Not documented: exactly when the OAuth sign-in window appears, hence "when ChatGPT asks".

### Codex — PASS (new)

Source: [Codex: MCP](https://learn.chatgpt.com/docs/extend/mcp) (the old `developers.openai.com/codex/mcp` URL redirects there). Also checked against `codex mcp add --help` (codex-cli 0.166.0).

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.lastfm]
url = "{{ORIGIN}}/mcp"
```

Then run `codex mcp login lastfm` and sign in to Last.fm in your browser.

Confirmed: `url` is the only required field for a Streamable HTTP server; OAuth (CIMD and DCR) is supported and is the default `auth`; "Run `codex mcp login <server-name>` separately to start an MCP OAuth login." The docs also say the ChatGPT desktop app, Codex CLI and IDE extension share this file. One-line alternative for `llms.txt`: `codex mcp add lastfm --url {{ORIGIN}}/mcp`.

### Cursor — PASS (snippet unchanged)

Source: [Cursor: Model Context Protocol](https://cursor.com/docs/mcp). `~/.cursor/mcp.json` is the global file ("tools available everywhere"); a remote server takes `url`; Cursor supports OAuth with DCR and reads the server's protected resource metadata.

```json
{
  "mcpServers": {
    "lastfm": {
      "url": "{{ORIGIN}}/mcp"
    }
  }
}
```

Sign-in line: "Cursor then asks you to sign in to Last.fm." The docs don't name the button, so don't name one.

### Windsurf — CUT, replaced by Devin Desktop (formerly Windsurf) — PASS

Windsurf is now Devin Desktop. `docs.windsurf.com/windsurf/cascade/mcp` redirects to [Devin Local customizations](https://docs.devin.ai/desktop/devin-local/customizations), which lists the MCP config files as `.devin/mcp_config.json`, `.devin/mcp_config.local.json` and `~/.config/devin/mcp_config.json`. The old `~/.codeium/windsurf/mcp_config.json` path with `serverUrl` doesn't appear in any current official doc I could find (only third-party guides), so the existing snippet is cut.

Replacement, from [Devin: MCP configuration](https://docs.devin.ai/cli/extensibility/mcp/configuration). Label: "Devin Desktop (formerly Windsurf)", file `~/.config/devin/mcp_config.json`:

```json
{
  "mcpServers": {
    "lastfm": {
      "url": "{{ORIGIN}}/mcp"
    }
  }
}
```

Then run `devin mcp login lastfm` and sign in to Last.fm. (The docs: "After adding an OAuth-based server to your config, authenticate using the `login` command.") If Rian would rather not add a renamed product to the grid, drop this panel; `mcp-remote` still covers it.

### OpenCode — PASS (snippet unchanged, sign-in line added)

Source: [OpenCode: MCP servers](https://opencode.ai/docs/mcp-servers/) and [Migrate from V1](https://opencode.ai/docs/migrate-v1/). Current OpenCode is V2, whose native shape nests servers under `mcp.servers`, but the migration page says "The V1 config format remains supported", and V1 (still installed for many people, including 1.17.8 on this machine) only reads the old shape. The existing snippet works on both, so it stays:

```json
{
  "mcp": {
    "lastfm": {
      "type": "remote",
      "url": "{{ORIGIN}}/mcp"
    }
  }
}
```

File label stays `opencode.json` (V2 reads JSON and JSONC). Then: "Run `opencode mcp auth lastfm` and sign in to Last.fm." V2 docs: "If the server needs authentication, run `/mcps`, select it, and complete authorization in the browser. The CLI can start the same flow: `opencode mcp auth sentry`." V1's `opencode mcp --help` lists the same `auth` command.

### Anything else via `mcp-remote` — PASS (snippet unchanged)

Source: [mcp-remote on npm](https://www.npmjs.com/package/mcp-remote) (0.16.6, published 2026-11-11) and its [README](https://github.com/punkpeye/mcp-remote). Default transport is `http-first`; the README recommends `-y` to skip npx's install prompt; OAuth opens in the browser.

```json
{
  "mcpServers": {
    "lastfm": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "{{ORIGIN}}/mcp"]
    }
  }
}
```

Intro line: "For apps that only run local servers. Your browser opens to sign in to Last.fm the first time it connects."

---

## FAQ

Visible section and `FAQPage` JSON-LD both render from these. Production URL, not `{{ORIGIN}}`.

**How do I connect Last.fm to Claude?**
In Claude, go to Customize → Connectors, click Add, then Add custom connector. Name it Last.fm, paste `https://lastfm-mcp.com/mcp`, click Continue, then Add, then Connect, and sign in to Last.fm. In Claude Code, run `claude mcp add --scope user --transport http lastfm https://lastfm-mcp.com/mcp` in your terminal, then run `/mcp` in Claude Code, choose lastfm and sign in.
*Sources: Claude app and Claude Code sections above.*

**Does it work with ChatGPT?**
Yes, on plans that allow custom MCP servers: ChatGPT Pro, and Business, Enterprise and Edu workspaces where an admin allows it. Use ChatGPT on the web: go to Plugins, click +, choose Add custom MCP server, paste `https://lastfm-mcp.com/mcp`, choose OAuth, and sign in to Last.fm. ChatGPT Free and Plus don't offer custom MCP servers. It also works with any other app that supports remote MCP servers.
*Sources: ChatGPT section above. HEDGED: plan list from Help Center extracts, not a direct read; see Concerns.*

**ChatGPT ruling: conditional.** ChatGPT can connect to a remote MCP server with OAuth, but only on some plans, on the web, and on workspaces only if an admin allows it. Per the spec's rule, ChatGPT **stays** in the `<title>`, the hero subline and the share card, and the conditions live in this answer.

**Do I need a Last.fm API key?**
No. You sign in with your normal Last.fm account.
*Source: the server holds its own key (`LASTFM_API_KEY` and `LASTFM_SHARED_SECRET` in `src/types/env.ts`) and sends you to Last.fm's own sign-in page (`https://www.last.fm/api/auth/` in `src/auth/lastfm.ts`, used from `src/auth/oauth-handler.ts`).*

**Is it free?**
Yes. It's free and open source under the MIT licence.
*Source: `LICENSE` (MIT License, Copyright (c) 2025 Rian van der Merwe); `"license": "MIT"` in `package.json`. No paid tier exists in the code.*

**Can it change my Last.fm account?**
No. It only reads: it can't scrobble, love tracks or edit your profile.
*Source: `src/` registers 21 tools: `ping`, `server_info`, `lastfm_auth_status` (which call no Last.fm method) and 18 `get_*` tools. Between them they call only these Last.fm methods: `album.getInfo`, `artist.getInfo`, `artist.getSimilar`, `artist.getTopAlbums`, `artist.getTopTracks`, `track.getInfo`, `track.getSimilar`, `user.getInfo`, `user.getLovedTracks`, `user.getRecentTracks`, `user.getTopAlbums`, `user.getTopArtists`, `user.getTopTracks`, `user.getWeeklyArtistChart`, `user.getWeeklyChartList`, `user.getWeeklyTrackChart`. The only POSTs in `src/` are `auth.getSession` and a signed `user.getInfo` check in `src/auth/lastfm.ts`. No `track.scrobble`, `track.love`, `track.updateNowPlaying` or tag calls exist.*

**What is MCP?**
The Model Context Protocol is an open standard that lets AI assistants connect to outside data and tools. This is an MCP server for Last.fm.
*Source: [What is the Model Context Protocol (MCP)?](https://modelcontextprotocol.io/docs/getting-started/intro): "MCP (Model Context Protocol) is an open-source standard for connecting AI applications to external systems."*

Related check on the trust section (not in Task 2's scope, recorded so Task 4 can rely on it): "each sign-in expires after 30 days" is true. `src/index-oauth.ts` leaves `refreshTokenTTL` at the `@cloudflare/workers-oauth-provider` 1.2.4 default of 30 days (`DEFAULT_REFRESH_TOKEN_TTL = 720 * 60 * 60`), and the grant's expiry is set once at sign-in; refreshing doesn't extend it because no `refreshTokenIdleTTL` is set. The README says the same.

---

## Changes from the spec

1. **Question 6 reworded.** "What's the essential album by Talk Talk?" → "Where should I start with Talk Talk, given what I already like?" The original was WEAK: Last.fm's ranking is popularity, so the answer came from the model's own knowledge, not the user's data.
2. **Lede narrowed.** "works out dates in your own timezone" → "works out days like "yesterday" in your own timezone". Only day queries use the user's timezone; charts and periods are UTC or rolling.
3. **Claude app steps relabelled.** "Settings → Connectors" → "Customize → Connectors"; "Click **Add custom connector**" → "Click **Add**, then **Add custom connector**", plus naming it and **Continue**; "Click **Add**, then **Connect**" now starts with "Leave the sign-in settings as they are". Matches current Claude docs. Added a small-print line on the Free-plan limit and the Team/Enterprise Owner step.
4. **Claude Code command gains `--scope user`.** The default local scope only works in the folder where you ran the command.
5. **Claude Code sign-in line.** "Run `/mcp` in Claude Code and pick **lastfm** to sign in." → "Start Claude Code, run `/mcp`, choose **lastfm**, then **Authenticate**, and sign in to Last.fm in your browser." Matches the quickstart, and adds "Run this in your terminal" before the command, which the quickstart also stresses.
6. **Windsurf cut, Devin Desktop (formerly Windsurf) added.** The old path and `serverUrl` key aren't in current official docs.
7. **Sign-in lines added** for Codex (`codex mcp login lastfm`), Cursor, OpenCode (`opencode mcp auth lastfm`), Devin Desktop (`devin mcp login lastfm`) and `mcp-remote`. The existing page didn't say how sign-in starts in those apps.
8. **FAQ "How do I connect Last.fm to Claude?"** updated to items 3–5.
9. **FAQ "Does it work with ChatGPT?"** names the plans and the menu path, says Free and Plus don't offer it, and keeps the "any other app" fallback.

No other copy changes. Headline, subline, hero button, agent prompt, "What you're agreeing to", footer, meta description, and the `<title>` stay as the spec has them.

---

## Concerns for Rian

1. **ChatGPT Pro may not run these tools.** OpenAI's docs say ChatGPT "respect[s] the `readOnlyHint` tool annotation… Tools without this hint are treated as write actions", and the Help Center extracts say Pro gets custom servers with read and fetch only. None of our tools set `readOnlyHint` (`grep` finds none in `src/`). So on Pro the tools may be blocked, and on Business, Enterprise and Edu each call may ask for confirmation. Before merge, either test on a Pro account or drop "ChatGPT Pro" from the FAQ answer ("on Business, Enterprise and Edu workspaces where an admin allows it"). Adding `annotations: { readOnlyHint: true }` to every tool is the real fix, but tool changes are a non-goal for this branch, so it would be a separate issue.
2. **ChatGPT plan list wasn't read directly.** help.openai.com returns 403 to every fetch tool here. A 30-second check in a logged-in browser would settle it.
3. **The "Windsurf" swap is a product call.** If "Devin Desktop" means nothing to visitors, cut the panel instead.
