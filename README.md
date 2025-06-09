# Discogs MCP Server

A Cloudflare Workers-based service that allows authenticated users to interact with their personal Discogs music collection via natural language commands using the MCP (Model Context Protocol).

## Overview

This server processes plain-text queries and returns rich, markdown-formatted responses suitable for display in natural language clients like ChatGPT or Claude. It features intelligent mood mapping that translates emotional descriptors like "mellow," "energetic," or "Sunday evening vibes" into relevant Discogs genres and styles.

## Quick Start

### Adding to Claude Desktop

1. Open Claude Desktop settings and find the MCP configuration (Settings / Developer / Edit Config)
2. Add this server configuration:

```json
{
	"mcpServers": {
		"discogs": {
			"command": "npx",
			"args": ["mcp-remote", "https://discogs-mcp-prod.rian-db8.workers.dev/sse"]
		}
	}
}
```

3. Restart Claude Desktop
4. Ask something like "What can you tell me about my Discogs collection?"
5. Visit the provided login URL to connect your Discogs account
6. Come back and enjoy! See below for things you can ask about

### Adding to Other MCP Clients

For other MCP-compatible clients, use the server endpoint:

```
https://discogs-mcp-prod.rian-db8.workers.dev/sse
```

## Key Features

- **OAuth Authentication**: Secure login via Discogs OAuth
- **Advanced Search Intelligence**: Enhanced search algorithms with multiple matching strategies:
  - **OR Logic for Genre Searches**: Queries like "psychedelic rock prog rock space rock" find releases matching ANY of the terms, not requiring all terms to match
  - **Relevance Scoring**: Multi-word searches prioritize results by number of matching terms - albums matching more terms rank higher
  - **Smart Context Detection**: Automatically detects whether you're searching for specific albums vs. mood-based recommendations
- **Intelligent Mood Mapping**: Translate emotional descriptors and contextual cues into music recommendations:
  - Mood descriptors: "mellow," "energetic," "melancholy," "romantic," "dark"
  - Contextual awareness: "Sunday evening," "studying," "workout," "rainy day"
  - Time and seasonal contexts: "morning," "midnight," "winter," "summer"
  - **Enhanced Album Recognition**: Distinguishes between specific searches like "Dark Side of the Moon" vs. mood queries like "dark ambient music"
- **Collection Search**: Search through your Discogs collection by artist, album, genre, year, or mood
- **Release Details**: Get detailed information about specific releases including tracklists, formats, and metadata
- **Collection Statistics**: Analyze your collection with breakdowns by genre, decade, format, and more
- **Context-Aware Recommendations**: Get intelligent recommendations from your own collection based on:
  - **Multi-Genre Support**: Combine multiple genres like "psychedelic rock prog rock space rock" using flexible separator detection
  - Mood and emotional context (e.g., "mellow Sunday evening vibes")
  - Time periods (e.g., "1960s", "1970s", "1980s")
  - Similar artists or albums (e.g., "similar to Miles Davis")
  - Natural language queries (e.g., "hard bop albums from the 60s that I own")
- **Smart Caching**: Intelligent KV-based caching system for improved performance and rate limit optimization
- **Natural Language Interface**: Process commands via MCP protocol
- **Rich Responses**: Structured output optimized for AI assistants
- **Rate Limiting**: Per-user request throttling via Workers KV

## Available Tools

- **`search_collection`** - Enhanced search with intelligent matching and relevance scoring
  - **Smart genre detection**: Use OR logic for genre searches like "psychedelic rock prog rock"
  - **Relevance ranking**: Multi-word searches prioritize releases with more matching terms
  - **Mood and contextual awareness**: Supports mood descriptors and contextual cues
  - **Flexible input**: Accepts genres separated by spaces, commas, or other separators
  - Examples: "mellow", "energetic", "Sunday evening", "ambient drone progressive"
- **`get_release`** - Get detailed information about a specific release
- **`get_collection_stats`** - View statistics about your collection
- **`get_recommendations`** - Enhanced context-aware recommendations with multi-genre support
  - **Multi-genre filtering**: Combine genres like "psychedelic rock prog rock space rock"
  - **Similarity matching**: Find releases similar to specific artists/albums
  - **Advanced scoring**: Combines genre matching, style matching, era matching, and personal ratings
  - **Intelligent filtering**: OR logic for genre/mood queries, smart context detection
  - Examples: "mellow jazz for studying", "energetic workout music", "psychedelic rock prog rock"

## Architecture

Built on Cloudflare Workers with:

- Workers KV for request logging and rate limiting
- Discogs API for collection data
- MCP (Model Context Protocol) for AI assistant integration
- No persistent storage or caching
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
		"discogs-local": {
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
		"discogs": {
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

- `DISCOGS_CONSUMER_KEY` - Your Discogs app consumer key
- `DISCOGS_CONSUMER_SECRET` - Your Discogs app consumer secret
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

### Enhanced Multi-Genre Searches (New!)

- "psychedelic rock prog rock space rock" - Finds releases matching ANY of these genre terms
- "ambient drone progressive experimental" - Uses OR logic for broader, more relevant results  
- "jazz fusion bebop hard bop" - Combines multiple jazz subgenres intelligently
- "electronic techno house trance" - Searches across electronic music styles
- "Show me releases similar to Pink Floyd Dark Side of the Moon" - Uses similarity matching with genre filtering

### Traditional Genre-Based Queries

- "Give me some ideas for hard bop albums from the 60s that I own"
- "What do I own that is similar to REM?"
- "Show me my highest-rated Jazz albums from the 1970s"
- "Find electronic music in my collection from the 1980s"
- "What are my best rock albums?"

### Mood-Based Queries (Enhanced!)

- "I want to listen to something mellow on CD tonight"
- "Find me energetic music for working out"
- "What do I have that fits Sunday evening melancholy vibes?"
- "Show me romantic music for a dinner date"
- "I need something dark and brooding for a rainy day" - (Note: "dark" mood vs "Dark Side of the Moon" album detection)
- "Give me chill music for studying"
- "What's good for a cozy winter evening?"
- "moody melancholy introspective sad contemplative" - Multi-mood OR logic finds releases matching any mood term

### Contextual Queries

- "Suggest albums for a road trip"
- "What's perfect for cooking dinner?"
- "Find music for late night listening"
- "Show me something uplifting for Monday morning"

### Search Intelligence Features

The system now features **advanced search intelligence** that:

- **Automatically detects search intent**: Distinguishes between specific album searches ("Dark Side of the Moon") vs. mood-based queries ("dark ambient music")
- **Uses flexible matching logic**: OR logic for genre/mood searches provides broader results, while AND logic for specific searches maintains precision
- **Prioritizes relevance**: Multi-word searches rank results by number of matching terms - releases matching more terms appear first
- **Supports flexible input**: Accepts multiple genres separated by spaces, commas, semicolons, or other separators
- **Handles complex queries**: Combines genre filtering, similarity matching, mood analysis, and relevance scoring intelligently

Whether you're looking for specific albums, exploring genres, or discovering music based on mood and context, the system adapts its search strategy to provide the most relevant results from your collection.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
