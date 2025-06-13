# Test Duplication Analysis - Last.fm MCP

## Summary of Test Files Analyzed

1. **test/clients/lastfm.test.ts** - Unit tests for the Last.fm API client
2. **test/integration/mcp-client.test.ts** - Integration tests for MCP protocol (converted from Discogs)
3. **test/protocol/tools.test.ts** - Unit tests for MCP tools
4. **test/protocol/resources.test.ts** - Unit tests for MCP resources
5. **test/protocol/handlers.test.ts** - Unit tests for MCP protocol handlers

## Duplication Found

### 1. Last.fm API Mocking Duplication

**Files affected:**
- `test/integration/mcp-client.test.ts` (lines 335-427)
- `test/clients/lastfm.test.ts` (lines 31-95)

**Description:** Both files mock Last.fm API responses, but with different structures and approaches:
- `mcp-client.test.ts` mocks full HTTP fetch responses with complete API structures
- `lastfm.test.ts` mocks the `fetchWithRetry` module with partial response structures

**Recommendation:** Keep both as they serve different purposes:
- Integration tests need full HTTP response mocking to test the entire flow
- Unit tests need module-level mocking to isolate the client behavior

### 2. Authentication/Session Handling Duplication

**Files affected:**
- `test/integration/mcp-client.test.ts` (lines 185-198) - `authenticate()` method
- `test/protocol/tools.test.ts` (lines 36-52) - `createMockAuthenticatedRequest()`
- `test/protocol/handlers.test.ts` (lines 7-14) - `createMockAuthenticatedRequest()`

**Description:** Multiple files create mock authenticated requests/sessions with similar patterns

**Recommendation:** Consider extracting to a shared test utility file:
```typescript
// test/utils/auth.ts
export async function createMockAuthenticatedRequest(jwtSecret: string): Promise<Request>
export function createMockSession(): SessionPayload
```

### 3. MCP Protocol Initialization Duplication

**Files affected:**
- `test/integration/mcp-client.test.ts` (lines 133-158, 432-456)
- `test/protocol/handlers.test.ts` (lines 112-131, 249-264)
- `test/protocol/tools.test.ts` (lines 63-79, 147-164)

**Description:** The initialization handshake (initialize → initialized) is repeated across multiple test files

**Recommendation:** Create a shared helper:
```typescript
// test/utils/mcp.ts
export async function initializeMCPProtocol(client?: MockMCPClient): Promise<void>
```

### 4. Tool Testing Overlap

**Files affected:**
- `test/integration/mcp-client.test.ts` (lines 504-526) - Tests `get_track_info` and `get_artist_info` tools
- `test/protocol/tools.test.ts` (lines 200-271) - Tests `get_user_recent_tracks` tool

**Description:** Both files test MCP tools but at different levels:
- Integration tests verify the full request/response cycle
- Unit tests verify tool handler logic

**Recommendation:** Keep both - they test different aspects and are complementary

### 5. Resource Testing Overlap

**Files affected:**
- `test/integration/mcp-client.test.ts` (lines 489-496) - Tests profile resource read
- `test/protocol/resources.test.ts` (lines 74-194) - Detailed resource read tests

**Description:** Minimal overlap - integration tests verify authentication while unit tests verify resource parsing

**Recommendation:** No action needed - tests are complementary

## Recommendations Summary

1. **Extract shared test utilities** for:
   - Mock authentication/session creation
   - MCP protocol initialization
   - Common Last.fm API response fixtures

2. **Keep existing test structure** because:
   - Integration tests verify end-to-end flows
   - Unit tests verify individual components
   - Different mocking strategies serve different purposes

3. **No tests should be removed** - the apparent duplication is actually testing at different levels (unit vs integration)

## Proposed Test Utility Structure

```
test/
  utils/
    auth.ts         # Shared authentication helpers
    mcp.ts          # MCP protocol helpers
    fixtures.ts     # Common Last.fm API response fixtures
  clients/
    lastfm.test.ts  # Keep as-is (unit tests)
  integration/
    mcp-client.test.ts  # Keep as-is (e2e tests)
  protocol/
    handlers.test.ts    # Update to use shared utils
    tools.test.ts       # Update to use shared utils
    resources.test.ts   # Keep as-is
```

This would reduce code duplication while maintaining comprehensive test coverage at all levels.