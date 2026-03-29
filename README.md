# Last.fm MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for Last.fm. Gives AI assistants access to your listening history, music discovery, and detailed track/artist/album information.

Runs on Cloudflare Workers. Authenticates via OAuth 2.0. Public tools (track info, artist info, similar artists) work without authentication -- sign in to access your personal listening data.

## Quick start

### Claude.ai

1. Go to **Settings** -> **Integrations** -> **Add Integration**
2. Enter the server URL: `https://lastfm-mcp.com/mcp`
3. Click **Connect**, sign in to Last.fm when prompted

### Claude Desktop

1. Open **Settings** -> **Connectors** -> **Add Custom Connector**
2. Enter `https://lastfm-mcp.com/mcp`
3. Authenticate with Last.fm when prompted

### Claude Code

```bash
claude mcp add --transport http lastfm "https://lastfm-mcp.com/mcp"
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "lastfm": {
      "serverUrl": "https://lastfm-mcp.com/mcp"
    }
  }
}
```

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

## Available tools

### Public (no auth required)

| Tool | Description |
| ---- | ----------- |
| `get_track_info` | Detailed information about a track |
| `get_artist_info` | Artist information and bio |
| `get_album_info` | Album details and track listing |
| `get_similar_artists` | Artists similar to a given artist |
| `get_similar_tracks` | Tracks similar to a given track |
| `ping` | Test connectivity |
| `server_info` | Server status and capabilities |
| `lastfm_auth_status` | Check authentication status |

### Personal (auth required)

| Tool | Description |
| ---- | ----------- |
| `get_recent_tracks` | Recent listening history (paginated) |
| `get_top_artists` | Top artists by time period |
| `get_top_albums` | Top albums by time period |
| `get_loved_tracks` | Loved/favorited tracks |
| `get_user_info` | Last.fm profile information |
| `get_listening_stats` | Listening statistics |
| `get_music_recommendations` | Personalized recommendations |

### Temporal queries (auth required)

| Tool | Description |
| ---- | ----------- |
| `get_weekly_chart_list` | Available historical time periods |
| `get_weekly_artist_chart` | Artist charts for a specific time period |
| `get_weekly_track_chart` | Track charts for a specific time period |

These are useful for questions like "when did I start listening to Led Zeppelin?" or "what was I into last March?"

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

| Prompt | Description | Arguments |
| ------ | ----------- | --------- |
| `listening_insights` | Analyze listening habits and patterns | `username`, `period?` |
| `music_discovery` | Discover music based on listening history | `username`, `genre?` |
| `track_analysis` | Detailed analysis of a track | `artist`, `track` |
| `album_analysis` | Detailed analysis of an album | `artist`, `album` |
| `artist_analysis` | Detailed analysis of an artist | `artist` |
| `listening_habits` | Summarize listening habits | `username`, `timeframe?` |

## Authentication

The server uses OAuth 2.0. When you connect from a supported client:

1. The client gets a 401 with OAuth metadata
2. Your browser opens to Last.fm for authorization
3. Tokens are stored and persist across sessions

Public tools work without signing in.

## Development

### Prerequisites

- Node.js 18+
- Cloudflare Workers account
- Last.fm API key ([create one here](https://www.last.fm/api/account/create))

### Local setup

```bash
git clone https://github.com/rianvdm/lastfm-mcp.git
cd lastfm-mcp
npm install
```

Create `.dev.vars`:

```
LASTFM_API_KEY=your_api_key
LASTFM_SHARED_SECRET=your_shared_secret
JWT_SECRET=your_jwt_secret
```

```bash
npm run dev
```

Test with the inspector:

```bash
npx @modelcontextprotocol/inspector http://localhost:8787/mcp
```

### Deployment

Set production secrets:

```bash
echo "your_api_key" | wrangler secret put LASTFM_API_KEY --env production
echo "your_shared_secret" | wrangler secret put LASTFM_SHARED_SECRET --env production
echo "your_jwt_secret" | wrangler secret put JWT_SECRET --env production
```

Deploy:

```bash
npm run deploy:prod
```

### Testing

```bash
npm test
npm run typecheck
npm run lint
```

## Architecture

- Runtime: Cloudflare Workers
- Protocol: MCP (streamable HTTP)
- Auth: OAuth 2.0 (RFC 9728)
- Storage: Cloudflare KV for sessions, tokens, and caching
- API: Last.fm Web API v2.0

### Endpoints

| Endpoint | Purpose |
| -------- | ------- |
| `/mcp` | MCP JSON-RPC endpoint |
| `/authorize` | OAuth 2.0 authorization |
| `/.well-known/oauth-authorization-server` | OAuth server metadata |
| `/.well-known/oauth-protected-resource` | OAuth resource metadata |

## Contributing

1. Fork the repo
2. Create a feature branch
3. Commit your changes
4. Open a pull request

## License

MIT
