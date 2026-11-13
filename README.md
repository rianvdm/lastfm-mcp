# Last.fm MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for Last.fm. Gives AI assistants access to your listening history, music discovery, and detailed track/artist/album information.

Runs on Cloudflare Workers. Your MCP client signs you in with OAuth the first time it connects, and after that every tool is available, from track and artist lookups to your own listening history.

## Quick start

[lastfm-mcp.com](https://lastfm-mcp.com) has setup steps for each app, including ChatGPT, Codex, Cursor, Devin Desktop (formerly Windsurf) and OpenCode. If an AI agent is setting it up for you, point it at [lastfm-mcp.com/llms.txt](https://lastfm-mcp.com/llms.txt).

### Claude.ai / Claude Desktop

1. Go to **Customize** -> **Connectors**
2. Click **Add**, then **Add custom connector**. Name it Last.fm, enter `https://lastfm-mcp.com/mcp` and click **Continue**
3. Leave the sign-in settings as they are, click **Add**, then **Connect**, and sign in to Last.fm

### Claude Code

```bash
claude mcp add --scope user --transport http lastfm "https://lastfm-mcp.com/mcp"
```

Then start Claude Code, run `/mcp`, choose **lastfm**, then **Authenticate**, and sign in to Last.fm in your browser.

### Other MCP clients

For clients that don't support remote servers directly (Continue.dev, Zed, etc.), use `mcp-remote`:

```json
{
	"mcpServers": {
		"lastfm": {
			"command": "npx",
			"args": ["-y", "mcp-remote", "https://lastfm-mcp.com/mcp"]
		}
	}
}
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector https://lastfm-mcp.com/mcp
```

## Authentication

The server uses OAuth 2.0. The first time your client connects, your browser opens a short page on lastfm-mcp.com that names the app asking for access and the address that access will go to. Approve it, then sign in to Last.fm. That browser remembers the approval for a year, so reconnecting the same app skips the page.

Access is read-only: the server can read your listening history and profile, but it can't scrobble or change anything. Sign-ins expire after 30 days, and your client then asks you to sign in again.

## Available tools

### Lookups and diagnostics

| Tool                    | Description                             |
| ----------------------- | --------------------------------------- |
| `get_track_info`        | Detailed information about a track      |
| `get_artist_info`       | Artist information and bio              |
| `get_album_info`        | Album details and track listing         |
| `get_artist_top_tracks` | An artist's globally most-played tracks |
| `get_artist_top_albums` | An artist's globally most-played albums |
| `get_similar_artists`   | Artists similar to a given artist       |
| `get_similar_tracks`    | Tracks similar to a given track         |
| `ping`                  | Test connectivity                       |
| `server_info`           | Server status and capabilities          |
| `lastfm_auth_status`    | Check authentication status             |

### Your listening data

| Tool                        | Description                          |
| --------------------------- | ------------------------------------ |
| `get_recent_tracks`         | Recent listening history (paginated) |
| `get_top_artists`           | Top artists by time period           |
| `get_top_albums`            | Top albums by time period            |
| `get_top_tracks`            | Top tracks by time period            |
| `get_loved_tracks`          | Loved/favorited tracks               |
| `get_user_info`             | Last.fm profile information          |
| `get_listening_stats`       | Listening statistics                 |
| `get_music_recommendations` | Personalized recommendations         |

### Your listening history over time

| Tool                      | Description                              |
| ------------------------- | ---------------------------------------- |
| `get_weekly_chart_list`   | Available historical time periods        |
| `get_weekly_artist_chart` | Artist charts for a specific time period |
| `get_weekly_track_chart`  | Track charts for a specific time period  |

Good for questions like "when did I start listening to Led Zeppelin?" or "what was I into last March?"

## Resources

The server exposes MCP resource URIs:

```
lastfm://user/{username}/recent          # Recent tracks
lastfm://user/{username}/top-artists     # Top artists
lastfm://user/{username}/top-albums      # Top albums
lastfm://user/{username}/loved           # Loved tracks
lastfm://user/{username}/profile         # User profile
lastfm://track/{artist}/{track}          # Track info
lastfm://artist/{artist}                 # Artist info
lastfm://album/{artist}/{album}          # Album info
lastfm://artist/{artist}/similar         # Similar artists
lastfm://track/{artist}/{track}/similar  # Similar tracks
```

## Prompts

| Prompt               | Description                               | Arguments                |
| -------------------- | ----------------------------------------- | ------------------------ |
| `listening_insights` | Analyze listening habits and patterns     | `username`, `period?`    |
| `music_discovery`    | Discover music based on listening history | `username`, `genre?`     |
| `track_analysis`     | Detailed analysis of a track              | `artist`, `track`        |
| `album_analysis`     | Detailed analysis of an album             | `artist`, `album`        |
| `artist_analysis`    | Detailed analysis of an artist            | `artist`                 |
| `listening_habits`   | Summarize listening habits                | `username`, `timeframe?` |

## Development

### Prerequisites

- Node.js 22 (see `.nvmrc`; CI runs 22)
- Cloudflare Workers account
- Last.fm API key ([create one here](https://www.last.fm/api/account/create))

### Local setup

```bash
git clone https://github.com/rianvdm/lastfm-mcp.git
cd lastfm-mcp
npm install
```

Create `.dev.vars` (or copy `.dev.vars.example`):

```
LASTFM_API_KEY=your_api_key
LASTFM_SHARED_SECRET=your_shared_secret
CONSENT_SECRET=any_random_string_of_32_or_more_characters
```

```bash
npm run dev
```

Test with the inspector:

```bash
npx @modelcontextprotocol/inspector http://localhost:8787/mcp
```

### Deployment

Set production secrets (or run `npm run setup:prod`, which creates the KV namespaces, prompts for the two Last.fm values and generates `CONSENT_SECRET`):

```bash
echo "your_api_key" | wrangler secret put LASTFM_API_KEY --env production
echo "your_shared_secret" | wrangler secret put LASTFM_SHARED_SECRET --env production
openssl rand -base64 32 | wrangler secret put CONSENT_SECRET --env production
```

`CONSENT_SECRET` signs the cookie that remembers which apps a browser approved. Rotating it shows the consent page again to everyone; if it's missing or shorter than 32 characters, approvals aren't remembered, but sign-ins still work.

**Upgrading a deployment from v2.6.0 or earlier:** v2.7.0 added the consent page and the `CONSENT_SECRET` secret. Set it with the `openssl` line above before you deploy, or right after. Until it's set, the consent page shows on every sign-in.

Deploy:

```bash
npm run deploy:prod
```

### Testing

```bash
npm test          # vitest, in workerd via @cloudflare/vitest-pool-workers
npm run lint
npm run build     # wrangler deploy --dry-run: catches type and binding errors
```

## Architecture

- Runtime: Cloudflare Workers
- Protocol: MCP (streamable HTTP)
- Auth: OAuth 2.0 (RFC 9728) via `@cloudflare/workers-oauth-provider`; the provider owns sessions and tokens
- Storage: Cloudflare KV for OAuth state, sessions, caching, and rate-limit counters
- Rate limiting: per-IP on `/mcp`, so one client can't exhaust the shared Last.fm API key's budget
- API: Last.fm Web API v2.0

### Endpoints

| Endpoint                                  | Purpose                                     |
| ----------------------------------------- | ------------------------------------------- |
| `/mcp`                                    | MCP JSON-RPC endpoint (rate-limited per IP) |
| `/authorize`                              | OAuth 2.0 authorization                     |
| `/oauth/token`                            | OAuth 2.0 token exchange                    |
| `/oauth/register`                         | OAuth 2.0 dynamic client registration       |
| `/.well-known/oauth-authorization-server` | OAuth server metadata                       |
| `/.well-known/oauth-protected-resource`   | OAuth resource metadata                     |
| `/.well-known/mcp.json`                   | MCP server card (name, version, transport)  |
| `/llms.txt`                               | Setup instructions for AI agents            |
| `/health`                                 | Health check                                |
| `/`                                       | Landing page                                |

## Contributing

1. Fork the repo
2. Create a feature branch
3. Commit your changes
4. Open a pull request

## License

MIT
