# Consent Page on /authorize: Design Spec

**Date:** 2026-10-25
**Status:** Draft
**Issue:** [#40](https://github.com/rianvdm/lastfm-mcp/issues/40)

---

## Why

`/authorize` sends the user straight to Last.fm. The user never sees which MCP client asked for access or where the authorization code will go, and Last.fm's own approval page names only "Last.fm MCP", so it can't tell them either.

Anyone can register a client (dynamic client registration is open by design, and CIMD clients only need an HTTPS URL). An attacker can register a client with their own redirect URI, send a victim a crafted `/authorize` link, and receive the code after the victim approves on Last.fm. The resulting token is read-only through this server, so the exposure is listening history and profile. An external reporter raised this on 2026-10-13.

The MCP 2026-07-28 authorization spec requires a fix here ([security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations)):

- Proxy servers using one static upstream client ID (this server uses one Last.fm API key for every client) MUST obtain user consent for each dynamically registered client before forwarding to the third-party authorization server.
- Authorization servers MUST display the redirect URI hostname during authorization for CIMD clients, and SHOULD warn when it is localhost-only.

## Goals

- Meet both spec requirements above.
- Keep friction low. Rian's words: "Very little friction. Just want to make sure I don't violate the requirement." In practice, a client with a fixed web callback shows the page once, then not again for 30 days. A local agent shows it on each full sign-in, which is rare.
- Look like elezea.com, not like the dark marketing page.

## Non-goals

- Changing the manual `/login` + `/callback` flow (session_id clients). It doesn't involve a third-party MCP client choosing a redirect URI.
- Rate-limiting `/oauth/register`. That is [#45](https://github.com/rianvdm/lastfm-mcp/issues/45).
- Scope selection. The server has no scopes, so the page shows no scope checkboxes.
- Building a shared package for discogs-mcp. See "Later".

## Anti-goals

- A page that puts a self-asserted client name in the most prominent position. A DCR client picks its own name, so an attacker can call itself "Claude". The headline is generic and the name sits in the details with a "not checked" note.
- Any regression for existing users: an upgrade that signs everyone out counts as a failure even if the consent page works.

## Part 1: Upgrade `@cloudflare/workers-oauth-provider` 0.10.3 → 1.x

Latest on 2026-10-25 is 1.2.4. Recheck before starting. Follow the migration guide that ships in the package (`docs/migration-1.x.md`, plus `skills/migrate-to-1.x/SKILL.md`). The parts that matter here:

- **`resourceMetadata.resource` must match what existing grants carry, exactly.** A full read of production `OAUTH_KV` on 2026-10-25 found these values across 895 grants:

  | Stored `resource` | Grants |
  | --- | --- |
  | none | 727 |
  | `https://lastfm-mcp.com` | 122 |
  | `https://lastfm-mcp.com/` | 39 |
  | `https://lastfm-mcp.com/mcp` | 6 |
  | `https://lastfm-mcp-prod.rian-db8.workers.dev` | 1 |

  **Configure the bare origin, built per request from the request origin** (`https://lastfm-mcp.com` in production, the workers.dev origin on staging). 1.x treats an empty path and `/` as equal, so this covers 888 of 895 grants. The 6 `/mcp`-bound grants and the 1 workers.dev grant get `invalid_grant` on their next refresh and sign in once. That's an accepted cost (my call, under 1%). The multi-resource `OAuthAuthorizationServer` route isn't worth it for 7 grants.
- 0.10.3 already answers every `/.well-known/oauth-protected-resource*` path itself, before `defaultHandler` runs. The root path advertises the origin and `/mcp` advertises `…/mcp`. So `handleProtectedResourceMetadata` in `src/auth/oauth-handler.ts` is already dead code: delete it. After the upgrade, confirm the root metadata response still advertises the origin. Also check whether the `WWW-Authenticate` rewrite in `src/index-oauth.ts` is still needed, so that clients keep fetching root metadata.
- Leave `allowPrivateUseRedirectUris` off. Clients registered only with private-use schemes will have to re-register. Clients like Cursor also register https/loopback callbacks.
- User IDs can't contain `:`. The user ID is the Last.fm username, and Last.fm usernames can't contain `:`, so no change is needed.
- **Staging gate:** deploy to staging, and confirm that a session created on the 0.x deployment still refreshes and calls a tool after the upgrade. Then deploy to production.

The upgrade can ship as its own PR before the consent page, and that's the preferred order.

## Part 2: The consent flow

Use the library's helpers (1.1+). Docs ship in the package: `docs/consent-page.md`, `docs/upstream-sign-in.md`.

```
GET /authorize
  parseAuthRequest → describeConsent → isConsentRemembered?
    yes → beginUpstream(request) → 302 Last.fm (cb = /lastfm-callback?state=…)
    no  → beginConsent → render page (handle in hidden field)

POST /authorize
  decision=deny    → denyConsent → 302 client redirect_uri with access_denied
  decision=approve → approveConsent(…, { remember }) → beginUpstream → 302 Last.fm

GET /lastfm-callback
  finishUpstream → getSessionKey(token) → completeAuthorization → 302 client
```

Decisions:

- **`beginUpstream`/`finishUpstream` replace the `oauth-pending:{state}` KV record** in `MCP_SESSIONS`. Last.fm's `state` then exists only after consent and is bound to the browser. Last.fm returns the `cb` URL with `token` appended, so `state` rides in the callback URL's query string as it does today.
- **Last.fm returns without a token** (the user declined there): call `finishUpstream` and redirect the client with `access_denied`, per `upstream-sign-in.md`.
- **Remember approvals for 30 days** (the library default `maxAgeSeconds`). Rian approved this. Pass no `subject`: the server learns the Last.fm user only after consent, so approvals belong to the browser, as the docs describe for proxy servers. Approvals are bound to client ID + redirect URI + resource, so a client that changes its redirect URI sees the page again.
- **Local agents won't hit the remembered approval, and that's accepted (Rian approved).** The library's approval key hashes the exact redirect URI, port included. Most loopback clients pick a new port for each sign-in, so they see the page on every full sign-in. Full sign-ins are rare: refresh tokens don't expire here, so a client only signs in again on first setup, after re-adding the server, after losing its tokens, or after a grant is revoked. Don't write custom approval storage to get around the port.
- **New Worker secret `CONSENT_SECRET`** (32+ chars) for the remembered-approval cookie. Add it to `Env`, the `wrangler.toml` secrets comment, test bindings, and both environments before deploy.
- **Error handling** follows the table in `consent-page.md`: render locally for `CimdFetchError` and for `AuthorizationError` without `redirectTo`. Keep today's choice of not redirecting errors back to the client: anyone can register a client, so redirecting would make this an open redirector. Expired, replayed, or other-browser consent gets a local page with a "start again" message. Anything else is a 500.
- **CSP on the consent response:** keep the library's `frame-ancestors 'none'` and `X-Frame-Options: DENY`. Don't set `form-action 'self'` on this page, as `buildSecurityHeaders` does today. Chrome applies `form-action` to redirects that follow a form POST, so it would block both the 302 to `www.last.fm` and the Deny redirect to the client. Either omit `form-action` or derive it from the actual targets. Verify the approve and deny redirects in a real browser.
- Escape every client-supplied value (name, domain, hostname). They're attacker-chosen.

## Part 3: The page

The chosen layout is "A, plain page like a blog post". The mockup is at `.superpowers/brainstorm/62724-1792940238/content/consent-layout-v2.html` (gitignored, local only).

Content, top to bottom:

1. Wordmark: orange dot + "Last.fm MCP".
2. Headline: "An app wants to read your Last.fm listening data". It deliberately doesn't name the app.
3. "If you continue, Last.fm will ask you to sign in. The app gets read-only access to your listening history and profile. It can't scrobble or change anything."
4. Details list:
   - **App:** the client name. For a CIMD client, "Published by {clientDomain} (verified)". For a DCR client, the name in quotes plus "The app chose this name itself. It hasn't been checked."
   - **Access goes to:** the redirect hostname in monospace.
5. When `redirectIsLoopback`: a yellow warning box saying "This sends access to an app on your computer. Continue only if you just started connecting from that app."
6. Buttons: "Continue to Last.fm" (primary) and "Don't allow" (secondary).
7. Fine print: a Privacy link to `https://elezea.com/privacy/#lastfm-mcp-server`. When the redirect isn't loopback, it also says "You won't be asked again for this app for 30 days." For loopback redirects, leave that sentence out, because it wouldn't be true.

Visual language, from `elezea.com/src/styles/styles/variables.css` and `btns.css`:

- White background, `#444` body text, `#1b1b1b` headings.
- Single left-aligned column of about 560px, 17px body size.
- Primary button: white fill, 2px `#ff6c00` border, bold orange text, 5px radius. Secondary button: white fill, 1px `#1b1b1b` border.
- Warning box: `#ffe670` left border on a pale yellow fill.
- Hairline `#ddd` rules between detail rows.
- Works at phone width. Most users arrive from a desktop client, but some will be on a phone.

**Fonts (my call):** use the serif fallback stack elezea.com already declares (Georgia, Cambria, "Times New Roman", serif) rather than loading Newsreader / Source Serif 4. That keeps third-party requests off an auth page and keeps the CSP tight. Revisit if it doesn't look close enough.

**Module boundary:** put the page in its own file (e.g. `src/auth/consent-page.ts`) as a pure function. It takes `ConsentDescription`, the handle, and a small branding object (product name, access sentence, privacy URL) and returns HTML. No env or KV access. This is what makes a later copy into discogs-mcp cheap.

**Error page (builder's call):** a short page in the same style, used for expired, replayed, or invalid consent and for CIMD fetch failures.

## Tests

Use the existing `cloudflare:test` integration style (see `test/oauth-roundtrip.test.ts`, `test/oauth-cimd.test.ts`, `test/oauth-authorize-errors.test.ts`). Last.fm's `getSessionKey` is mocked as those tests already do.

- Approve: GET shows the page, POST approve → 302 to Last.fm with `state`, the callback completes, and the client gets a code that exchanges for a token.
- Deny: POST deny → 302 to the client redirect URI with `error=access_denied` and the original `state`.
- Expired consent, a replayed handle, and a POST without the binding cookie are all rendered locally, with no redirect.
- Remembered: after one approval, a second GET for the same client and redirect URI goes straight to Last.fm. A different redirect URI shows the page.
- CIMD client: the page shows its verified domain. DCR client: the "hasn't been checked" note.
- Loopback redirect URI: the warning is present and the 30-day sentence is absent. Non-loopback: the reverse.
- Escaping: a client named `<script>` renders inert.
- Last.fm callback without a token → `access_denied` to the client.
- Existing round-trip and CIMD tests updated for the extra consent step.

## Rollout

The builder prepares each step and stops for Rian's go-ahead before any secret, deploy, or production KV write (my call).

1. PR 1: library upgrade, after confirming the grant resource in production KV. Deploy to staging, run the session-survival check, then deploy to production.
2. PR 2: consent page. `wrangler secret put CONSENT_SECRET` on staging and production first. Then try it in a real browser on staging: Claude (or another client) end to end, approve, deny, and a second connect that skips the page.
3. Close #40 with a note on the Last.fm repeat-authorization check (below).

## Open check, not blocking

The issue asks whether Last.fm skips its own "allow access" page on repeat authorizations for the same API key. If it does, this consent page is the only thing a user clicks for a previously approved app. That makes it the whole defence rather than an extra layer. The design is the same either way. Record the answer in the PR or the issue.

## Later

- Reuse the page module in discogs-mcp, which has the same proxy shape. Not part of this work.
