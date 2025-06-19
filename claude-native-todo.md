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
- [ ] **4. Client management** - OAuth client ID/secret generation and validation utilities
- [ ] **5. Authorization codes** - Generate and validate temporary OAuth codes (10min TTL)
- [ ] **6. Authorization endpoint** - GET /oauth/authorize with Last.fm integration
- [ ] **7. Token endpoint** - POST /oauth/token for code-to-token exchange
- [ ] **8. Bearer auth** - Add Bearer token support to existing MCP handlers

### 🧪 Testing (Critical)
- [ ] **12. OAuth authorize tests** - Unit tests for authorization endpoint
- [ ] **13. OAuth token tests** - Unit tests for token endpoint  
- [ ] **14. Bearer validation tests** - Unit tests for token validation
- [ ] **15. Integration tests** - End-to-end OAuth flow testing
- [ ] **22. Regression tests** - Verify existing functionality still works

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
- [ ] **23. Code quality** - Lint and format checks

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
**Current Phase:** Core OAuth Implementation

### ✅ Completed Infrastructure (2025-06-19)
- Created `claude-native` branch for safe development
- Added 6 new KV namespaces (3 dev + 3 prod): OAUTH_CLIENTS, OAUTH_CODES, OAUTH_TOKENS
- Updated `wrangler.toml` with real namespace IDs
- Updated `src/types/env.ts` with OAuth KV bindings
- Created comprehensive OAuth types in `src/types/oauth.ts`
- All builds and lint checks pass

Mark tasks complete with ✅ as they're finished. Update this document to track progress and any implementation notes or issues discovered.