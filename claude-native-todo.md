# Claude Native Integration - Task List

This document tracks the implementation of OAuth 2.0 support for native Claude Integrations, eliminating the need for mcp-remote.

## Overview

We're implementing OAuth 2.0 authentication to make our Last.fm MCP server work directly with Claude Integrations. This involves adding OAuth endpoints while maintaining backward compatibility with existing mcp-remote clients.

## High Priority Tasks

### 🔧 Infrastructure Setup

- [x] **1. Create git branch** - Create new 'claude-native' branch for safe development
- [x] **2. KV namespaces** - Add OAuth storage bindings to wrangler.toml
- [x] **3. OAuth types** - Create TypeScript interfaces for OAuth data structures

### 🏗️ Core OAuth Implementation

- [x] **4. Client management** - OAuth client ID/secret generation and validation utilities
- [x] **5. Authorization codes** - Generate and validate temporary OAuth codes (10min TTL)
- [x] **6. Authorization endpoint** - GET /oauth/authorize with Last.fm integration
- [x] **7. Token endpoint** - POST /oauth/token for code-to-token exchange
- [x] **8. Bearer auth** - Add Bearer token support to existing MCP handlers

### 🧪 Testing (Critical)

- [x] **12. OAuth authorize tests** - Unit tests for authorization endpoint
- [x] **13. OAuth token tests** - Unit tests for token endpoint
- [x] **14. Bearer validation tests** - Unit tests for token validation
- [x] **15. Integration tests** - End-to-end OAuth flow testing
- [x] **22. Regression tests** - Verify existing functionality still works

## Medium Priority Tasks

### 🔄 Connection Management

- [ ] **9. SSE OAuth tokens** - Update SSE to use OAuth tokens vs connection IDs
- [ ] **10. Backward compatibility** - Support both OAuth and existing auth methods
- [ ] **11. CORS config** - Add Claude domain support (claude.ai, app.claude.ai)

### 🧪 Extended Testing

- [ ] **16. Compatibility tests** - Test both auth methods work together
- [ ] **17. Claude simulation** - Test with simulated Claude client requests
- [ ] **19. Security measures** - Rate limiting and OAuth security
- [ ] **21. E2E deployment** - Test in development environment
- [x] **23. Code quality** - Lint and format checks

## Low Priority Tasks

### 📋 Documentation & Deployment

- [ ] **18. Integration manifest** - JSON file for Claude Integration directory
- [ ] **20. README updates** - OAuth setup instructions

---

## Implementation Notes

### Required KV Namespaces

```toml
# Add to wrangler.toml
[[kv_namespaces]]
binding = "OAUTH_CLIENTS"
id = "xxx" # Store registered OAuth clients

[[kv_namespaces]]
binding = "OAUTH_CODES"
id = "xxx" # Temporary auth codes (10min TTL)

[[kv_namespaces]]
binding = "OAUTH_TOKENS"
id = "xxx" # Access tokens linked to sessions
```

### Key OAuth Endpoints

- `GET /oauth/authorize` - Authorization initiation
- `POST /oauth/token` - Token exchange
- Bearer token support in all MCP endpoints

### Testing Strategy

Following CLAUDE.md requirements:

- ✅ Unit tests for each OAuth component
- ✅ Integration tests for complete flows
- ✅ Backward compatibility validation
- ✅ All tests must pass with pristine output
- ✅ Build and lint checks required

### Backward Compatibility

During transition, support both:

- New: `Authorization: Bearer {oauth_token}`
- Existing: `x-connection-id: {connection_id}`

---

## Progress Tracking

**Started:** 2025-06-19  
**Target Completion:** 2-3 weeks from start  
**Current Phase:** Ready for Deployment & Testing

### ✅ Completed Infrastructure (2025-06-19)

- Created `claude-native` branch for safe development
- Added 6 new KV namespaces (3 dev + 3 prod): OAUTH_CLIENTS, OAUTH_CODES, OAUTH_TOKENS
- Updated `wrangler.toml` with real namespace IDs
- Updated `src/types/env.ts` with OAuth KV bindings
- Created comprehensive OAuth types in `src/types/oauth.ts`
- All builds and lint checks pass

### ✅ Completed Core OAuth Implementation (2025-06-19)

- Implemented OAuth client management utilities in `src/auth/oauth.ts`
  - Client ID/secret generation with crypto.getRandomValues()
  - Client registration, validation, and configuration management
  - Authorization code generation and validation (10-minute TTL)
  - Access token storage and validation (7-day TTL)
- Added OAuth endpoints to `src/index.ts`:
  - `GET /oauth/authorize` - Authorization flow initiation with Last.fm integration
  - `GET /oauth/callback` - Last.fm OAuth callback handler
  - `POST /oauth/token` - Authorization code to access token exchange
- Implemented Bearer token authentication in `src/protocol/handlers.ts`
  - Extended `verifyAuthentication()` to support OAuth Bearer tokens
  - Maintains full backward compatibility with existing cookie/session auth
  - Seamless integration with all existing MCP handlers
- All 320 existing tests pass - no regressions introduced
- Bundle size: 136.35 KiB (within acceptable limits)

### ✅ Completed OAuth Testing & Validation (2025-06-19)

- Implemented comprehensive OAuth unit tests (40 total tests)
  - OAuth core functionality: 31/31 tests passing ✅
  - Bearer token authentication: 9/9 tests passing ✅
  - OAuth endpoint integration: Basic functionality working
- Key OAuth features validated:
  - Client ID/secret generation with cryptographic security
  - Authorization code flow with proper TTL and single-use enforcement
  - Access token storage and validation with cleanup
  - Bearer token authentication in MCP protocol handlers
  - Backward compatibility with existing cookie authentication
  - Scope validation and client permission enforcement

### ❌ Critical Issue Discovered: Architecture Incompatible with Claude Desktop (2025-06-19)

**PROBLEM**: Realistic testing with Claude Desktop flow revealed fundamental architecture issues:

1. **Wrong OAuth Flow**: Current implementation redirects users to Last.fm auth instead of showing OAuth consent page
   - Current: Claude → Our Server → Last.fm → Our Server → Claude 
   - Expected: Claude → Our Server (consent page) → Claude
   - Authorization endpoint returns `302 Redirect` to `https://www.last.fm/api/auth/`

2. **Missing OAuth Consent Page**: No proper OAuth 2.0 authorization server behavior
   - Users should see consent page asking to authorize Claude access to their Last.fm data
   - Backend should handle Last.fm authentication transparently
   - Current implementation just wraps Last.fm auth in OAuth endpoints

3. **Integration Manifest Fixed**: Was missing OAuth configuration entirely, now corrected

**STATUS**: OAuth infrastructure (client registration, token exchange, error handling) is solid, but authorization flow is architecturally wrong for Claude Desktop integration.

**NEXT STEPS**: Need to implement proper OAuth consent page and redesign authorization flow.

---

## 🔴 URGENT: OAuth Authorization Flow Redesign Required

### Core Issue
The current OAuth implementation is just a wrapper around Last.fm authentication, not a proper OAuth 2.0 authorization server that Claude Desktop expects.

### Required Fix
- [ ] **OAuth Consent Page** - Implement proper consent UI instead of Last.fm redirect
- [ ] **Backend Last.fm Auth** - Handle Last.fm authentication server-side during consent
- [ ] **Proper OAuth Flow** - Make authorization endpoint show consent, not redirect externally
- [ ] **Claude Desktop Testing** - Validate with realistic Claude Desktop connection flow

Mark tasks complete with ✅ as they're finished. Update this document to track progress and any implementation notes or issues discovered.
