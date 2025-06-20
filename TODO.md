# Last.fm MCP Server Migration to Native Claude Integration - Implementation Plan

## Executive Summary

This TODO outlines the complete migration from the current `mcp-remote` based implementation to native Claude Custom Integration support. The migration requires implementing OAuth 2.0 with Dynamic Client Registration while maintaining the excellent Last.fm functionality users expect.

## Analysis Validation ✅

After reviewing the migration analysis and implementation guide:
- **Migration analysis is accurate**: Previous attempts failed due to stdio transport compatibility attempts and missing OAuth 2.0 implementation
- **Implementation guide is technically sound**: The OAuth bridging approach and SSE transport strategy will work
- **Requirements are well understood**: Claude requires OAuth 2.0 with Dynamic Client Registration for custom integrations

## Phase 1: Pre-Implementation Setup (Week 1)

### P0: Environment and Dependencies
- [ ] **1.1** Verify `@cloudflare/workers-oauth-provider` package exists and is compatible
  - [ ] Research alternative OAuth libraries if needed (e.g., `workers-oauth2`, custom implementation)
  - [ ] Test OAuth library with Cloudflare Workers runtime
  - [ ] Document any limitations or compatibility issues

- [ ] **1.2** Update development environment
  - [ ] Install required OAuth dependencies
  - [ ] Update TypeScript types for OAuth integration
  - [ ] Configure development secrets for testing

- [ ] **1.3** Create migration branch
  - [ ] Branch from main: `git checkout -b claude-native-v3`
  - [ ] Document migration strategy in branch README

### P0: Research and Validation
- [ ] **1.4** Test current MCP Inspector compatibility
  - [ ] Validate current SSE endpoint with MCP Inspector
  - [ ] Document any current protocol issues
  - [ ] Test tool functionality end-to-end

- [ ] **1.5** Research Claude's OAuth requirements
  - [ ] Verify Dynamic Client Registration specification
  - [ ] Test OAuth flow with Claude's expected endpoints
  - [ ] Document required OAuth scopes and claims

## Phase 2: OAuth Infrastructure Implementation (Week 1-2)

### P0: OAuth Provider Setup
- [ ] **2.1** Implement OAuth provider core
  - [ ] Create `src/oauth/provider.ts` with Dynamic Client Registration
  - [ ] Implement client registry using Cloudflare KV
  - [ ] Add token generation and validation
  - [ ] Create token introspection endpoint

- [ ] **2.2** Implement OAuth endpoints
  - [ ] `/oauth/client` - Dynamic Client Registration (POST)
  - [ ] `/oauth/authorize` - Authorization endpoint (GET)
  - [ ] `/oauth/token` - Token exchange endpoint (POST)
  - [ ] `/oauth/introspect` - Token introspection (POST)

- [ ] **2.3** Last.fm authentication bridge
  - [ ] Create `src/auth/lastfm-bridge.ts`
  - [ ] Implement `/auth/lastfm/login` endpoint
  - [ ] Implement `/auth/lastfm/callback` endpoint
  - [ ] Bridge Last.fm sessions to OAuth user context

### P1: Session Management Migration
- [ ] **2.4** Update session storage strategy
  - [ ] Migrate from connection-based sessions to OAuth token-based
  - [ ] Update KV storage keys: `oauth:token:*`, `oauth:client:*`
  - [ ] Implement token refresh mechanism
  - [ ] Add token expiration handling

## Phase 3: Transport Layer Refactoring (Week 2)

### P0: SSE Transport Implementation
- [ ] **3.1** Create pure SSE transport
  - [ ] Create `src/transport/sse-native.ts`
  - [ ] Implement Bearer token authentication
  - [ ] Remove mcp-remote compatibility code
  - [ ] Add proper CORS headers for browser-based auth

- [ ] **3.2** Update main worker entry point
  - [ ] Refactor `src/index.ts` for OAuth routing
  - [ ] Remove stdio transport code
  - [ ] Add comprehensive error handling
  - [ ] Implement request logging and monitoring

### P1: MCP Server Updates
- [ ] **3.3** Update MCP server implementation
  - [ ] Create `src/mcp/server-native.ts`
  - [ ] Update tool implementations for OAuth user context
  - [ ] Remove connection ID dependencies
  - [ ] Implement proper capability negotiation

## Phase 4: Testing and Validation (Week 2-3)

### P0: Unit Testing
- [ ] **4.1** OAuth flow testing
  - [ ] Test Dynamic Client Registration
  - [ ] Test authorization flow end-to-end
  - [ ] Test token generation and validation
  - [ ] Test Last.fm auth bridge functionality

- [ ] **4.2** MCP protocol testing
  - [ ] Test all tools with OAuth context
  - [ ] Validate MCP Inspector compatibility
  - [ ] Test SSE transport functionality
  - [ ] Verify error handling and edge cases

### P0: Integration Testing
- [ ] **4.3** End-to-end testing
  - [ ] Test complete auth flow with real Last.fm account
  - [ ] Validate tool functionality with authenticated user
  - [ ] Test rate limiting and caching behavior
  - [ ] Performance testing vs current implementation

- [ ] **4.4** Claude Desktop testing
  - [ ] Configure test Claude Desktop integration
  - [ ] Test authentication flow in Claude Desktop
  - [ ] Validate all tools work correctly
  - [ ] Test error scenarios and recovery

## Phase 5: Deployment and Migration (Week 3)

### P0: Deployment Preparation
- [ ] **5.1** Production configuration
  - [ ] Update `wrangler.toml` for new endpoints
  - [ ] Configure production secrets
  - [ ] Update KV namespace bindings
  - [ ] Add monitoring and alerting

- [ ] **5.2** Migration strategy
  - [ ] Implement backward compatibility endpoint
  - [ ] Create user migration documentation
  - [ ] Plan gradual rollout strategy
  - [ ] Prepare rollback plan

### P0: Production Deployment
- [ ] **5.3** Deploy to production
  - [ ] Deploy OAuth endpoints
  - [ ] Test production OAuth flow
  - [ ] Validate Claude Desktop integration
  - [ ] Monitor for issues and performance

- [ ] **5.4** User communication
  - [ ] Update README.md with new configuration
  - [ ] Create migration guide for existing users
  - [ ] Announce migration timeline
  - [ ] Provide support for migration issues

## Phase 6: Post-Migration (Week 4)

### P1: Monitoring and Optimization
- [ ] **6.1** Performance monitoring
  - [ ] Monitor OAuth flow performance
  - [ ] Track tool usage and errors
  - [ ] Optimize caching strategies
  - [ ] Monitor rate limiting effectiveness

- [ ] **6.2** User feedback and improvements
  - [ ] Collect user feedback on new auth flow
  - [ ] Address any migration issues
  - [ ] Optimize user experience
  - [ ] Document lessons learned

### P2: Cleanup and Documentation
- [ ] **6.3** Code cleanup
  - [ ] Remove mcp-remote compatibility code
  - [ ] Clean up unused endpoints
  - [ ] Update type definitions
  - [ ] Optimize bundle size

- [ ] **6.4** Documentation updates
  - [ ] Update CLAUDE.md with new architecture
  - [ ] Create OAuth implementation documentation
  - [ ] Update development setup instructions
  - [ ] Archive migration documents

## Risk Assessment and Mitigation

### High Risk Items
1. **OAuth Library Compatibility** 
   - Risk: `@cloudflare/workers-oauth-provider` may not exist or be incompatible
   - Mitigation: Research alternative libraries, prepare custom implementation

2. **Last.fm Auth Bridge Complexity**
   - Risk: Bridging Last.fm Web Auth to OAuth may be complex
   - Mitigation: Implement minimal viable bridge, iterate based on testing

3. **User Experience During Migration**
   - Risk: Users may face authentication issues during transition
   - Mitigation: Maintain backward compatibility, provide clear migration instructions

### Medium Risk Items
1. **SSE Transport Implementation**
   - Risk: SSE implementation may need MCP SDK updates
   - Mitigation: Test thoroughly with MCP Inspector, use latest SDK

2. **Token Management Complexity**
   - Risk: OAuth token lifecycle management may be complex
   - Mitigation: Use proven patterns, implement proper error handling

## Success Criteria

### Technical Success
- [ ] Direct connection from Claude Desktop without mcp-remote
- [ ] OAuth 2.0 flow works seamlessly with Dynamic Client Registration
- [ ] All existing tools function correctly with OAuth context
- [ ] Performance equal or better than current implementation
- [ ] Comprehensive error handling and user feedback

### User Experience Success
- [ ] Smooth migration path for existing users
- [ ] Clear authentication flow
- [ ] Reliable session management
- [ ] Minimal disruption during transition

## Timeline Summary

- **Week 1**: Setup, research, and OAuth infrastructure
- **Week 2**: Transport layer refactoring and core testing
- **Week 3**: Integration testing and production deployment
- **Week 4**: Monitoring, optimization, and cleanup

## Next Steps

1. **Start with Phase 1.1** - Verify OAuth library compatibility
2. **Create migration branch** and begin implementation
3. **Focus on OAuth implementation first** - this is the most critical component
4. **Test early and often** with MCP Inspector
5. **Plan for user communication** throughout the process

---

*This plan addresses all the technical issues from previous failed attempts and provides a clear path to native Claude Custom Integration support while maintaining the excellent Last.fm functionality users expect.*