# Last.fm MCP Server

A Cloudflare Workers-based service that allows authenticated users to interact with their Last.fm listening history and music data via natural language commands using the MCP (Model Context Protocol).

## Overview

This server processes MCP JSON-RPC requests and returns structured responses with Last.fm listening data. It provides access to your music history, statistics, and discovery features through AI assistants like Claude. The server features intelligent music analysis that provides insights into your listening patterns and helps discover new music based on your preferences.

## Quick Start

### Adding to Claude Desktop

1. Open Claude Desktop settings and find the MCP configuration (Settings / Developer / Edit Config)
2. Add this server configuration:

```json
{
	"mcpServers": {
		"lastfm": {
			"command": "npx",
			"args": ["mcp-remote", "https://lastfm-mcp-prod.your-domain.workers.dev/sse"]
		}
	}
}
```

3. Restart Claude Desktop
4. Ask something like "What can you tell me about my Last.fm listening history?"
5. Visit the provided login URL to connect your Last.fm account
6. Come back and enjoy! See below for things you can ask about

### Adding to Other MCP Clients

For other MCP-compatible clients, like the [Cloudflare Workers LLM Playground](https://playground.ai.cloudflare.com/), use the server endpoint:

```
https://lastfm-mcp-prod.your-domain.workers.dev/sse
```

## Key Features

- **Last.fm Web Authentication**: Secure login via Last.fm's authentication flow
- **Listening History Access**: Complete access to your Last.fm scrobbling data:
  - Recent tracks with timestamps and metadata
  - Top artists and albums by time period (7 days to overall)
  - Loved tracks and personal statistics
- **Music Discovery**: Intelligent recommendations based on your listening patterns:
  - Similar artists and tracks with relevance scores
  - Genre-based recommendations from your history
  - Contextual suggestions for different moods and activities
- **Comprehensive Music Data**: Get detailed information about:
  - Track metadata, play counts, and tags
  - Artist biographies, similar artists, and top tracks
  - Album information with track listings and statistics
- **Listening Analytics**: Analyze your music habits with:
  - Listening statistics by time period
  - Genre distribution and trends
  - Artist and album play count analysis
  - Temporal listening patterns
- **User Profile Integration**: Access to your Last.fm profile data:
  - Registration date and total scrobbles
  - User demographics (if public)
  - Social features and compatibility scores
- **Smart Caching**: Intelligent caching system optimized for Last.fm API rate limits
- **MCP Protocol Compliance**: Full JSON-RPC 2.0 implementation with proper error handling
- **Real-time Data**: Live access to Last.fm API without local storage requirements
- **Rate Limiting**: Respect Last.fm API limits with intelligent request throttling

## Available Tools

- **`get_recent_tracks`** - Get your recently played tracks with timestamps and metadata
  - Supports time filtering (from/to dates)
  - Configurable limit (1-200 tracks)
  - Real-time scrobbling data
- **`get_top_artists`** - Get your most played artists by time period
  - Time periods: 7day, 1month, 3month, 6month, 12month, overall
  - Play count statistics and rankings
  - Artist metadata and tags
- **`get_top_albums`** - Get your most played albums with statistics
- **`get_loved_tracks`** - Access your loved/favorite tracks
- **`get_track_info`** - Detailed information about specific tracks
  - Play counts, tags, similar tracks
  - Personal statistics (if username provided)
- **`get_artist_info`** - Artist biographies, similar artists, and statistics
- **`get_album_info`** - Album details with track listings and metadata
- **`get_user_info`** - User profile information and statistics
- **`get_similar_artists`** - Find artists similar to your favorites
- **`get_similar_tracks`** - Discover tracks similar to ones you love
- **`get_listening_stats`** - Comprehensive listening analytics
- **`get_music_recommendations`** - Personalized recommendations based on your history

## Architecture

Built on Cloudflare Workers with:

- Workers KV for request logging and rate limiting
- Last.fm API for listening data and music metadata
- MCP (Model Context Protocol) for AI assistant integration
- Intelligent caching system for performance optimization
- Last.fm web authentication flow with session management
- Automated CI/CD deployment to production

## Development

This project uses Wrangler for Cloudflare Workers development.

### Local Development

```bash
npm install
npm run dev
```

### Claude Desktop Configuration

For local development, use the configuration in `config/claude-desktop-config.json`:

```json
{
	"mcpServers": {
		"lastfm-local": {
			"command": "npx",
			"args": ["mcp-remote", "http://localhost:8787/sse"]
		}
	}
}
```

For production, use the configuration in `config/claude-desktop-config-production.json`:

```json
{
	"mcpServers": {
		"lastfm": {
			"command": "npx",
			"args": ["mcp-remote", "https://your-worker-domain.workers.dev/sse"]
		}
	}
}
```

### Setup

```bash
npm install
npm run dev    # Start local development server
npm test       # Run tests
npm run build  # Build for production
```

## Deployment

### Development Deployment

```bash
npm run deploy  # Deploy to development environment
```

### Production Deployment

1. **First-time setup**: Create production KV namespaces and set secrets:

   ```bash
   npm run setup:prod
   ```

2. **Deploy to production**:
   ```bash
   npm run deploy:prod
   ```

### Automated Deployment

The project includes GitHub Actions for automated deployment:

- **CI Pipeline**: Runs on all pushes and PRs (lint, test, build)
- **Production Deployment**: Automatically deploys to production when code is pushed to `main` branch

### Required Secrets

For production deployment, set these secrets in your Cloudflare account and GitHub repository:

**Cloudflare Secrets** (set via `wrangler secret put`):

- `LASTFM_API_KEY` - Your Last.fm API key
- `LASTFM_SHARED_SECRET` - Your Last.fm shared secret
- `JWT_SECRET` - Strong random string for JWT signing

**GitHub Secrets** (for automated deployment):

- `CLOUDFLARE_API_TOKEN` - Cloudflare API token with Workers:Edit permissions
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID

### Environment Configuration

The project supports multiple environments via `wrangler.toml`:

- **Development** (default): Uses development KV namespaces
- **Production** (`--env production`): Uses separate production KV namespaces

Each environment has isolated KV storage for logs, rate limiting, and sessions.

## Example Queries

### Listening History Analysis

- "What have I been listening to lately?"
- "Show me my most played artists this month"
- "What are my top albums from last year?"
- "Which tracks have I loved recently?"
- "What's my listening history for the past week?"

### Music Discovery

- "Find artists similar to Radiohead"
- "What tracks are similar to 'Bohemian Rhapsody'?"
- "Recommend music based on my listening history"
- "Show me artists I might like based on my top genres"
- "Find new music similar to my loved tracks"

### Statistics and Analytics

- "What are my listening statistics?"
- "How many songs have I scrobbled total?"
- "What genres do I listen to most?"
- "Show me my music taste evolution over time"
- "What are my listening patterns by day/time?"

### Artist and Track Information

- "Tell me about Pink Floyd"
- "What's the story behind 'Stairway to Heaven'?"
- "Show me information about the album 'OK Computer'"
- "What are the top tracks by The Beatles?"
- "Give me details about my favorite artist"

### Contextual Music Suggestions

- "What should I listen to for working out?"
- "Recommend music for studying"
- "Find something relaxing for bedtime"
- "What's good for a road trip playlist?"
- "Suggest music for a dinner party"

### Personal Music Insights

The system provides **intelligent music analysis** that:

- **Analyzes your listening patterns**: Identifies your most active listening times, favorite genres, and music discovery trends
- **Provides personalized recommendations**: Uses your scrobbling history to suggest new artists and tracks
- **Tracks your musical journey**: Shows how your taste has evolved over time
- **Contextual understanding**: Learns from your listening habits to provide situational music suggestions
- **Social insights**: Compares your taste with similar users and provides compatibility scores

Whether you're exploring your musical identity, discovering new artists, or analyzing your listening habits, the system provides deep insights into your Last.fm data.

## Getting Started with Last.fm

### Setting up Last.fm API Access

1. **Create a Last.fm account** at [last.fm](https://www.last.fm) if you don't have one
2. **Get API credentials**:
   - Visit [Last.fm API Account](https://www.last.fm/api/account/create)
   - Fill out the application form
   - Note your API Key and Shared Secret
3. **Start scrobbling**: Use a Last.fm scrobbler to track your listening:
   - Spotify: Enable scrobbling in Settings > Social > Last.fm
   - iTunes/Music: Use official Last.fm Desktop Scrobbler
   - Other players: Check Last.fm's supported applications

### Authentication Flow

The server uses Last.fm's web authentication:

1. Click the login link provided by the MCP server
2. Authorize the application on Last.fm
3. You'll be redirected back with access to your data
4. Your session remains active for future requests

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
