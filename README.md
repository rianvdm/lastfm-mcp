# Discogs MCP Server

A Cloudflare Workers-based service that allows authenticated users to interact with their personal Discogs music collection via natural language commands using the MCP (Model Context Protocol).

## Overview

This server processes plain-text queries and returns rich, markdown-formatted responses suitable for display in natural language clients like ChatGPT or Claude.

## Key Features

- **OAuth Authentication**: Secure login via Discogs OAuth
- **Collection Management**: Query and search your personal Discogs collection
- **Natural Language Interface**: Process commands in plain English
- **Rich Responses**: Markdown-formatted output optimized for AI assistants
- **Rate Limiting**: Per-user request throttling via Workers KV
- **Optional Last.fm Integration**: Enhanced recommendations based on listening history

## Commands

- `release <id>` - Get detailed information about a specific release
- `search <query>` - Search your collection with natural language
- `stats` - View statistics about your collection
- `listen [mood|genre|decade]` - Get personalized listening recommendations

## Architecture

Built on Cloudflare Workers with:

- Workers KV for request logging and rate limiting
- Discogs API for collection data
- Optional Last.fm API for play history
- No persistent storage or caching

## Development

This project uses Wrangler for Cloudflare Workers development.

```bash
npm install
npm run dev    # Start local development server
npm test       # Run tests
npm run build  # Build for production
```

## License

[License information to be added]
