# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General instructions

When we start a new dev session:

1. Open spec.md, prompt_plan.md and todo.md in the /spec directory and identify any prompts not marked as completed.
2. For each incomplete prompt:
    - Double-check if it's truly unfinished (if uncertain, ask for clarification).
    - If you confirm it's already done, skip it.
    - Otherwise, implement it as described. Before starting implementation, provide an ELI5 explanation of what you're about to do
    - Make sure the tests pass, and the program builds/runs
    - Commit the changes to your repository with a clear commit message.
    - Update @todo.md  to mark this prompt as completed.
3. After you finish each prompt, explain what you did and what should now be possible. If I am able to manually test the latest change myself to make sure it works, give me instructions on how I can do that.
4. Pause and wait for user review or feedback.
5. Repeat with the next unfinished prompt as directed by the user.

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

**Transport Layer**: Dual protocol support
- HTTP JSON-RPC: Standard MCP over HTTP POST
- Server-Sent Events: `src/transport/sse.ts` for persistent connections
- mcp-remote compatibility with connection ID handling

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

The system handles both standard MCP clients and mcp-remote:
- Standard clients use SSE connections with explicit connection IDs
- mcp-remote clients get deterministic connection IDs based on client fingerprinting
- Session data is stored per-connection to support multiple concurrent users