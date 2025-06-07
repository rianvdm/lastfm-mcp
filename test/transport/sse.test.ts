import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
	createSSEResponse,
	sendSSEMessage,
	broadcastResponse,
	getConnection,
	closeConnection,
	getActiveConnectionCount,
	cleanupConnections,
} from '../../src/transport/sse'
import { createResponse } from '../../src/protocol/parser'

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
	randomUUID: () => 'test-uuid-' + Math.random().toString(36).substring(7),
})

describe('SSE Transport', () => {
	beforeEach(() => {
		// Clean up any existing connections
		cleanupConnections()
	})

	describe('createSSEResponse', () => {
		it('should create an SSE response with connection ID', () => {
			const { response, connectionId } = createSSEResponse()

			expect(response).toBeInstanceOf(Response)
			expect(response.headers.get('content-type')).toBe('text/event-stream')
			expect(response.headers.get('cache-control')).toBe('no-cache')
			expect(connectionId).toMatch(/^test-uuid-/)
		})

		it('should store the connection', () => {
			const { connectionId } = createSSEResponse()
			const connection = getConnection(connectionId)

			expect(connection).toBeDefined()
			expect(connection?.id).toBe(connectionId)
		})

		it('should track active connections', () => {
			const initialCount = getActiveConnectionCount()

			const { connectionId: id1 } = createSSEResponse()
			expect(getActiveConnectionCount()).toBe(initialCount + 1)

			const { connectionId: id2 } = createSSEResponse()
			expect(getActiveConnectionCount()).toBe(initialCount + 2)

			closeConnection(id1)
			expect(getActiveConnectionCount()).toBe(initialCount + 1)

			closeConnection(id2)
			expect(getActiveConnectionCount()).toBe(initialCount)
		})
	})

	describe('sendSSEMessage', () => {
		it('should send formatted SSE message', () => {
			const { connectionId } = createSSEResponse()
			const connection = getConnection(connectionId)!

			// Mock the writer
			const writeSpy = vi.spyOn(connection.writer, 'write').mockResolvedValue()

			sendSSEMessage(connection, 'test-event', { data: 'test' })

			expect(writeSpy).toHaveBeenCalled()
			const call = writeSpy.mock.calls[0][0] as Uint8Array
			const message = new TextDecoder().decode(call)
			expect(message).toBe('event: test-event\ndata: {"data":"test"}\n\n')
		})

		it('should update last activity timestamp', () => {
			const { connectionId } = createSSEResponse()
			const connection = getConnection(connectionId)!
			const initialActivity = connection.lastActivity

			// Mock the writer
			vi.spyOn(connection.writer, 'write').mockResolvedValue()

			// Wait a bit to ensure timestamp changes
			setTimeout(() => {
				sendSSEMessage(connection, 'test', {})
				expect(connection.lastActivity).toBeGreaterThan(initialActivity)
			}, 10)
		})
	})

	describe('broadcastResponse', () => {
		it('should broadcast JSON-RPC response to connection', () => {
			const { connectionId } = createSSEResponse()
			const connection = getConnection(connectionId)!

			// Mock the writer
			const writeSpy = vi.spyOn(connection.writer, 'write').mockResolvedValue()

			const response = createResponse(1, { result: 'test' })
			const success = broadcastResponse(connectionId, response)

			expect(success).toBe(true)
			expect(writeSpy).toHaveBeenCalled()

			const call = writeSpy.mock.calls[0][0] as Uint8Array
			const message = new TextDecoder().decode(call)
			expect(message).toContain('event: message')
			expect(message).toContain('"jsonrpc":"2.0"')
		})

		it('should return false for invalid connection ID', () => {
			const response = createResponse(1, { result: 'test' })
			const success = broadcastResponse('invalid-id', response)

			expect(success).toBe(false)
		})
	})

	describe('closeConnection', () => {
		it('should close and remove connection', () => {
			const { connectionId } = createSSEResponse()
			const connection = getConnection(connectionId)!

			// Mock the writer close
			const closeSpy = vi.spyOn(connection.writer, 'close').mockResolvedValue()

			closeConnection(connectionId)

			expect(closeSpy).toHaveBeenCalled()
			expect(getConnection(connectionId)).toBeUndefined()
		})

		it('should handle already closed connections', () => {
			const { connectionId } = createSSEResponse()

			closeConnection(connectionId)
			// Should not throw when closing again
			expect(() => closeConnection(connectionId)).not.toThrow()
		})
	})

	describe('cleanupConnections', () => {
		it('should remove stale connections', () => {
			const { connectionId } = createSSEResponse()
			const connection = getConnection(connectionId)!

			// Set last activity to old timestamp (6 minutes ago)
			connection.lastActivity = Date.now() - 6 * 60 * 1000

			cleanupConnections()

			expect(getConnection(connectionId)).toBeUndefined()
		})

		it('should keep active connections', () => {
			const { connectionId } = createSSEResponse()

			cleanupConnections()

			expect(getConnection(connectionId)).toBeDefined()
		})
	})
})
