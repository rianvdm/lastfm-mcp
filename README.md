# 🎵 Last.fm MCP Server

A **Model Context Protocol (MCP) server** that provides seamless access to Last.fm listening data and music information via AI assistants like Claude. Features **native Claude Desktop integration** with OAuth 2.0 authentication.

## ✨ Features

- 🎧 **Personal Listening Data**: Recent tracks, top artists, albums, loved tracks
- 🎵 **Music Information**: Detailed track, artist, and album information
- 🔍 **Music Discovery**: Similar artists/tracks, personalized recommendations
- 📊 **Listening Statistics**: Comprehensive stats and listening habits analysis
- 🔐 **OAuth 2.0 Authentication**: Custom OAuth implementation with Dynamic Client Registration
- 🌉 **Last.fm Bridge**: Seamless integration between OAuth and Last.fm Web Authentication
- ⚡ **Smart Caching**: Intelligent caching with optimized TTLs for performance
- 🛡️ **Rate Limiting**: Built-in rate limiting respecting Last.fm API limits
- 🌐 **Production Ready**: Deployed on Cloudflare Workers with global edge and CI/CD

## 🚀 Quick Start

### Native Claude Desktop Integration (Recommended)

Add this URL to your Claude Desktop MCP servers:

```
https://lastfm-mcp-prod.rian-db8.workers.dev
```

**Important**: Use the **root URL** (without `/sse`), as Claude Desktop expects OAuth-authenticated MCP servers at the root endpoint.

### MCP Inspector Testing

For development and testing with MCP Inspector:

```json
{
  "url": "https://lastfm-mcp-prod.rian-db8.workers.dev",
  "transport": "http"
}
```

### Legacy mcp-remote Support (Deprecated)

> ⚠️ **Note**: The mcp-remote compatibility has been removed in favor of native OAuth integration. Use Claude Desktop's built-in MCP support instead.

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

### 🔑 OAuth Authentication Flow

1. **Add Server**: Add the server URL to Claude Desktop
2. **Connect**: Claude will prompt you to connect with OAuth
3. **Authenticate**: You'll be redirected to Last.fm to sign in
4. **Authorize**: Grant access to your Last.fm listening data
5. **Return**: You'll be redirected back and automatically authenticated
6. **Access**: All personal tools and resources are now available!

> **🎯 Current Status**: OAuth flow works perfectly with tools. Resources may require additional authentication context (known limitation).

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

## 🔐 OAuth 2.0 Architecture

This server implements a **custom OAuth 2.0 provider** with Dynamic Client Registration, designed specifically for Claude Desktop's native MCP OAuth support:

### OAuth Endpoints

- **POST** `/oauth/register` - Dynamic Client Registration (RFC 7591)
- **GET** `/oauth/authorize` - Authorization endpoint with Last.fm bridge
- **POST** `/oauth/token` - Token exchange (authorization_code grant)
- **POST** `/` - OAuth-protected MCP JSON-RPC endpoint

### Authentication Flow

1. **Auto-Registration**: Claude Desktop clients are automatically registered
2. **Authorization**: Users redirected to Last.fm for authentication via OAuth bridge
3. **Last.fm Callback**: Last.fm Web Auth session key obtained
4. **Token Exchange**: Authorization code exchanged for Bearer token
5. **MCP Access**: Bearer token provides access to all MCP tools and most resources

### Implementation Learnings

#### ✅ **What Works:**
- **OAuth Flow**: Complete RFC-compliant implementation with Claude Desktop
- **Auto-Registration**: Claude Desktop and MCP Inspector clients auto-register
- **Last.fm Bridge**: Seamless integration between OAuth and Last.fm Web Auth
- **Tools Access**: All MCP tools work perfectly with Bearer token authentication
- **JWT-Free**: Pure OAuth implementation without JWT dependencies

#### ⚠️ **Known Limitations:**
- **Resources Authentication**: MCP resources may not receive proper authentication context
- **Architecture Complexity**: OAuth → Last.fm → Bearer Token → MCP chain introduces complexity
- **Error Handling**: Some authentication context errors persist in edge cases

#### 🎯 **Key Technical Insights:**
- Claude Desktop expects OAuth servers at **root endpoint** (`/`), not `/sse`
- **Public OAuth clients** (no client_secret) work fine for MCP use cases
- **Dynamic Client Registration** essential for seamless Claude Desktop integration
- **Bearer token** authentication preferred over cookie-based sessions
- **Authentication bridging** between OAuth and existing Last.fm sessions is complex but functional

### Security Features

- ✅ **RFC 7591 Compliant**: Dynamic Client Registration
- ✅ **Bearer Token Authentication**: Secure API access
- ✅ **Last.fm Session Bridge**: Secure mapping between OAuth and Last.fm sessions
- ✅ **Token Expiration**: 1-hour access token lifetime
- ✅ **Secure Storage**: Session data in Cloudflare KV
- ✅ **Public Client Support**: No client secrets required for MCP clients

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
   ```

   > **Note**: `JWT_SECRET` is no longer required for the OAuth-only implementation.

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
   ```

   > **Note**: `JWT_SECRET` is no longer required for the OAuth-only implementation.

2. **Deploy**:

   ```bash
   wrangler deploy --env production
   ```

3. **Test production**:
   ```bash
   curl https://your-worker.workers.dev
   ```

## 📋 Example Usage

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

**Get recent tracks with OAuth authentication:**

```bash
curl -X POST https://lastfm-mcp-prod.rian-db8.workers.dev \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_oauth_token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_recent_tracks",
      "arguments": {
        "username": "your_username",
        "limit": 50,
        "page": 1
      }
    }
  }'
```

## 🏗️ Architecture

- **🌐 Runtime**: Cloudflare Workers (global edge deployment)
- **📡 Protocol**: Model Context Protocol (MCP) 2024-11-05
- **🔐 Authentication**: OAuth 2.0 + Last.fm Web Auth bridge (JWT-free)
- **💾 Storage**: Cloudflare KV (OAuth tokens, sessions, caching, rate limiting)
- **🎵 API**: Last.fm Web API v2.0
- **⚡ Performance**: Smart caching, rate limiting, retry logic
- **🏗️ Implementation**: Clean OAuth-only architecture in `src/index-oauth-clean.ts`

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
