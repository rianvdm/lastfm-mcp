# 🎵 Last.fm MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Last.fm](https://img.shields.io/badge/Last.fm-API-D51007?logo=last.fm&logoColor=white)](https://www.last.fm/api)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-blue)](https://github.com/modelcontextprotocol)
[![CI](https://github.com/rianvdm/lastfm-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/rianvdm/lastfm-mcp/actions/workflows/ci.yml)

A **Model Context Protocol (MCP) server** that provides seamless access to Last.fm listening data and music information via AI assistants like Claude.

## ✨ Features

- 🎧 **Personal Listening Data**: Recent tracks, top artists, albums, loved tracks
- 🎵 **Music Information**: Detailed track, artist, and album information
- 🔍 **Music Discovery**: Similar artists/tracks, personalized recommendations
- 📊 **Listening Statistics**: Comprehensive stats and listening habits analysis
- 🔐 **OAuth 2.0 Authentication**: Industry-standard auth with session persistence
- ⚡ **Smart Caching**: Intelligent caching with optimized TTLs for performance
- 🛡️ **Rate Limiting**: Built-in rate limiting respecting Last.fm API limits
- 🌐 **Production Ready**: Deployed on Cloudflare Workers with global edge

## 🚀 Quick Start

### Windsurf (OAuth - Recommended)

Windsurf supports OAuth 2.0, providing the smoothest authentication experience:

1. Add to your Windsurf MCP config (`~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "lastfm": {
      "serverUrl": "https://lastfm-mcp-prod.rian-db8.workers.dev/mcp"
    }
  }
}
```

2. Restart Windsurf
3. When you first use a Last.fm tool, you'll be prompted to authenticate
4. Your browser will open to Last.fm - sign in and authorize
5. Done! Your session persists across conversations.

### Claude Desktop (Manual Login)

Claude Desktop doesn't yet support OAuth for MCP servers. Use the manual login flow:

**Step 1: Authenticate with Last.fm**

Visit this URL in your browser:
```
https://lastfm-mcp-prod.rian-db8.workers.dev/login
```

After authenticating, you'll receive a **session ID**.

**Step 2: Configure Claude Desktop**

Add the connector with your session ID:

1. Open Claude Desktop → **Settings** → **Connectors**
2. Click **Add Connector**
3. Enter the URL with your session ID:
   ```
   https://lastfm-mcp-prod.rian-db8.workers.dev/mcp?session_id=YOUR_SESSION_ID
   ```
4. Click **Add**

Your session is valid for 30 days.

**Alternative: Config File Method**

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lastfm": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://lastfm-mcp-prod.rian-db8.workers.dev/mcp?session_id=YOUR_SESSION_ID"]
    }
  }
}
```

### Claude Code

Claude Code supports HTTP transport but requires manual authentication (same as Claude Desktop):

**Step 1:** Get a session ID by visiting:
```
https://lastfm-mcp-prod.rian-db8.workers.dev/login
```

**Step 2:** Add the server with your session ID:
```bash
claude mcp add --transport http lastfm "https://lastfm-mcp-prod.rian-db8.workers.dev/mcp?session_id=YOUR_SESSION_ID"
```

**Step 3:** Verify it's connected:
```bash
claude mcp list
```

### MCP Inspector (Testing)

```bash
npx @modelcontextprotocol/inspector https://lastfm-mcp-prod.rian-db8.workers.dev/mcp
```

### Other MCP Clients

**Continue.dev (VS Code/JetBrains):**

```json
{
  "mcpServers": {
    "lastfm": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://lastfm-mcp-prod.rian-db8.workers.dev/mcp"]
    }
  }
}
```

**Zed Editor:**

```json
{
  "context_servers": {
    "lastfm": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://lastfm-mcp-prod.rian-db8.workers.dev/mcp"]
    }
  }
}
```

## 🔐 Authentication

This server supports two authentication methods:

| Method | Best For | How It Works |
|--------|----------|--------------|
| **OAuth 2.0** | Windsurf, OAuth-compliant clients | Automatic browser-based auth flow |
| **Session ID** | Claude Desktop, Claude Code | Manual login, add `?session_id=` to URL |

### OAuth 2.0 (Automatic)

For clients that support OAuth (like Windsurf):
1. Connect to the server
2. Client detects 401 response with OAuth metadata
3. Browser opens for Last.fm authentication
4. Token is stored client-side, persists across sessions

### Session ID (Manual)

For Claude Desktop and clients without OAuth support:
1. Visit `/login` in your browser
2. Authenticate with Last.fm  
3. Copy the session ID from the success page
4. Add `?session_id=YOUR_ID` to your MCP server URL
5. Session valid for 30 days

## 🛠️ Available Tools

### 🔓 **Public Tools** (No Authentication Required)

| Tool                  | Description                              |
| --------------------- | ---------------------------------------- |
| `get_track_info`      | Get detailed information about any track |
| `get_artist_info`     | Get detailed artist information and bio  |
| `get_album_info`      | Get album details and track listings     |
| `get_similar_artists` | Find artists similar to a given artist   |
| `get_similar_tracks`  | Find tracks similar to a given track     |
| `ping`                | Test server connectivity                 |
| `server_info`         | Get server status and capabilities       |
| `auth_status`         | Check your authentication status         |

### 🔐 **Personal Tools** (Authentication Required)

| Tool                        | Description                                         |
| --------------------------- | --------------------------------------------------- |
| `get_recent_tracks`         | Your recent listening history (supports pagination) |
| `get_top_artists`           | Your top artists by time period                     |
| `get_top_albums`            | Your top albums by time period                      |
| `get_loved_tracks`          | Your loved/favorite tracks                          |
| `get_user_info`             | Your Last.fm profile information                    |
| `get_listening_stats`       | Comprehensive listening statistics                  |
| `get_music_recommendations` | Personalized music recommendations                  |

### 🕰️ **Temporal Query Tools** (Authentication Required)

| Tool                      | Description                                                 |
| ------------------------- | ----------------------------------------------------------- |
| `get_weekly_chart_list`   | Get available historical time periods for temporal analysis |
| `get_weekly_artist_chart` | Get artist listening data for specific time periods         |
| `get_weekly_track_chart`  | Get track listening data for specific time periods          |

**Perfect for questions like:**

- "When did I start listening to Led Zeppelin?"
- "What was I listening to in March 2023?"
- "How has my music taste evolved over time?"

## 📚 MCP Resources

Access Last.fm data via standardized MCP resource URIs:

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

## 🤖 MCP Prompts

Rich AI prompts for music analysis and discovery:

| Prompt               | Description                                   | Arguments                |
| -------------------- | --------------------------------------------- | ------------------------ |
| `listening_insights` | Analyze user's listening habits and patterns  | `username`, `period?`    |
| `music_discovery`    | Discover new music based on listening history | `username`, `genre?`     |
| `track_analysis`     | Get detailed analysis of a specific track     | `artist`, `track`        |
| `album_analysis`     | Get detailed analysis of a specific album     | `artist`, `album`        |
| `artist_analysis`    | Get detailed analysis of a specific artist    | `artist`                 |
| `listening_habits`   | Analyze and summarize user's listening habits | `username`, `timeframe?` |

These prompts generate contextual messages that guide AI assistants to provide meaningful music insights using the available Last.fm tools and data.

## 🏗️ Development

### Prerequisites

- Node.js 18+
- Cloudflare Workers account
- Last.fm API credentials ([Get them here](https://www.last.fm/api/account/create))

### Local Setup

1. **Clone and install**:

   ```bash
   git clone https://github.com/rianvdm/lastfm-mcp.git
   cd lastfm-mcp
   npm install
   ```

2. **Configure environment** (`.dev.vars`):

   ```env
   LASTFM_API_KEY=your_api_key_here
   LASTFM_SHARED_SECRET=your_shared_secret_here
   JWT_SECRET=your_secure_jwt_secret
   ```

3. **Start development server**:

   ```bash
   npm run dev
   ```

4. **Test with MCP Inspector**:

   ```bash
   npx @modelcontextprotocol/inspector http://localhost:8787/mcp
   ```

5. **Test authentication locally**:
   - Visit `http://localhost:8787/login` to authenticate
   - Use the session ID in your local testing

### 🚀 Deployment

1. **Set production secrets**:

   ```bash
   echo "your_api_key" | wrangler secret put LASTFM_API_KEY --env production
   echo "your_shared_secret" | wrangler secret put LASTFM_SHARED_SECRET --env production
   echo "your_jwt_secret" | wrangler secret put JWT_SECRET --env production
   ```

2. **Deploy**:

   ```bash
   npm run deploy:prod
   ```

3. **Verify deployment**:
   ```bash
   curl https://lastfm-mcp-prod.rian-db8.workers.dev/
   ```

## 📋 Example Usage

### 🎵 Public Music Data (No Authentication)

**Get track information:**

```bash
curl -X POST https://lastfm-mcp-prod.rian-db8.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_track_info",
      "arguments": {
        "artist": "Radiohead",
        "track": "Paranoid Android"
      }
    }
  }'
```

**Find similar artists:**

```bash
curl -X POST https://lastfm-mcp-prod.rian-db8.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_similar_artists",
      "arguments": {
        "artist": "Pink Floyd",
        "limit": 10
      }
    }
  }'
```

### 🔐 Personal Data (Requires Authentication)

For authenticated requests, use the session_id parameter:

```bash
curl -X POST "https://lastfm-mcp-prod.rian-db8.workers.dev/mcp?session_id=YOUR_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_recent_tracks",
      "arguments": {
        "limit": 10
      }
    }
  }'
```

### 🤖 AI Assistant Examples

With Claude or other AI assistants, you can now ask natural language questions like:

- *"When did I start listening to Led Zeppelin?"*
- *"What was I obsessed with in summer 2023?"*
- *"Show me how my music taste has evolved over the years"*
- *"Find artists similar to my current favorites"*
- *"What tracks should I check out based on my listening history?"*

## 🏗️ Architecture

- **🌐 Runtime**: Cloudflare Workers (global edge deployment)
- **📡 Protocol**: Model Context Protocol (MCP) 2024-11-05 / 2025-06-18
- **🔐 Authentication**: OAuth 2.0 (RFC 9728) + Session ID fallback
- **💾 Storage**: Cloudflare KV (sessions, OAuth tokens, caching)
- **🎵 API**: Last.fm Web API v2.0
- **⚡ Performance**: Smart caching, rate limiting, retry logic

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/mcp` | MCP JSON-RPC endpoint |
| `/login` | Manual authentication for Claude Desktop |
| `/authorize` | OAuth 2.0 authorization |
| `/.well-known/oauth-authorization-server` | OAuth server metadata |
| `/.well-known/oauth-protected-resource` | OAuth resource metadata |

## 🧪 Testing

```bash
# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint

# Build check
npm run build
```

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Last.fm](https://last.fm) for the comprehensive music API
- [Model Context Protocol](https://github.com/modelcontextprotocol) for the MCP specification
- [Cloudflare Workers](https://workers.cloudflare.com) for the serverless runtime

---

**🎵 Built with ❤️ for music lovers and AI enthusiasts**
