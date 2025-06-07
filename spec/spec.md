# Discogs MCP Server Specification

## Overview

The Discogs MCP Server is a Cloudflare Workers-based service that implements the Model Context Protocol (MCP) to allow AI assistants like Claude to interact with users' personal Discogs music collections. The server processes JSON-RPC 2.0 messages according to the MCP specification and returns structured responses with resources, tools, and prompts.

## Key Features

- Implements standard MCP protocol with JSON-RPC 2.0 messaging
- Authenticate users via Discogs OAuth
- Query Discogs API live (no persistent local storage)
- Expose MCP resources (collection data, release information)
- Provide MCP tools (search, stats, recommendations)
- Return structured JSON responses following MCP specification
- Optional Last.fm integration for play history-based recommendations
- No caching or persistence (except logging)
- Rate limiting and detailed request logging via Workers KV

---

## Architecture

### Platform

- **Runtime**: Cloudflare Workers
- **Protocol**: Model Context Protocol (MCP) over HTTP with SSE transport
- **Message Format**: JSON-RPC 2.0
- **Storage**:
  - Workers KV for request logs
  - No persistent cache or user data

### External Integrations

- **Discogs API** (OAuth authentication and data access)
- **Last.fm API** (optional user play history)

### MCP Implementation

- **Transport**: HTTP with Server-Sent Events (SSE) for server-to-client messages
- **Endpoints**:
  - POST `/` - Main MCP message endpoint
  - GET `/sse` - SSE endpoint for server-initiated messages
- **Protocol Version**: 2024-11-05

---

## MCP Features

### Resources

The server exposes the following MCP resources:

1. **Release Resource** (`discogs://release/{id}`)
   - Provides detailed information about a specific release
   - Includes: title, artist, year, format, genres, tracklist, etc.

2. **Collection Resource** (`discogs://collection`)
   - User's entire collection data
   - Supports filtering and pagination

3. **Search Results Resource** (`discogs://search?q={query}`)
   - Search results from user's collection
   - Returns matching releases

### Tools

The server provides these MCP tools:

1. **search_collection**
   - Description: "Search user's Discogs collection"
   - Parameters: `query` (string), `limit` (number, optional)
   - Returns: Array of matching releases

2. **get_release**
   - Description: "Get detailed information about a release"
   - Parameters: `release_id` (string)
   - Returns: Detailed release object

3. **get_collection_stats**
   - Description: "Get statistics about user's collection"
   - Parameters: none
   - Returns: Statistics object with counts, genres, decades, etc.

4. **get_recommendations**
   - Description: "Get listening recommendations based on collection"
   - Parameters: `mood` (string, optional), `genre` (string, optional), `decade` (string, optional)
   - Returns: Array of recommended releases

### Prompts

The server offers these MCP prompts:

1. **browse_collection**
   - Description: "Browse and explore music collection"
   - Arguments: none

2. **find_music**
   - Description: "Find specific music in collection"
   - Arguments: `query` (string)

3. **collection_insights**
   - Description: "Get insights about music collection"
   - Arguments: none

---

## Protocol Flow

### 1. Initialization

Client connects and sends:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "Claude",
      "version": "1.0.0"
    }
  }
}
```

Server responds with capabilities:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "resources": {},
      "tools": {},
      "prompts": {}
    },
    "serverInfo": {
      "name": "discogs-mcp",
      "version": "1.0.0"
    }
  }
}
```

### 2. Authentication

Before accessing Discogs data, users must authenticate via OAuth flow.

### 3. Resource/Tool Usage

Clients can list and use available resources and tools via standard MCP methods:
- `resources/list`
- `resources/read`
- `tools/list`
- `tools/call`
- `prompts/list`
- `prompts/get`

---

## Non-Functional Requirements

### Rate Limiting

- Enforced per user ID
- Configurable thresholds (e.g. X requests/min, Y/hour)
- Returns standard MCP error response when exceeded

### Logging

- Stored in Workers KV
- Logged per request:
  - Timestamp
  - User ID
  - MCP method
  - Parameters
  - Result metadata (status, latency)

### Error Handling

- Returns standard JSON-RPC 2.0 error responses
- Error codes follow MCP specification
- User-friendly error messages in `data` field

### Security

- OAuth tokens stored securely
- All MCP messages validated against schema
- Resource access scoped to authenticated user

---

## Testing Plan

### Unit Tests

- MCP message parsing and validation
- JSON-RPC request/response handling
- Resource and tool implementations
- OAuth flow

### Integration Tests

- Full MCP protocol flow
- Initialize → Authenticate → Use tools/resources
- Error scenarios
- Rate limiting

### Protocol Compliance

- Validate against MCP specification
- Test with MCP Inspector tool
- Verify compatibility with Claude Desktop

---

## Future Enhancements (Deferred)

- WebSocket transport support
- Caching with Workers KV
- Additional MCP capabilities (sampling)
- More sophisticated recommendation algorithms

---

This document defines the requirements for a fully compliant MCP server implementation.
