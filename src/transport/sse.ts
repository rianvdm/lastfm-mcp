/**
 * Server-Sent Events (SSE) Transport for MCP
 * Manages bidirectional communication with clients and per-connection authentication
 */

import { JSONRPCResponse } from '../types/jsonrpc'

// Store active SSE connections with enhanced tracking
const connections = new Map<string, SSEConnection>()

interface SSEConnection {
	id: string
	writer: WritableStreamDefaultWriter<Uint8Array>
	encoder: TextEncoder
	lastActivity: number
	isAuthenticated: boolean
	userId?: string
	createdAt: number
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

	// Store connection with authentication tracking
	const connection: SSEConnection = {
		id: connectionId,
		writer,
		encoder,
		lastActivity: Date.now(),
		isAuthenticated: false,
		createdAt: Date.now(),
	}
	connections.set(connectionId, connection)

	// Send the required endpoint event for MCP compatibility
	// The endpoint event tells the client where to send JSON-RPC requests
	// Note: endpoint data should be sent as plain text, not JSON
	try {
		const message = `event: endpoint\ndata: /sse\n\n`
		connection.writer.write(connection.encoder.encode(message))
		connection.lastActivity = Date.now()
	} catch (error) {
		console.error('Failed to send endpoint event:', error)
		connections.delete(connection.id)
	}

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
			'X-Connection-ID': connectionId, // Include connection ID in headers
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
 * Update connection authentication status
 */
export function authenticateConnection(connectionId: string, userId: string): boolean {
	const connection = connections.get(connectionId)
	if (!connection) {
		return false
	}

	connection.isAuthenticated = true
	connection.userId = userId
	connection.lastActivity = Date.now()

	// Send authentication success event
	sendSSEMessage(connection, 'authenticated', {
		connectionId,
		userId,
		message: 'Authentication successful',
	})

	return true
}

/**
 * Check if connection is authenticated
 */
export function isConnectionAuthenticated(connectionId: string): boolean {
	const connection = connections.get(connectionId)
	return connection?.isAuthenticated ?? false
}

/**
 * Get user ID for authenticated connection
 */
export function getConnectionUserId(connectionId: string): string | undefined {
	const connection = connections.get(connectionId)
	return connection?.isAuthenticated ? connection.userId : undefined
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
 * Get all active connections (for debugging/monitoring)
 */
export function getActiveConnections(): Array<{ id: string; isAuthenticated: boolean; userId?: string; lastActivity: number }> {
	return Array.from(connections.values()).map((conn) => ({
		id: conn.id,
		isAuthenticated: conn.isAuthenticated,
		userId: conn.userId,
		lastActivity: conn.lastActivity,
	}))
}

/**
 * Clean up stale connections
 */
export function cleanupConnections(): void {
	const now = Date.now()
	const INACTIVE_TIMEOUT = 30 * 60 * 1000 // 30 minutes
	const MAX_AGE = 7 * 24 * 60 * 60 * 1000 // 7 days

	for (const [connectionId, connection] of connections) {
		const inactive = now - connection.lastActivity > INACTIVE_TIMEOUT
		const expired = now - connection.createdAt > MAX_AGE

		if (inactive || expired) {
			console.log(`Cleaning up connection ${connectionId} - inactive: ${inactive}, expired: ${expired}`)
			closeConnection(connectionId)
		}
	}
}
