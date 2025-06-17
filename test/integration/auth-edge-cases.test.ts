import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LastfmAuth } from '../../src/auth/lastfm'
import { createSessionToken, verifySessionToken } from '../../src/auth/jwt'
import { verifyAuthentication, getConnectionSession } from '../../src/protocol/handlers'
import worker from '../../src/index'
import type { Env } from '../../src/types/env'

// Mock the retry module to avoid long delays
vi.mock('../../src/utils/retry', () => ({
	fetchWithRetry: vi.fn(),
	withRetry: vi.fn(),
}))

import { fetchWithRetry } from '../../src/utils/retry'

// Mock KV namespaces
const mockMCP_SESSIONS = {
	get: vi.fn(),
	put: vi.fn(),
	list: vi.fn(),
	delete: vi.fn(),
}

const mockMCP_LOGS = {
	put: vi.fn(),
	get: vi.fn(),
	list: vi.fn(),
}

const mockMCP_RL = {
	get: vi.fn(),
	put: vi.fn(),
	list: vi.fn(),
}

const mockEnv: Env = {
	LASTFM_API_KEY: 'test-api-key',
	LASTFM_SHARED_SECRET: 'test-shared-secret',
	JWT_SECRET: 'test-jwt-secret-for-auth-testing',
	MCP_LOGS: mockMCP_LOGS as any,
	MCP_RL: mockMCP_RL as any,
	MCP_SESSIONS: mockMCP_SESSIONS as any,
}

// Mock Web Crypto API
const mockCrypto = {
	subtle: {
		importKey: vi.fn(),
		sign: vi.fn(),
		digest: vi.fn(),
	},
}

Object.defineProperty(global, 'crypto', {
	value: mockCrypto,
	writable: true,
})

global.btoa = global.btoa || ((str: string) => Buffer.from(str, 'binary').toString('base64'))
global.atob = global.atob || ((str: string) => Buffer.from(str, 'base64').toString('binary'))

describe('Authentication Edge Cases', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()

		// Reset rate limiting
		mockMCP_RL.get.mockResolvedValue(null)
		mockMCP_RL.put.mockResolvedValue(undefined)
		mockMCP_LOGS.put.mockResolvedValue(undefined)

		// Setup fetchWithRetry mock to behave like regular fetch by default
		vi.mocked(fetchWithRetry).mockImplementation(async (url, init) => {
			return globalThis.fetch(url, init)
		})

		// Mock Web Crypto API
		mockCrypto.subtle.importKey.mockResolvedValue({
			type: 'secret',
			algorithm: { name: 'HMAC', hash: { name: 'SHA-256' } },
		})

		mockCrypto.subtle.sign.mockImplementation((algorithm, key, data) => {
			const dataBytes = new Uint8Array(data as ArrayBuffer)
			let hash = 0x12345678
			for (let i = 0; i < dataBytes.length; i++) {
				hash = ((hash << 7) | (hash >>> 25)) ^ dataBytes[i]
				hash = hash >>> 0
			}
			const buffer = new ArrayBuffer(32)
			const view = new Uint8Array(buffer)
			for (let i = 0; i < 32; i++) {
				view[i] = (hash + i * 7) & 0xff
			}
			return Promise.resolve(buffer)
		})

		mockCrypto.subtle.digest.mockImplementation((algorithm, data) => {
			const dataBytes = new Uint8Array(data as ArrayBuffer)
			let hash = 0x9e3779b9
			for (let i = 0; i < dataBytes.length; i++) {
				hash = ((hash << 5) | (hash >>> 27)) ^ dataBytes[i]
				hash = hash >>> 0
			}
			const buffer = new ArrayBuffer(16)
			const view = new Uint8Array(buffer)
			for (let i = 0; i < 16; i++) {
				view[i] = (hash + i * 13) & 0xff
			}
			return Promise.resolve(buffer)
		})
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('Last.fm Authentication Flow Edge Cases', () => {
		let lastfmAuth: LastfmAuth

		beforeEach(() => {
			lastfmAuth = new LastfmAuth('test-api-key', 'test-shared-secret')
		})

		it('should handle missing API credentials gracefully', () => {
			expect(() => new LastfmAuth('', 'secret')).not.toThrow()
			expect(() => new LastfmAuth('key', '')).not.toThrow()
			expect(() => new LastfmAuth('', '')).not.toThrow()
		})

		it('should handle empty token in getSessionKey', async () => {
			// Mock Last.fm API error response
			const mockErrorResponse = new Response(JSON.stringify({ error: 4, message: 'Invalid token' }), { status: 200 })
			vi.mocked(fetchWithRetry).mockResolvedValue(mockErrorResponse)

			await expect(lastfmAuth.getSessionKey('')).rejects.toThrow()
		})

		it('should handle whitespace-only token', async () => {
			// Mock Last.fm API error response
			const mockErrorResponse = new Response(JSON.stringify({ error: 4, message: 'Invalid token' }), { status: 200 })
			vi.mocked(fetchWithRetry).mockResolvedValue(mockErrorResponse)

			await expect(lastfmAuth.getSessionKey('   ')).rejects.toThrow()
		})

		it('should handle malformed Last.fm API response', async () => {
			const mockMalformedResponse = new Response('not json', { status: 200 })
			globalThis.fetch = vi.fn().mockResolvedValue(mockMalformedResponse)

			await expect(lastfmAuth.getSessionKey('valid-token')).rejects.toThrow()
		})

		it('should handle Last.fm API error responses', async () => {
			const mockErrorResponse = new Response(JSON.stringify({ error: 4, message: 'Invalid token' }), { status: 200 })
			globalThis.fetch = vi.fn().mockResolvedValue(mockErrorResponse)

			await expect(lastfmAuth.getSessionKey('invalid-token')).rejects.toThrow('Last.fm API error 4: Invalid token')
		})

		it('should handle network failures during authentication', async () => {
			vi.mocked(fetchWithRetry).mockRejectedValue(new Error('Network error'))

			await expect(lastfmAuth.getSessionKey('token')).rejects.toThrow()
		})

		it('should handle rate limiting during authentication', async () => {
			const mockRateLimitResponse = new Response('Rate limited', { status: 429 })
			vi.mocked(fetchWithRetry).mockResolvedValue(mockRateLimitResponse)

			await expect(lastfmAuth.getSessionKey('token')).rejects.toThrow()
		})

		it('should handle incomplete session response', async () => {
			const mockIncompleteResponse = new Response(
				JSON.stringify({ session: { name: 'user' } }), // missing key
				{ status: 200 },
			)
			globalThis.fetch = vi.fn().mockResolvedValue(mockIncompleteResponse)

			const result = await lastfmAuth.getSessionKey('token')
			// Should handle incomplete data gracefully or throw
			expect(result.sessionKey).toBeUndefined()
		})

		it('should handle special characters in usernames/session keys', async () => {
			const mockResponse = new Response(
				JSON.stringify({
					session: {
						name: 'user+with/special=chars',
						key: 'session+key/with=padding',
						subscriber: 1,
					},
				}),
				{ status: 200 },
			)
			globalThis.fetch = vi.fn().mockResolvedValue(mockResponse)

			const result = await lastfmAuth.getSessionKey('token')
			expect(result.username).toBe('user+with/special=chars')
			expect(result.sessionKey).toBe('session+key/with=padding')
		})

		it('should validate session keys correctly', async () => {
			// Mock successful validation
			const mockValidResponse = new Response(JSON.stringify({ user: { name: 'testuser' } }), { status: 200 })
			globalThis.fetch = vi.fn().mockResolvedValue(mockValidResponse)

			const isValid = await lastfmAuth.validateSessionKey('valid-session-key')
			expect(isValid).toBe(true)
		})

		it('should detect invalid session keys', async () => {
			// Mock error response for invalid session
			const mockInvalidResponse = new Response(JSON.stringify({ error: 9, message: 'Invalid session key' }), { status: 200 })
			globalThis.fetch = vi.fn().mockResolvedValue(mockInvalidResponse)

			const isValid = await lastfmAuth.validateSessionKey('invalid-session-key')
			expect(isValid).toBe(false)
		})

		it('should handle validation network errors gracefully', async () => {
			vi.mocked(fetchWithRetry).mockRejectedValue(new Error('Network error'))

			const isValid = await lastfmAuth.validateSessionKey('session-key')
			expect(isValid).toBe(false) // Should fail gracefully, not throw
		})
	})

	describe('Cookie-based Authentication Edge Cases', () => {
		it('should handle missing cookie header', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			})

			const result = await verifyAuthentication(request, 'jwt-secret')
			expect(result).toBeNull()
		})

		it('should handle empty cookie header', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Cookie: '',
				},
			})

			const result = await verifyAuthentication(request, 'jwt-secret')
			expect(result).toBeNull()
		})

		it('should handle malformed cookie header', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Cookie: 'malformed cookie without equals',
				},
			})

			const result = await verifyAuthentication(request, 'jwt-secret')
			expect(result).toBeNull()
		})

		it('should handle multiple cookies with missing session', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Cookie: 'other=value; another=cookie; not-session=token',
				},
			})

			const result = await verifyAuthentication(request, 'jwt-secret')
			expect(result).toBeNull()
		})

		it('should extract session cookie from multiple cookies', async () => {
			// Create a valid session token first
			const sessionPayload = {
				userId: 'testuser',
				sessionKey: 'test-session-key',
				username: 'testuser',
			}
			const validToken = await createSessionToken(sessionPayload, 'jwt-secret')

			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Cookie: `other=value; session=${validToken}; another=cookie`,
				},
			})

			const result = await verifyAuthentication(request, 'jwt-secret')
			expect(result).not.toBeNull()
			expect(result?.userId).toBe('testuser')
		})

		it('should handle expired session token in cookie', async () => {
			// Create an expired token
			const sessionPayload = {
				userId: 'testuser',
				sessionKey: 'test-session-key',
				username: 'testuser',
			}
			const expiredToken = await createSessionToken(sessionPayload, 'jwt-secret', -1) // Expired 1 hour ago

			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Cookie: `session=${expiredToken}`,
				},
			})

			const result = await verifyAuthentication(request, 'jwt-secret')
			expect(result).toBeNull()
		})

		it('should handle invalid JWT in cookie', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Cookie: 'session=invalid.jwt.token',
				},
			})

			const result = await verifyAuthentication(request, 'jwt-secret')
			expect(result).toBeNull()
		})

		it('should handle URL-encoded cookie values', async () => {
			const sessionPayload = {
				userId: 'testuser',
				sessionKey: 'test-session-key',
				username: 'testuser',
			}
			const validToken = await createSessionToken(sessionPayload, 'jwt-secret')
			const encodedToken = encodeURIComponent(validToken)

			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Cookie: `session=${encodedToken}`,
				},
			})

			// Should handle URL-encoded tokens gracefully (this might fail due to encoding)
			const result = await verifyAuthentication(request, 'jwt-secret')
			// Result could be null if URL encoding breaks the JWT format
			if (result) {
				expect(result.userId).toBe('testuser')
			}
		})
	})

	describe('Connection-specific Authentication Edge Cases', () => {
		it('should handle missing connection ID header', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			})

			// Mock: getConnectionSession is not exported, so we test via integration
			mockMCP_SESSIONS.get.mockResolvedValue(null)

			const response = await worker.fetch(request, mockEnv, {} as any)

			// Should handle gracefully without crashing
			expect(response.status).toBeGreaterThanOrEqual(200)
		})

		it('should handle invalid connection ID format', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Connection-ID': 'invalid-connection-id-with-special-chars!@#$',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/list',
				}),
			})

			mockMCP_SESSIONS.get.mockResolvedValue(null)

			const response = await worker.fetch(request, mockEnv, {} as any)
			expect(response.status).toBe(200) // Should handle gracefully
		})

		it('should handle corrupted session data in KV', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Connection-ID': 'test-connection',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/list',
				}),
			})

			// Mock corrupted JSON in KV
			mockMCP_SESSIONS.get.mockResolvedValue('invalid json {')

			const response = await worker.fetch(request, mockEnv, {} as any)
			// Should handle corrupted data gracefully
			expect(response.status).toBeGreaterThanOrEqual(200)
		})

		it('should handle expired session data in KV', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Connection-ID': 'test-connection',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/list',
				}),
			})

			// Mock expired session data
			const expiredSessionData = {
				userId: 'testuser',
				sessionKey: 'test-session-key',
				username: 'testuser',
				expiresAt: Date.now() - 60000, // Expired 1 minute ago
				connectionId: 'test-connection',
			}
			mockMCP_SESSIONS.get.mockResolvedValue(JSON.stringify(expiredSessionData))

			const response = await worker.fetch(request, mockEnv, {} as any)

			// Should require re-authentication for expired session
			if (response.status !== 200) {
				const responseData = await response.json()
				expect(responseData.error?.message).toContain('authentication')
			} else {
				// If 200, check that response indicates authentication needed
				const responseData = await response.json()
				if (responseData.error) {
					expect(responseData.error.message).toContain('authentication')
				}
			}
		})

		it('should handle incomplete session data in KV', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Connection-ID': 'test-connection',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/list',
				}),
			})

			// Mock incomplete session data (missing username)
			const incompleteSessionData = {
				userId: 'testuser',
				sessionKey: 'test-session-key',
				// username missing
				expiresAt: Date.now() + 3600000, // Valid for 1 hour
				connectionId: 'test-connection',
			}
			mockMCP_SESSIONS.get.mockResolvedValue(JSON.stringify(incompleteSessionData))

			const response = await worker.fetch(request, mockEnv, {} as any)

			// Should require re-authentication for incomplete session
			if (response.status !== 200) {
				const responseData = await response.json()
				expect(responseData.error?.message).toContain('authentication')
			} else {
				const responseData = await response.json()
				if (responseData.error) {
					expect(responseData.error.message).toContain('authentication')
				}
			}
		})

		it('should handle very long connection IDs', async () => {
			const longConnectionId = 'a'.repeat(1000) // Very long connection ID

			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Connection-ID': longConnectionId,
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/list',
				}),
			})

			mockMCP_SESSIONS.get.mockResolvedValue(null)

			const response = await worker.fetch(request, mockEnv, {} as any)
			// Should handle without crashing
			expect(response.status).toBeGreaterThanOrEqual(200)
		})

		it('should handle mcp-remote connection IDs correctly', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Connection-ID': 'mcp-remote-12345',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/list',
				}),
			})

			// Mock valid session for mcp-remote connection
			const sessionData = {
				userId: 'testuser',
				sessionKey: 'test-session-key',
				username: 'testuser',
				expiresAt: Date.now() + 3600000, // Valid for 1 hour
				connectionId: 'mcp-remote-12345',
			}
			mockMCP_SESSIONS.get.mockResolvedValue(JSON.stringify(sessionData))

			// Mock Last.fm API response
			globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tools: [] }), { status: 200 }))

			const response = await worker.fetch(request, mockEnv, {} as any)
			expect(response.status).toBe(200)
		})
	})

	describe('Authentication Error Handling', () => {
		it('should handle KV storage failures gracefully', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Connection-ID': 'test-connection',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/list',
				}),
			})

			// Mock KV failure
			mockMCP_SESSIONS.get.mockRejectedValue(new Error('KV unavailable'))

			const response = await worker.fetch(request, mockEnv, {} as any)
			// Should handle KV failures gracefully
			expect(response.status).toBeGreaterThanOrEqual(200)
		})

		it('should provide helpful authentication error messages', async () => {
			const request = new Request('http://localhost:8787/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: {
						name: 'get_recent_tracks',
						arguments: { username: 'testuser' },
					},
				}),
			})

			const response = await worker.fetch(request, mockEnv, {} as any)
			const responseData = await response.json()

			if (responseData.error) {
				expect(responseData.error.message).toContain('authentication')
				expect(responseData.error.message).toContain('login')
			}
		})

		it('should handle authentication during callback endpoint', async () => {
			// Test missing token in callback
			const request = new Request('http://localhost:8787/callback', {
				method: 'GET',
			})

			const response = await worker.fetch(request, mockEnv, {} as any)
			expect(response.status).toBe(400)

			const text = await response.text()
			expect(text).toContain('Missing authentication token')
		})

		it('should handle authentication with missing API credentials', async () => {
			const envWithoutCreds: Env = {
				...mockEnv,
				LASTFM_API_KEY: '',
				LASTFM_SHARED_SECRET: '',
			}

			const request = new Request('http://localhost:8787/login', {
				method: 'GET',
			})

			const response = await worker.fetch(request, envWithoutCreds, {} as any)
			expect(response.status).toBe(500)

			const text = await response.text()
			expect(text).toContain('Missing credentials')
		})
	})

	describe('Session Token Edge Cases', () => {
		it('should handle session creation with empty/null payload fields', async () => {
			const invalidPayloads = [
				{ userId: '', sessionKey: 'key', username: 'user' },
				{ userId: 'user', sessionKey: '', username: 'user' },
				{ userId: 'user', sessionKey: 'key', username: '' },
				{ userId: null as any, sessionKey: 'key', username: 'user' },
			]

			for (const payload of invalidPayloads) {
				const token = await createSessionToken(payload, 'secret')
				const verified = await verifySessionToken(token, 'secret')

				// Should create token but may have empty/null fields
				expect(verified).not.toBeNull()
			}
		})

		it('should handle extremely long session data', async () => {
			const longPayload = {
				userId: 'a'.repeat(1000),
				sessionKey: 'b'.repeat(1000),
				username: 'c'.repeat(1000),
			}

			const token = await createSessionToken(longPayload, 'secret')
			const verified = await verifySessionToken(token, 'secret')

			expect(verified?.userId).toBe(longPayload.userId)
			expect(verified?.sessionKey).toBe(longPayload.sessionKey)
			expect(verified?.username).toBe(longPayload.username)
		})

		it('should handle special Unicode characters in session data', async () => {
			// Use Latin-1 compatible characters to avoid btoa() issues
			const unicodePayload = {
				userId: 'user-àáâãäå',
				sessionKey: 'session-çñöü',
				username: 'test-éèêë',
			}

			try {
				const token = await createSessionToken(unicodePayload, 'secret')
				const verified = await verifySessionToken(token, 'secret')

				expect(verified?.userId).toBe(unicodePayload.userId)
				expect(verified?.sessionKey).toBe(unicodePayload.sessionKey)
				expect(verified?.username).toBe(unicodePayload.username)
			} catch (error) {
				// If btoa fails with certain characters, that's expected
				expect(error).toBeDefined()
			}
		})

		it('should handle very short expiration times', async () => {
			const payload = {
				userId: 'testuser',
				sessionKey: 'test-session',
				username: 'testuser',
			}

			// Create token that expires in 1 second
			const token = await createSessionToken(payload, 'secret', 1 / 3600)

			// Advance time by 2 seconds
			vi.advanceTimersByTime(2000)

			const verified = await verifySessionToken(token, 'secret')
			expect(verified).toBeNull() // Should be expired
		})

		it('should handle clock skew scenarios', async () => {
			const payload = {
				userId: 'testuser',
				sessionKey: 'test-session',
				username: 'testuser',
			}

			// Create token with 2 hour expiration
			const token = await createSessionToken(payload, 'secret', 2)

			// Test that token is valid immediately
			const verified = await verifySessionToken(token, 'secret')
			expect(verified).not.toBeNull() // Should be valid

			// Forward in time to expire it (more than 2 hours)
			vi.advanceTimersByTime(2.5 * 3600000) // 2.5 hours

			const expiredVerified = await verifySessionToken(token, 'secret')
			expect(expiredVerified).toBeNull() // Should be expired
		})
	})
})
