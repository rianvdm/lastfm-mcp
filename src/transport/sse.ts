// ABOUTME: Deprecated SSE transport layer kept for backward compatibility.
// ABOUTME: Returns SSE streams but does not track connection state in global memory.

import { JSONRPCResponse } from '../types/jsonrpc'

/**
 * Create an SSE response for a client with optional connection ID.
 *
 * This endpoint is deprecated. Modern MCP clients should use the HTTP
 * transport (POST /) with Mcp-Session-Id headers instead. Auth state
 * is stored in KV, not in-memory.
 */
export function createSSEResponse(providedConnectionId?: string): { response: Response; connectionId: string } {
	const connectionId = providedConnectionId || crypto.randomUUID()
	const encoder = new TextEncoder()

	// Create a TransformStream for the SSE response
	const { readable, writable } = new TransformStream()
	const writer = writable.getWriter()

	// Send initial connection event so legacy clients know where to POST
	const initMessage = `event: endpoint\ndata: ${JSON.stringify({
		endpoint: '/',
		connectionId,
		requiresAuth: true,
		authUrl: `/login?session_id=${connectionId}`,
	})}\n\n`

	writer.write(encoder.encode(initMessage))

	console.warn(`[SSE] Legacy SSE connection created: ${connectionId}. SSE transport is deprecated; use HTTP transport instead.`)

	const response = new Response(readable, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'Access-Control-Allow-Origin': '*',
			'X-Connection-ID': connectionId,
		},
	})

	return { response, connectionId }
}

/**
 * @deprecated SSE connection state is no longer tracked in-memory.
 * Auth state is stored in KV via session:{id} keys.
 */
export function getConnection(_connectionId: string): undefined {
	return undefined
}

/**
 * @deprecated No-op. Auth state is managed via KV, not in-memory connections.
 */
export function broadcastResponse(_connectionId: string, _response: JSONRPCResponse): boolean {
	return false
}

/**
 * @deprecated No-op. SSE connections are not tracked in-memory.
 */
export function isConnectionAuthenticated(_connectionId: string): boolean {
	return false
}

/**
 * @deprecated No-op. SSE connections are not tracked in-memory.
 */
export function authenticateConnection(_connectionId: string, _userId: string): boolean {
	return false
}

/**
 * @deprecated No-op. SSE connections are not tracked in-memory.
 */
export function getConnectionUserId(_connectionId: string): string | undefined {
	return undefined
}

/**
 * @deprecated No-op. SSE connections are not tracked in-memory.
 */
export function closeConnection(_connectionId: string): void {
	// No-op
}

/**
 * @deprecated Always returns 0. SSE connections are not tracked in-memory.
 */
export function getActiveConnectionCount(): number {
	return 0
}

/**
 * @deprecated Always returns empty array. SSE connections are not tracked in-memory.
 */
export function getActiveConnections(): Array<{ id: string; isAuthenticated: boolean; userId?: string; lastActivity: number }> {
	return []
}

/**
 * @deprecated No-op. SSE connections are not tracked in-memory.
 */
export function cleanupConnections(): void {
	// No-op
}
