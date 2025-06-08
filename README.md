# Discogs MCP Server

A Cloudflare Workers-based service that allows authenticated users to interact with their personal Discogs music collection via natural language commands using the MCP (Model Context Protocol).

## Overview

This server processes plain-text queries and returns rich, markdown-formatted responses suitable for display in natural language clients like ChatGPT or Claude.

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

### Available Tools

Once connected and authenticated, you can:
- **Search your collection**: "Find all my Beatles albums"
- **Get release details**: "Tell me about this specific album" 
- **View collection stats**: "What genres do I have the most of?"
- **Get recommendations**: "Suggest some jazz albums from my collection"

## Key Features

- **OAuth Authentication**: Secure login via Discogs OAuth
- **Collection Search**: Search through your Discogs collection by artist, album, genre, year, etc.
- **Release Details**: Get detailed information about specific releases including tracklists, formats, and metadata
- **Collection Statistics**: Analyze your collection with breakdowns by genre, decade, format, and more
- **Context-Aware Recommendations**: Get intelligent recommendations from your own collection based on:
  - Genre preferences (e.g., "Jazz", "Rock", "Electronic")
  - Time periods (e.g., "1960s", "1970s", "1980s")
  - Similar artists or albums (e.g., "similar to Miles Davis")
  - Natural language queries (e.g., "hard bop albums from the 60s that I own")
- **Natural Language Interface**: Process commands via MCP protocol
- **Rich Responses**: Structured output optimized for AI assistants
- **Rate Limiting**: Per-user request throttling via Workers KV

## MCP Tools

- `search_collection` - Search your collection with flexible queries
- `get_release` - Get detailed information about a specific release
- `get_collection_stats` - View statistics about your collection
- `get_recommendations` - Get context-aware listening recommendations from your collection

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

For local development:
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

For production:
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

With the enhanced recommendations system, you can now ask questions like:

- "Give me some ideas for hard bop albums from the 60s that I own"
- "What do I own that is similar to REM?"
- "Show me my highest-rated Jazz albums from the 1970s"
- "Find electronic music in my collection from the 1980s"
- "What are my best rock albums?"

The system will intelligently filter through your actual collection and provide personalized recommendations based on your ratings, genres, and listening history.

## License

[License information to be added]
