# Discogs MCP Server

A Cloudflare Workers-based service that allows authenticated users to interact with their personal Discogs music collection via natural language commands using the MCP (Model Context Protocol).

## Overview

This server processes plain-text queries and returns rich, markdown-formatted responses suitable for display in natural language clients like ChatGPT or Claude.

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

## Development

This project uses Wrangler for Cloudflare Workers development.

```bash
npm install
npm run dev    # Start local development server
npm test       # Run tests
npm run build  # Build for production
```

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
