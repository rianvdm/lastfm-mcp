# 🎵 Last.fm MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Last.fm](https://img.shields.io/badge/Last.fm-API-D51007?logo=last.fm&logoColor=white)](https://www.last.fm/api)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-blue)](https://github.com/modelcontextprotocol)
[![CI](https://github.com/rianvdm/lastfm-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/rianvdm/lastfm-mcp/actions/workflows/ci.yml)

A **Model Context Protocol (MCP) server** that provides seamless access to Last.fm listening data and music information via AI assistants like Claude.

A powerful, production-ready server that bridges AI assistants with Last.fm's comprehensive music database.

## ✨ Features

- 🎧 **Personal Listening Data**: Recent tracks, top artists, albums, loved tracks
- 🎵 **Music Information**: Detailed track, artist, and album information
- 🔍 **Music Discovery**: Similar artists/tracks, personalized recommendations
- 📊 **Listening Statistics**: Comprehensive stats and listening habits analysis
- 🔐 **Secure Authentication**: Last.fm Web Authentication with JWT sessions
- ⚡ **Smart Caching**: Intelligent caching with optimized TTLs for performance
- 🛡️ **Rate Limiting**: Built-in rate limiting respecting Last.fm API limits
- 🌐 **Production Ready**: Deployed on Cloudflare Workers with global edge and CI/CD

## 🚀 Quick Start

### Using with Claude Desktop

Add this configuration to your Claude Desktop settings (Settings / Developer / Edit config):

```json
{
	"mcpServers": {
		"lastfm": {
			"command": "npx",
			"args": ["mcp-remote", "https://lastfm-mcp-prod.rian-db8.workers.dev/sse"]
		}
	}
}
```

> **💡 Tip**: This uses the hosted server via `mcp-remote`, which works reliably across all platforms and doesn't require local Node.js setup.

#### 🐛 Platform-Specific Troubleshooting

<details>
<summary>If you get "spawn npx NOENT" error</summary>

**For NixOS users:**

```json
{
	"mcpServers": {
		"lastfm": {
			"command": "/run/current-system/sw/bin/npx",
			"args": ["mcp-remote", "https://lastfm-mcp-prod.rian-db8.workers.dev/sse"],
			"env": {
				"PATH": "/run/current-system/sw/bin:$PATH"
			}
		}
	}
}
```

**For other systems:**

1. Find your npx path: `which npx`
2. Use the full path in your config:

```json
{
	"command": "/usr/local/bin/npx", // Use your actual path
	"args": ["mcp-remote", "https://lastfm-mcp-prod.rian-db8.workers.dev/sse"]
}
```

</details>

### 🔑 Authentication Flow

1. Try any authenticated tool (like "Get my recent tracks")
2. Claude will provide a Last.fm authentication URL
3. Sign in with your Last.fm account and authorize the app
4. Return to Claude - you're now authenticated!
5. Enjoy access to your personal Last.fm data

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

4. **Test locally**:
   ```bash
   curl -X POST http://localhost:8787 \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_track_info","arguments":{"artist":"The Beatles","track":"Yesterday"}}}'
   ```

### 🚀 Deployment

1. **Set production secrets**:

   ```bash
   echo "your_api_key" | wrangler secret put LASTFM_API_KEY --env production
   echo "your_shared_secret" | wrangler secret put LASTFM_SHARED_SECRET --env production
   echo "your_jwt_secret" | wrangler secret put JWT_SECRET --env production
   ```

2. **Deploy**:

   ```bash
   wrangler deploy --env production
   ```

3. **Test production**:
   ```bash
   curl https://your-worker.workers.dev
   ```

## 📋 Example Usage

### 🎵 Public Music Data (No Authentication)

**Get track information:**

```bash
curl -X POST https://lastfm-mcp-prod.rian-db8.workers.dev \
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
curl -X POST https://lastfm-mcp-prod.rian-db8.workers.dev \
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

**Get recent tracks with pagination:**

```bash
curl -X POST https://lastfm-mcp-prod.rian-db8.workers.dev \
  -H "Content-Type: application/json" \
  -H "Cookie: session=your_session_token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_recent_tracks",
      "arguments": {
        "username": "your_username",
        "limit": 500,
        "page": 2
      }
    }
  }'
```

### 🕰️ Temporal Queries

**Get available historical periods:**

```bash
curl -X POST https://lastfm-mcp-prod.rian-db8.workers.dev \
  -H "Content-Type: application/json" \
  -H "Cookie: session=your_session_token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_weekly_chart_list",
      "arguments": {
        "username": "your_username"
      }
    }
  }'
```

**Discover what you were listening to in a specific time period:**

```bash
curl -X POST https://lastfm-mcp-prod.rian-db8.workers.dev \
  -H "Content-Type: application/json" \
  -H "Cookie: session=your_session_token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_weekly_artist_chart",
      "arguments": {
        "username": "your_username",
        "from": 1577836800,
        "to": 1578441600
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
- **📡 Protocol**: Model Context Protocol (MCP) 2024-11-05
- **🔐 Authentication**: Last.fm Web Auth + JWT sessions
- **💾 Storage**: Cloudflare KV (sessions, caching, rate limiting)
- **🎵 API**: Last.fm Web API v2.0
- **⚡ Performance**: Smart caching, rate limiting, retry logic

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
