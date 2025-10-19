# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# General instructions for completing tasks:

- Before starting implementation, provide an ELI5 explanation of what you're about to do
- Once implemented:
  - Make sure the tests pass, and the program builds/runs
  - Commit the changes to the repository with a clear commit message.
  - Explain what you did and what should now be possible. If I am able to manually test the latest change myself to make sure it works, give me instructions on how I can do that.
- Pause and wait for user review or feedback.

# Writing code

- We prefer simple, clean, maintainable solutions over clever or complex ones, even if the latter are more concise or performant. Readability and maintainability are primary concerns.
- Write code that works today but can grow tomorrow. Avoid premature optimization, but don't paint yourself into architectural corners.
- Make the smallest reasonable changes to get to the desired outcome. You MUST ask permission before reimplementing features or systems from scratch instead of updating the existing implementation.
- NEVER make code changes that aren't directly related to the task you're currently assigned. If you notice something that should be fixed but is unrelated to your current task, document it as a new item in `todo.md` with priority level (P0/P1/P2).
- Only remove comments that are demonstrably incorrect or misleading.
- All code files should start with a brief 2 line comment explaining what the file does. Each line of the comment should start with the string "ABOUTME: " to make it easy to grep for.
- When writing comments, avoid referring to temporal context about refactors or recent changes. Comments should be evergreen and describe the code as it is, not how it evolved or was recently changed.
- Handle errors gracefully with clear, actionable messages. Fail fast for programming errors, recover gracefully for user/external errors.
- Minimize external dependencies. When adding new dependencies, justify the choice and document the decision.
- Avoid mocks for core business logic, but they're acceptable for external APIs during development.
- When you are trying to fix a bug or compilation error or any other issue, YOU MUST NEVER throw away the old implementation and rewrite without explicit permission from the user. If you are going to do this, YOU MUST STOP and get explicit permission from the user.
- NEVER name things as 'improved' or 'new' or 'enhanced', etc. Code naming should be evergreen. What is new today will be "old" someday.
- Update README.md when adding new features or changing how the project works. Keep setup/usage instructions current.

# Getting help

- ALWAYS ask for clarification rather than making assumptions.
- If you're having trouble with something, it's ok to stop and ask for help. Especially if it's something your human might be better at.

# Testing

- All projects need comprehensive tests. Start with the most critical test type for the project's scope and add others as complexity grows.
- Tests MUST cover the functionality being implemented.
- NEVER ignore the output of the system or the tests - Logs and messages often contain CRITICAL information.
- TEST OUTPUT MUST BE PRISTINE TO PASS.
- If tests time out, run them in smaller chunks to ensure all tests are completed and pass. (Use `--reporter=basic` first, if needed.)
- If the logs are supposed to contain errors, capture and test it.

## Development Commands

### Core Development

- `npm run dev` - Start development server on localhost:8787
- `npm run build` - Build check with dry-run deployment
- `npm test` - Run test suite with Vitest
- `npm run lint` - Run ESLint on TypeScript files
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting

### Deployment

- `npm run deploy` - Deploy to development environment
- `npm run deploy:prod` - Deploy to production environment
- `npm run setup:prod` - Setup production secrets and configuration
- **Auto-deployment**: The worker auto-deploys via GitHub Actions on push to main branch

### Testing

- `npm run test:multi-user` - Run multi-user integration tests
- Individual test files can be run with: `npx vitest test/path/to/test.spec.ts`

## Architecture Overview

This is a **Last.fm MCP (Model Context Protocol) Server** built as a Cloudflare Worker that provides AI assistants access to Last.fm music data.

### Core Architecture Components

**Runtime Environment**: Cloudflare Workers with global edge deployment

- Main entry point: `src/index.ts`
- Worker configuration: `wrangler.toml`
- Environment types: `src/types/env.ts`

**Protocol Implementation**: MCP 2024-11-05 specification

- Protocol handlers: `src/protocol/handlers.ts`
- Message parsing: `src/protocol/parser.ts`
- Request validation: `src/protocol/validation.ts`

**Authentication System**: Last.fm Web Auth + JWT sessions

- Last.fm OAuth: `src/auth/lastfm.ts`
- JWT session management: `src/auth/jwt.ts`
- Session storage in Cloudflare KV

**Data Access Layer**: Cached Last.fm API clients

- Base client: `src/clients/lastfm.ts`
- Cached wrapper: `src/clients/cachedLastfm.ts`
- Rate limiting and retry logic built-in

**Transport Layer**: Multiple transport options for MCP clients

- **HTTP Transport** (Recommended): Standard MCP over HTTP POST with `Mcp-Session-Id` header for session management
- **Server-Sent Events**: `src/transport/sse.ts` for legacy persistent connections
- Backward compatibility with mcp-remote via deterministic connection ID generation

**Storage & Performance**:

- **MCP_SESSIONS**: User authentication sessions and caching
- **MCP_LOGS**: Request logging and analytics
- **MCP_RL**: Rate limiting counters
- Smart caching with optimized TTLs per endpoint type

### Key Endpoints

- `/` - Main MCP JSON-RPC endpoint
- `/sse` - Server-Sent Events endpoint for persistent MCP connections
- `/login` - Last.fm authentication initiation
- `/callback` - Last.fm OAuth callback handler
- `/mcp-auth` - Programmatic authentication status
- `/health` - Health check endpoint

### Environment Configuration

Development uses `.dev.vars`, production uses Wrangler secrets:

- `LASTFM_API_KEY` - Last.fm API key
- `LASTFM_SHARED_SECRET` - Last.fm shared secret
- `JWT_SECRET` - JWT signing secret

### MCP Implementation Details

**Tools**: Personal listening data (requires auth) + public music info
**Resources**: URI-based access to Last.fm data (lastfm://user/{username}/recent, etc.)
**Prompts**: Music analysis and recommendation prompts

### Testing Strategy

- Unit tests with Vitest and Cloudflare Workers test pool
- Integration tests for MCP protocol compliance
- Multi-user session testing
- Rate limiting and caching validation
- Authentication flow testing

### Connection Management

The server supports multiple connection strategies to accommodate different MCP clients:

**Modern HTTP Transport (Claude Code, MCP Inspector)**:
- Uses `Mcp-Session-Id` header for session identification
- Session ID generated on `initialize` request and returned in response header
- Clients include the session ID in subsequent requests
- Session data stored in KV with `session:{sessionId}` key pattern
- Auth state persists across requests via session-specific storage

**Legacy SSE Transport (mcp-remote)**:
- Deterministic connection IDs based on client fingerprinting (IP + User-Agent)
- Connection IDs stable for 7-day windows to maintain session continuity
- Backward compatible with X-Connection-ID header
- Automatic fallback for clients without explicit session management

**Session Storage**:
- All session data stored in Cloudflare KV namespace `MCP_SESSIONS`
- Authentication tokens linked to session/connection IDs
- 7-day TTL matching JWT token expiration
- Supports multiple concurrent users with isolated sessions
