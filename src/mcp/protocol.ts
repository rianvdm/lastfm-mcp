// ABOUTME: MCP protocol revision and server version this server advertises in hand-maintained surfaces.
// ABOUTME: The SDK negotiates the wire version itself; these constants only feed the discovery card, health check, and server_info text.

/**
 * The stateless MCP revision the server speaks natively. Older clients still
 * negotiate the legacy `initialize` lane through the SDK's compatibility fallback.
 *
 * Kept as a repo constant because @modelcontextprotocol/server@2.0.0 exports
 * LATEST_PROTOCOL_VERSION as the latest *legacy* revision (2025-11-25), not this one.
 */
export const PROTOCOL_VERSION = '2026-07-28'

/**
 * The released server version, advertised by `server_info`, the discovery card,
 * `/health`, and the MCP handshake. Kept here so the three call sites cannot drift
 * apart again; bump it alongside package.json and the git tag on release.
 */
export const SERVER_VERSION = '2.5.0'
