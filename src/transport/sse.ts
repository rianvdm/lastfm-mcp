/**
 * Server-Sent Events (SSE) Transport for MCP
 * Manages bidirectional communication with clients
 */

import { JSONRPCResponse } from '../types/jsonrpc'

// Store active SSE connections
const connections = new Map<string, SSEConnection>()

interface SSEConnection {
	id: string
	writer: WritableStreamDefaultWriter<Uint8Array>
	encoder: TextEncoder
	lastActivity: number
}

/**
 * Create an SSE response for a client
 */
export function createSSEResponse(): { response: Response; connectionId: string } {
	const connectionId = crypto.randomUUID()
	const encoder = new TextEncoder()

	// Create a TransformStream for SSE
	const { readable, writable } = new TransformStream()
	const writer = writable.getWriter()

	// Store connection
	const connection: SSEConnection = {
		id: connectionId,
		writer,
		encoder,
		lastActivity: Date.now(),
	}
	connections.set(connectionId, connection)

	// Send initial connection event with endpoint info
	sendSSEMessage(connection, 'endpoint', {
		endpoint: '/', // Main JSON-RPC endpoint
		connectionId,
	})

	// Set up keepalive
	const keepaliveInterval = setInterval(() => {
		if (!connections.has(connectionId)) {
			clearInterval(keepaliveInterval)
			return
		}

		// Send keepalive comment
		try {
			writer.write(encoder.encode(':keepalive\n\n'))
			connection.lastActivity = Date.now()
		} catch {
			// Connection closed
			connections.delete(connectionId)
			clearInterval(keepaliveInterval)
		}
	}, 30000) // Every 30 seconds

	// Clean up on close
	writer.closed
		.then(() => {
			connections.delete(connectionId)
			clearInterval(keepaliveInterval)
		})
		.catch(() => {
			connections.delete(connectionId)
			clearInterval(keepaliveInterval)
		})

	const response = new Response(readable, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'Access-Control-Allow-Origin': '*',
		},
	})

	return { response, connectionId }
}

/**
 * Send a message to a specific SSE connection
 */
export function sendSSEMessage(connection: SSEConnection, event: string, data: unknown): void {
	try {
		const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
		connection.writer.write(connection.encoder.encode(message))
		connection.lastActivity = Date.now()
	} catch (error) {
		console.error('Failed to send SSE message:', error)
		connections.delete(connection.id)
	}
}

/**
 * Broadcast a JSON-RPC response to a specific connection
 */
export function broadcastResponse(connectionId: string, response: JSONRPCResponse): boolean {
	const connection = connections.get(connectionId)
	if (!connection) {
		return false
	}

	sendSSEMessage(connection, 'message', response)
	return true
}

/**
 * Get active connection by ID
 */
export function getConnection(connectionId: string): SSEConnection | undefined {
	return connections.get(connectionId)
}

/**
 * Close a connection
 */
export function closeConnection(connectionId: string): void {
	const connection = connections.get(connectionId)
	if (connection) {
		try {
			connection.writer.close()
		} catch {
			// Already closed
		}
		connections.delete(connectionId)
	}
}

/**
 * Get number of active connections
 */
export function getActiveConnectionCount(): number {
	return connections.size
}

/**
 * Clean up stale connections (for testing)
 */
export function cleanupConnections(): void {
	const now = Date.now()
	const timeout = 5 * 60 * 1000 // 5 minutes

	for (const [id, connection] of connections) {
		if (now - connection.lastActivity > timeout) {
			closeConnection(id)
		}
	}
}
