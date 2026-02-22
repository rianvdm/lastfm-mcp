import { describe, it, expect, vi } from 'vitest'
import {
	createSSEResponse,
	broadcastResponse,
	getConnection,
	closeConnection,
	getActiveConnectionCount,
	cleanupConnections,
	isConnectionAuthenticated,
} from '../../src/transport/sse'
import { createResponse } from '../../src/protocol/parser'

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
	randomUUID: () => 'test-uuid-' + Math.random().toString(36).substring(7),
})

describe('SSE Transport (deprecated — stub functions)', () => {
	describe('createSSEResponse', () => {
		it('should create an SSE response with connection ID', () => {
			const { response, connectionId } = createSSEResponse()

			expect(response).toBeInstanceOf(Response)
			expect(response.headers.get('content-type')).toBe('text/event-stream')
			expect(response.headers.get('cache-control')).toBe('no-cache')
			expect(connectionId).toMatch(/^test-uuid-/)
		})

		it('should use provided connection ID when given', () => {
			const { connectionId } = createSSEResponse('my-custom-id')
			expect(connectionId).toBe('my-custom-id')
		})
	})

	describe('deprecated stub functions', () => {
		it('getConnection always returns undefined', () => {
			expect(getConnection('any-id')).toBeUndefined()
		})

		it('broadcastResponse always returns false', () => {
			const response = createResponse(1, { result: 'test' })
			expect(broadcastResponse('any-id', response)).toBe(false)
		})

		it('isConnectionAuthenticated always returns false', () => {
			expect(isConnectionAuthenticated('any-id')).toBe(false)
		})

		it('getActiveConnectionCount always returns 0', () => {
			expect(getActiveConnectionCount()).toBe(0)
		})

		it('closeConnection does not throw', () => {
			expect(() => closeConnection('any-id')).not.toThrow()
		})

		it('cleanupConnections does not throw', () => {
			expect(() => cleanupConnections()).not.toThrow()
		})
	})
})
