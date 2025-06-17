# Last.fm MCP Server Specification

## Overview

The Last.fm MCP Server is a Cloudflare Workers-based service that implements the Model Context Protocol (MCP) to allow AI assistants like Claude to interact with users' Last.fm listening data and music history. The server processes JSON-RPC 2.0 messages according to the MCP specification and returns structured responses with resources, tools, and prompts.

## Key Features

- Implements standard MCP protocol with JSON-RPC 2.0 messaging
- Authenticate users via Last.fm web authentication flow
- Query Last.fm API live (no persistent local storage)
- Expose MCP resources (listening history, track/artist info, user profile)
- Provide MCP tools (recent tracks, top artists, loved tracks, statistics)
- Return structured JSON responses following MCP specification
- Music discovery and recommendation based on listening patterns
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

- **Last.fm API** (web authentication flow and listening data access)
- **MusicBrainz API** (optional additional metadata)

### MCP Implementation

- **Transport**: HTTP with Server-Sent Events (SSE) for server-to-client messages
- **Endpoints**:
  - POST `/` - Main MCP message endpoint
  - GET `/sse` - SSE endpoint for server-initiated messages
  - GET `/login` - Last.fm authentication initiation
  - GET `/callback` - Last.fm authentication callback
- **Protocol Version**: 2024-11-05

---

## Authentication Flow

### Last.fm Web Authentication

The server implements Last.fm's web authentication flow (similar to OAuth but with custom signing):

1. **User initiates login**: GET `/login`
2. **Redirect to Last.fm**: `https://www.last.fm/api/auth/?api_key=xxx&cb=callback_url`
3. **User grants permission** on Last.fm
4. **Callback with token**: Last.fm redirects to `/callback?token=xxx`
5. **Exchange for session**: Server calls `auth.getSession` with signed request
6. **Store session**: Server stores permanent session key for user
7. **Access granted**: User can now use MCP tools and resources

### Authentication Requirements

- **Last.fm API Key** (public identifier)
- **Last.fm Shared Secret** (for signing requests)
- **Session Key** (obtained after user authorization, permanent by default)
- **Method Signatures** (MD5 hash of parameters + shared secret)

---

## MCP Features

### Resources

The server exposes the following MCP resources:

1. **Track Resource** (`lastfm://track/{artist}/{track}`)

   - Provides detailed information about a specific track
   - Includes: play count, tags, similar tracks, album info, etc.

2. **Artist Resource** (`lastfm://artist/{artist}`)

   - Artist information and statistics
   - Includes: bio, tags, similar artists, top tracks/albums

3. **Album Resource** (`lastfm://album/{artist}/{album}`)

   - Detailed information about a specific album
   - Includes: track listing, tags, release info, user play count, similar albums

4. **User Recent Tracks Resource** (`lastfm://user/{username}/recent`)

   - User's recent listening history
   - Supports pagination and time filtering

5. **User Top Artists Resource** (`lastfm://user/{username}/top-artists`)

   - User's most played artists by time period
   - Supports different time periods (7day, 1month, 3month, 6month, 12month, overall)

6. **User Top Albums Resource** (`lastfm://user/{username}/top-albums`)

   - User's most played albums by time period
   - Supports different time periods and includes play counts

7. **User Loved Tracks Resource** (`lastfm://user/{username}/loved`)

   - User's loved/favorite tracks
   - Includes track metadata and love timestamps

8. **User Profile Resource** (`lastfm://user/{username}/profile`)

   - User profile information and statistics
   - Includes: registration date, play count, country, age, gender (if public)

9. **Similar Artists Resource** (`lastfm://artist/{artist}/similar`)

   - Artists similar to the specified artist
   - Includes similarity scores and metadata

10. **Similar Tracks Resource** (`lastfm://track/{artist}/{track}/similar`)
    - Tracks similar to the specified track
    - Includes similarity scores and metadata

### Tools

The server provides these MCP tools:

1. **get_recent_tracks**

   - Description: "Get user's recently played tracks"
   - Parameters: `username` (string), `limit` (number, optional, 1-200, default 50), `from` (timestamp, optional), `to` (timestamp, optional)
   - Returns: Array of recent tracks with timestamps and metadata

2. **get_top_artists**

   - Description: "Get user's top artists by time period"
   - Parameters: `username` (string), `period` (string, optional: 7day|1month|3month|6month|12month|overall, default overall), `limit` (number, optional, 1-1000, default 50)
   - Returns: Array of top artists with play counts

3. **get_top_albums**

   - Description: "Get user's top albums by time period"
   - Parameters: `username` (string), `period` (string, optional), `limit` (number, optional)
   - Returns: Array of top albums with play counts

4. **get_loved_tracks**

   - Description: "Get user's loved/favorite tracks"
   - Parameters: `username` (string), `limit` (number, optional, 1-1000, default 50)
   - Returns: Array of loved tracks with metadata

5. **get_track_info**

   - Description: "Get detailed information about a specific track"
   - Parameters: `artist` (string), `track` (string), `username` (string, optional)
   - Returns: Track details including tags, similar tracks, user play count

6. **get_artist_info**

   - Description: "Get detailed information about an artist"
   - Parameters: `artist` (string), `username` (string, optional)
   - Returns: Artist bio, tags, similar artists, user play count

7. **get_album_info**

   - Description: "Get detailed information about a specific album"
   - Parameters: `artist` (string), `album` (string), `username` (string, optional)
   - Returns: Album details including track listing, tags, release info, user play count

8. **get_listening_stats**

   - Description: "Get comprehensive listening statistics for a user"
   - Parameters: `username` (string), `period` (string, optional)
   - Returns: Statistics including total scrobbles, top genres, listening patterns

9. **get_user_info**

   - Description: "Get user profile information and statistics"
   - Parameters: `username` (string)
   - Returns: User profile with registration date, play count, country, etc.

10. **get_similar_artists**

    - Description: "Get artists similar to a specified artist"
    - Parameters: `artist` (string), `limit` (number, optional, 1-100, default 30)
    - Returns: Array of similar artists with similarity scores

11. **get_similar_tracks**

    - Description: "Get tracks similar to a specified track"
    - Parameters: `artist` (string), `track` (string), `limit` (number, optional, 1-100, default 30)
    - Returns: Array of similar tracks with similarity scores

12. **get_music_recommendations**
    - Description: "Get music recommendations based on listening history"
    - Parameters: `username` (string), `limit` (number, optional), `genre` (string, optional)
    - Returns: Recommended tracks/artists/albums based on user's listening patterns

### Prompts

The server offers these MCP prompts:

1. **listening_insights**

   - Description: "Get insights about user's listening habits and patterns"
   - Arguments: `username` (string), `period` (string, optional)

2. **music_discovery**

   - Description: "Discover new music based on listening history"
   - Arguments: `username` (string), `genre` (string, optional)

3. **track_analysis**

   - Description: "Get detailed analysis of a specific track"
   - Arguments: `artist` (string), `track` (string)

4. **album_analysis**

   - Description: "Get detailed analysis of a specific album"
   - Arguments: `artist` (string), `album` (string)

5. **artist_analysis**

   - Description: "Get detailed analysis of a specific artist"
   - Arguments: `artist` (string)

6. **listening_habits**
   - Description: "Analyze and summarize user's listening habits"
   - Arguments: `username` (string), `timeframe` (string, optional)

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
			"name": "lastfm-mcp",
			"version": "1.0.0"
		}
	}
}
```

### 2. Authentication

Before accessing Last.fm data, users must complete the Last.fm web authentication flow to obtain a session key.

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

- Enforced per user ID and per API key
- Configurable thresholds (e.g. 50 requests/min, 1000/hour)
- Respects Last.fm API limits (~5 requests/second)
- Implements exponential backoff for rate limit recovery
- Returns standard MCP error response when exceeded
- Graceful degradation when approaching limits

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

- Last.fm session keys stored securely with encryption
- All MCP messages validated against schema
- Resource access scoped to authenticated user
- Method signatures prevent request tampering
- CORS headers configured for web clients
- Input sanitization and validation
- Secure cookie settings (httpOnly, secure, sameSite)
- Session timeout and refresh mechanisms

---

## Testing Plan

### Unit Tests

- MCP message parsing and validation
- JSON-RPC request/response handling
- Resource and tool implementations
- Last.fm web authentication flow

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

## Performance Considerations

### Caching Strategy

- Cache static data (artist info, album details) for 24 hours
- Cache user data (recent tracks, top artists) for 5 minutes
- Implement cache invalidation for real-time updates
- Use Workers KV for distributed caching

### Optimization

- Batch API requests where possible
- Implement request deduplication
- Use streaming responses for large datasets
- Minimize memory usage in Workers

## Monitoring & Observability

### Metrics

- Request latency and success rates
- Last.fm API quota usage
- User authentication success/failure rates
- Most popular tools and resources
- Error rates by endpoint

### Alerting

- Rate limit approaching thresholds
- Authentication failure spikes
- Last.fm API errors
- Worker deployment failures

## Production Readiness Checklist

### Core Functionality

- [ ] All MCP protocol methods implemented and tested
- [ ] Complete Last.fm API integration with all required endpoints
- [ ] Robust authentication flow with session management
- [ ] Comprehensive error handling and user feedback
- [ ] Input validation and sanitization
- [ ] Proper HTTP status codes and responses

### Performance & Scalability

- [ ] Caching implemented for frequently accessed data
- [ ] Rate limiting with graceful degradation
- [ ] Request deduplication and batching
- [ ] Efficient memory usage in Workers environment
- [ ] Response streaming for large datasets
- [ ] Database connection pooling (if applicable)

### Security

- [ ] Secure session key storage and management
- [ ] CORS configuration for web clients
- [ ] Input validation against injection attacks
- [ ] Proper authentication token handling
- [ ] Secure cookie settings
- [ ] API key rotation capability

### Reliability

- [ ] Comprehensive error handling for all failure modes
- [ ] Retry logic with exponential backoff
- [ ] Circuit breaker for upstream dependencies
- [ ] Graceful degradation when services are unavailable
- [ ] Health check endpoints
- [ ] Proper timeout handling

### Monitoring & Observability

- [ ] Structured logging with correlation IDs
- [ ] Metrics collection for key performance indicators
- [ ] Error tracking and alerting
- [ ] API usage analytics
- [ ] Performance monitoring
- [ ] Distributed tracing (if needed)

### Testing

- [ ] Unit tests with ≥80% coverage
- [ ] Integration tests for all workflows
- [ ] End-to-end tests with real Last.fm API
- [ ] Load testing for expected traffic
- [ ] Security testing and vulnerability scanning
- [ ] Chaos engineering for resilience

### Documentation

- [ ] Complete API documentation
- [ ] Setup and deployment guides
- [ ] Troubleshooting documentation
- [ ] Architecture decision records
- [ ] Runbook for common operational tasks
- [ ] User guides and examples

### Deployment & Operations

- [ ] CI/CD pipeline with automated testing
- [ ] Environment-specific configurations
- [ ] Blue-green or canary deployment strategy
- [ ] Rollback procedures
- [ ] Secrets management
- [ ] Infrastructure as code

## Future Enhancements (Deferred)

- WebSocket transport support
- Real-time scrobbling notifications
- Additional MCP capabilities (sampling)
- Advanced recommendation algorithms using ML
- Multi-user comparison tools
- Playlist generation and management
- Integration with other music services (Spotify, Apple Music)
- Real-time listening activity feeds
- Music discovery based on social networks
- Advanced analytics and listening insights

---

This document defines the requirements for a fully compliant Last.fm MCP server implementation.
