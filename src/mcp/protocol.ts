// ABOUTME: MCP protocol revision this server advertises in hand-maintained surfaces.
// ABOUTME: The SDK negotiates the wire version itself; this constant only feeds the discovery card and server_info text.

/**
 * The stateless MCP revision the server speaks natively. Older clients still
 * negotiate the legacy `initialize` lane through the SDK's compatibility fallback.
 *
 * Kept as a repo constant because @modelcontextprotocol/server@2.0.0 exports
 * LATEST_PROTOCOL_VERSION as the latest *legacy* revision (2025-11-25), not this one.
 */
export const PROTOCOL_VERSION = '2026-07-28'
