# Music recommendations rebuild

## Problem

People who ask their AI client "what should I listen to?" get poor picks from this server, so their agents work around the tool meant for that question. `get_music_recommendations` got 5 of 2,063 tool calls between 2026-11-12 and 2026-11-14 (the whole history of the `lastfm_mcp_tool_events` dataset at the time). Over the same period agents called `get_artist_top_tracks` 370 times and `get_similar_artists` 235 times, which suggests they build recommendations themselves by chaining lookups.

The tool deserves to be skipped. `CachedLastfmClient.getMusicRecommendations` in `src/clients/cachedLastfm.ts`:

- seeds only from the user's top 3 all-time artists, 5 similar artists each
- never removes artists the user already plays, so it mostly returns the user's own library
- accepts `genre` and ignores it
- always returns an empty `recommendedTracks`
- caches the result for 24 hours, so it ignores this week's listening

## Outcome

More people call `get_music_recommendations`, because it answers "find me something new" better and faster than an agent chaining calls. We'll see it in `lastfm_mcp_tool_events`: daily calls to the tool and its share of all tool calls, against the baseline of 5 calls (0.24% of calls) over 2026-11-12 to 2026-11-14. Tool events deliberately carry no user identifier, so distinct users per tool can't be measured and this design doesn't add one.

## Approaches

| Approach | Trade-off | Decision |
| --- | --- | --- |
| **A. Rebuild in place under the same name** | Nothing breaks: Claude Code allowlists for `mcp__lastfm__get_music_recommendations` keep working, and usage stays on one name. Agents pick tools by description, and the old description is the weak part, not the name. | **Chosen** |
| B. New tool (for example `discover_music`) beside the old one, old one deprecated | A fresher name, but two overlapping tools confuse agent tool choice for a while, churn the tool list, need a later removal, and split the metric across two names. | Rejected |
| C. A prompt that chains existing tools, no server engine | Almost no code, but it doesn't move tool calls (the goal), prompt support varies by client, and agents can already chain these tools unaided. | Rejected |

## Goals

1. Recommend artists the user doesn't already play, ranked by how strongly their current listening points at them.
2. Give each pick the evidence behind it, from the user's own data, plus one starter album and two starter tracks so the agent doesn't need a follow-up round.
3. Make `genre` work, and add `exclude` so an agent can ask for "different ones".
4. Reflect recent listening: results refresh within an hour.
5. Make agents choose this tool for recommendation requests.
6. Record how many Last.fm HTTP requests each tool call makes, retries included, so the cost is measured, not estimated.

## Non-goals (v1)

- "Deeper into an artist" and "long tail" modes. Long tail needs listener counts per candidate, another round of calls; revisit with v1's measured call counts.
- Server-side storage of per-user preferences such as moods or dislikes. `exclude` keeps that state in the client.
- Spotify links. Every pick already gets a ListenToMore link, which resolves to streaming links.
- A dashboard panel for the new call-count field. Ad-hoc Analytics Engine SQL covers it until it proves useful.
- The `username` argument on the other five prompts. Worth a follow-up issue.

## Anti-goals

- **A rate-limit incident for everyone else.** One recommendation fanning out into a burst of Last.fm calls must not get the shared egress throttled. No 429s were logged in the 72 hours to 2026-11-14 (zero `Retry attempt` lines, zero `API error 29`), with a busiest minute of 192 tool calls; keep it that way.
- **Recommending what the user already plays heavily.**
- **Any per-user identifier or preference stored server-side**, in KV or in analytics.
- **A tool slow enough that agents give up on it or users prefer chaining.** A cold call has a hard deadline (see Protecting Last.fm).

## Constraints

- Last.fm's rate limit is per IP and undocumented. Error 29 exists; the often-quoted "5 requests per second per IP, averaged over 5 minutes" is secondhand. Workers egress IPs are shared and not fixed.
- Single Last.fm lookups on a cache miss take about 300–500 ms at p50 and up to about 1 s at p95 (from `double1` in `lastfm_mcp_tool_events`; `get_top_artists` misses reach 1.7 s at p95).
- The account is on Workers Enterprise, so subrequest and KV write limits don't constrain this design.
- A merge to `main` deploys production. Test on staging (`npm run deploy`) before merging.
- Repo conventions in `AGENTS.md` apply: `// ABOUTME:` headers, tabs, no semicolons, `describe`/`it`, `toolError` for tool failures, release bump of `package.json`, `package-lock.json` and `SERVER_VERSION`.

## Design

### Tool inputs

| Input | Type | Notes |
| --- | --- | --- |
| `username` | optional string | Kept for compatibility; defaults to the signed-in user, as today. |
| `limit` | optional number, 1–15, default 8 | Number of picks. The old maximum of 50 drops, because each pick now costs two starter lookups. |
| `genre` | optional string | A Last.fm tag, for example `shoegaze`. |
| `exclude` | optional array of artist names, up to 50 | Never returned. Matched case-insensitively after trimming. |

### How picks are found

1. **Seeds.** Fetch the user's top artists for `7day`, `1month` and `12month` (about 10–15 each), and `overall` with Last.fm's maximum page size (expected 1000; the builder confirms the maximum). The four calls run concurrently and use the existing 1-hour `userTopArtists` cache.
2. **Library.** Everything in those four lists counts as "already played". An artist outside the user's top 1000 overall may be recommended. The reason line says "Not in your top 1000", or "Not in your library" when the user's overall list is shorter than the page size. No per-pick play-count lookup: it would cost one unshared call per pick (decided 2026-11-14).
3. **Fan-out.** Take up to about 12 distinct seeds, favouring recent windows, and fetch similar artists for each through the existing 7-day, cross-user `similarArtists` cache. Use the same `limit` the `get_similar_artists` tool uses by default, so the two share cache entries.
4. **Score.** A candidate's score sums, over every seed that points to it, the seed's window weight times Last.fm's similarity `match`. Recent windows weigh more (starting point: 7day 3, 1month 2, 12month 1, overall-only 0.5; tunable constants). Remove candidates in the library or in `exclude`. Break ties by number of seeds pointing to the candidate.
5. **Genre.** When `genre` is set, fetch the tag's top artists once (`tag.getTopArtists`, a new client method, cached about 7 days and shared across users) and keep only candidates in that list. If fewer than `limit` survive, top up with the tag's highest-ranked artists that aren't in the library or `exclude`, with a reason that says so. An unknown tag returns a clear message, not an error.
6. **Starters.** For each final pick, fetch the artist's top albums and top tracks through the existing 24-hour shared caches, and show one album and two tracks.

### Protecting Last.fm

- At most 4 Last.fm requests in flight per tool call (a tunable constant).
- A budget of 40 Last.fm HTTP requests per tool call, retries included. Counted at `LastfmClient.makeRequest` / `fetchWithRetry`, not from cache misses: a cache miss can make several requests (composite methods) or none (the outer result cache), and retries are the requests that matter while Last.fm is throttling.
- A wall-clock deadline of 8 seconds per cold call (a tunable constant). The engine's Last.fm calls retry at most once and don't wait out a long `Retry-After`; the existing retry policy (three retries, `Retry-After` up to 15 s) can otherwise stall one lookup for over 30 s. Other tools keep the existing policy.
- If the budget or deadline runs out, or Last.fm returns a 429 or error 29, stop fetching and return the picks found so far, with a one-line note that results are partial. Starters are optional: a pick whose starter lookups didn't finish shows without them. Partial results aren't cached. Fail the tool with `toolError` only if the seed step fails.
- Rough uncached cost: 4 seed calls, about 12 fan-out calls, 1 tag call, and 2 starter calls per pick (16 at the default limit), about 33 in all. At `limit` 15 that's about 47, so a cold call at high limits may hit the budget and return some picks without starters; that's acceptable. Most of the fan-out and starter calls are shared across users and cached for days, so warm calls cost far less. These are estimates; goal 6 measures them.

### Caching

| Data | TTL | Shared across users |
| --- | --- | --- |
| User top artists per window | 1 hour (unchanged) | No |
| Similar artists | 7 days (unchanged) | Yes |
| Tag top artists (new) | about 7 days | Yes |
| Artist top albums and tracks | 24 hours (unchanged) | Yes |
| Ranked candidate list | **1 hour** (was 24 hours for the old finished result) | No |

- Cache the full ranked candidate list per user and `genre`, not the finished output. Apply `exclude` and `limit` when reading it, then fetch starters through their own shared caches. `exclude` is never written to KV, so the anti-goal on stored preferences holds, and a "different ones" call is almost free.
- Give the key a new version prefix, so no 24-hour entry in the old shape is served after deploy.
- One hour keeps a list stable within a conversation while still reflecting the week's listening.

### Output

Text, like the other tools:

- A heading naming the user, and the genre if set.
- For each pick:
  - the artist
  - the reason in plain words, citing the user's data, for example "Similar to Slowdive (#2 this week), Mojave 3 (#5 this month) and Cocteau Twins (#14 this year). Not in your top 1000."
  - "Start with:" one album and two tracks
  - the ListenToMore artist line from `buildListenToMoreLine`
- A partial-results note, when it applies.
- A "Next steps" block (`buildNextSteps`): call again with `exclude` set to these picks for different ones; `get_artist_info` on a pick; `get_similar_artists` from a pick.

### Getting agents to choose the tool

- Rewrite the tool description to say when to use it ("what should I listen to", "recommend", "find new music", "something like X but new to me"), what it returns (new-to-you artists with reasons and starter tracks), and that it replaces chaining similar-artist lookups.
- Update its summary in `src/mcp/tools/catalog.ts`; `/llms.txt` picks that up.
- Rewrite the "Personalized picks" line in the server instructions (`src/mcp/server.ts`) to match.
- Add a "Next steps" hint pointing to it from `get_recent_tracks`, `get_top_artists` and `get_similar_artists`.
- Replace the `music_discovery` prompt (`src/mcp/prompts/analysis.ts`): drop `username`, keep optional `genre`, and tell the model to call `get_music_recommendations`, present the reasons, and offer to exclude picks the user rejects.

### Measuring cost

- Count Last.fm HTTP requests per tool call, retries included, at the request layer (for example a `requests` counter beside the hits and misses in the per-call `CacheTally`). Record it on `ToolCallEvent` as `double2`, for every tool. Update the layout comment in `src/analytics/toolEvents.ts`. The dashboard's existing SQL reads only `double1` and the blobs, so nothing there changes.

### Release

- A minor version bump (2.8.0 → 2.9.0) per the release steps in `AGENTS.md`.
- Deploy to staging and try the tool from Claude, with and without `genre` and `exclude`, before merging.

## Testing

- Unit tests for scoring, library and exclude removal, genre intersection and top-up, and the cache key (pure functions, no network).
- Tool tests with a mocked client: output shape, partial results when the budget or deadline runs out and on a 429, picks without starters, unknown genre, `exclude` applied on read (and absent from every KV key and value), `limit` bounds.
- Concurrency cap: a test proves no more than 4 lookups run at once.
- An instrumentation test for `double2`, including a retried request counting twice.
- Update the server snapshot for the new tool schema and prompt.

## Left to the builder

- Module layout for the engine (for example `src/recommendations/` with pure scoring separate from fetching).
- The exact seed counts per window, weights, fan-out width and similar-artist limit, within the starting points above.
- How the concurrency cap is implemented.
- Exact wording of the description, instructions and output, within the content above.
