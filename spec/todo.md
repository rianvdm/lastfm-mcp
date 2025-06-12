# Last.fm MCP Server – Development Checklist

> Use this file as a living checklist. Mark each `[ ]` entry as `[x]` when complete.

---

## Phase 1 – Project Conversion Setup

- [x] **A1** Update package.json name, description, and keywords for Last.fm
- [x] **A2** Update README.md with Last.fm-specific information
- [x] **A3** Update all configuration files and examples for Last.fm
- [x] **A4** Remove or update Discogs-specific documentation

## Phase 2 – Authentication System Overhaul

- [x] **B1** Create new `src/auth/lastfm.ts` web authentication flow
- [x] **B2** Remove Discogs OAuth system (`src/auth/discogs.ts`)
- [x] **B3** Update authentication middleware for session key validation
- [x] **B4** Update environment variables and Wrangler secrets
- [ ] **B5** Update authentication tests for Last.fm web auth flow
- [x] **B6** Implement MD5 method signature generation
- [x] **B7** Add /login and /callback routes for Last.fm auth

## Phase 3 – API Client Replacement

- [ ] **C1** Create new `src/clients/lastfm.ts` API client
- [ ] **C2** Implement Last.fm API methods (recent tracks, top artists, top albums, etc.)
- [ ] **C3** Add similar artists and similar tracks endpoints
- [ ] **C4** Implement retry logic and rate limiting
- [ ] **C5** Remove Discogs client (`src/clients/discogs.ts`)
- [ ] **C6** Update all imports throughout codebase
- [ ] **C7** Add comprehensive error handling for Last.fm API

## Phase 4 – Data Type Updates

- [ ] **D1** Update `src/types/` with Last.fm data structures
- [ ] **D2** Replace Discogs types with Last.fm equivalents
- [ ] **D3** Update MCP resource and tool schemas
- [ ] **D4** Update validation schemas for Last.fm data
- [ ] **D5** Test type compatibility across the system

## Phase 5 – MCP Resources Conversion

- [ ] **E1** Update resource URIs for Last.fm (lastfm://track/{artist}/{track}, etc.)
- [ ] **E2** Implement track resource handler
- [ ] **E3** Implement artist resource handler
- [ ] **E4** Implement album resource handler
- [ ] **E5** Implement user listening history resources (recent, top artists, top albums)
- [ ] **E6** Implement user profile resource
- [ ] **E7** Implement similar artists and similar tracks resources
- [ ] **E8** Add pagination support for large datasets
- [ ] **E9** Test all new resource implementations

## Phase 6 – MCP Tools Conversion

- [ ] **F1** Replace collection tools with Last.fm listening data tools
- [ ] **F2** Implement get_recent_tracks tool
- [ ] **F3** Implement get_top_artists and get_top_albums tools
- [ ] **F4** Implement get_loved_tracks tool
- [ ] **F5** Implement get_track_info and get_artist_info tools
- [ ] **F6** Implement get_album_info tool
- [ ] **F7** Implement get_user_info tool
- [ ] **F8** Implement get_similar_artists and get_similar_tracks tools
- [ ] **F9** Implement get_listening_stats tool
- [ ] **F10** Implement get_music_recommendations tool
- [ ] **F11** Add comprehensive parameter validation
- [ ] **F12** Update all tool schemas and validation

## Phase 7 – MCP Prompts Adaptation

- [ ] **G1** Update prompt definitions for Last.fm use cases
- [ ] **G2** Implement listening_insights prompt
- [ ] **G3** Implement music_discovery prompt
- [ ] **G4** Implement track_analysis prompt
- [ ] **G5** Implement album_analysis prompt
- [ ] **G6** Implement artist_analysis prompt
- [ ] **G7** Implement listening_habits prompt
- [ ] **G8** Test all prompt responses and formatting

## Phase 8 – Protocol Handler Updates

- [ ] **H1** Update `src/protocol/handlers.ts` for Last.fm resources
- [ ] **H2** Update tool call handlers for Last.fm tools
- [ ] **H3** Update prompt handlers for Last.fm prompts
- [ ] **H4** Update error handling for Last.fm API errors
- [ ] **H5** Validate MCP protocol compliance

## Phase 9 – Infrastructure & Configuration

- [ ] **I1** Update `wrangler.toml` for Last.fm environment
- [ ] **I2** Update environment variable names and secrets
- [ ] **I3** Update KV namespace names and configuration
- [ ] **I4** Update rate limiting for Last.fm API limits (~5 req/sec)
- [ ] **I5** Implement caching strategy for performance
- [ ] **I6** Add monitoring and metrics collection
- [ ] **I7** Update logging for Last.fm-specific events
- [ ] **I8** Configure CORS for web clients
- [ ] **I9** Set up health check endpoints

## Phase 10 – Testing Overhaul

- [ ] **J1** Update unit tests for Last.fm API client
- [ ] **J2** Update integration tests with Last.fm API mocking
- [ ] **J3** Update MCP protocol tests for Last.fm resources/tools
- [ ] **J4** Add end-to-end tests for Last.fm scenarios
- [ ] **J5** Test rate limiting and backoff behavior
- [ ] **J6** Test authentication edge cases
- [ ] **J7** Update test data and fixtures for Last.fm
- [ ] **J8** Add performance and load testing
- [ ] **J9** Validate test coverage ≥ 80%

## Phase 11 – Documentation & Examples

- [ ] **K1** Update README with Last.fm setup instructions
- [ ] **K2** Create Last.fm API key setup guide
- [ ] **K3** Update Claude Desktop configuration examples
- [ ] **K4** Create Last.fm-specific usage examples
- [ ] **K5** Add setup guide for Last.fm API credentials
- [ ] **K6** Document rate limiting and caching behavior
- [ ] **K7** Update troubleshooting guide for Last.fm issues
- [ ] **K8** Update deployment documentation
- [ ] **K9** Create monitoring and alerting documentation

## Phase 12 – Deployment & Validation

- [ ] **L1** Test deployment to Cloudflare Workers
- [ ] **L2** Validate Last.fm API integration in production
- [ ] **L3** Test with Claude Desktop client
- [ ] **L4** Verify all MCP protocol compliance
- [ ] **L5** Performance testing and optimization
- [ ] **L6** Test with multiple concurrent users
- [ ] **L7** Validate caching effectiveness
- [ ] **L8** Monitor logs and error rates
- [ ] **L9** Set up production alerting
- [ ] **L10** Conduct security review

---

## Key Last.fm Integration Points

### API Endpoints to Implement
- `user.getRecentTracks` - Recent listening history (with pagination)
- `user.getTopArtists` - Top artists by time period
- `user.getTopAlbums` - Top albums by time period
- `user.getLovedTracks` - User's loved tracks
- `track.getInfo` - Track metadata and statistics
- `artist.getInfo` - Artist information and bio
- `album.getInfo` - Album information and track listing
- `user.getInfo` - User profile information
- `artist.getSimilar` - Similar artists with scores
- `track.getSimilar` - Similar tracks with scores
- `auth.getSession` - Convert auth token to session key

### Authentication Requirements
- Last.fm API key (public identifier)
- Last.fm shared secret (for signing requests)
- Session key (obtained after user authorization, permanent by default)
- Method signatures (MD5 hash of parameters + shared secret)
- Web authentication flow similar to OAuth but with custom signing

### Rate Limiting Considerations
- Last.fm API: ~5 requests per second per API key
- Implement exponential backoff and retry logic
- Cache frequently accessed data (24h for static, 5min for user data)
- Monitor quota usage and implement graceful degradation
- Queue requests during high traffic periods

### Data Mapping Challenges
- Map Last.fm track/artist/album data to MCP resource format
- Handle missing metadata gracefully with defaults
- Convert Unix timestamps to ISO 8601 format
- Map Last.fm tags to genres/categories with confidence scores
- Normalize artist and track names for consistency
- Handle special characters and Unicode in names
- Deal with album disambiguation (multiple releases)
- Process large datasets efficiently (streaming/pagination)

---

### Ongoing Quality Gates

- [ ] Lint passes (`npm run lint`)
- [ ] Unit tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Code coverage ≥ 80 percent
- [ ] MCP protocol compliance validated
- [ ] Last.fm API integration tested
- [ ] Claude Desktop compatibility verified
- [ ] Rate limiting properly implemented
- [ ] Caching working effectively
- [ ] Error handling comprehensive
- [ ] Security measures in place
- [ ] Performance benchmarks met

> **Tip:** This conversion maintains the MCP server architecture while adapting to Last.fm's API and data model. Focus on one phase at a time to ensure stability.