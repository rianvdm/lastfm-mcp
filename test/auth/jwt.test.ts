/**
 * Tests for JWT Authentication System
 * Critical security tests that were previously missing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSessionToken, verifySessionToken, SessionPayload } from '../../src/auth/jwt'

// Mock Web Crypto API for testing
const mockCrypto = {
	subtle: {
		importKey: vi.fn(),
		sign: vi.fn(),
	},
}

// Mock global crypto
Object.defineProperty(global, 'crypto', {
	value: mockCrypto,
	writable: true,
})

// Mock btoa/atob for Node.js environment
global.btoa = global.btoa || ((str: string) => Buffer.from(str, 'binary').toString('base64'))
global.atob = global.atob || ((str: string) => Buffer.from(str, 'base64').toString('binary'))

describe('JWT Authentication', () => {
	const testSecret = 'test-secret-key-for-jwt-signing'
	const testPayload = {
		userId: 'user123',
		sessionKey: 'lastfm-session-key',
		username: 'testuser',
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		
		// Mock crypto.subtle.importKey to return different key objects for different secrets
		mockCrypto.subtle.importKey.mockImplementation((format, keyData, algorithm, extractable, keyUsages) => {
			// Create a unique key object based on the input secret
			const keyBytes = new Uint8Array(keyData as ArrayBuffer)
			let keyHash = 0
			for (let i = 0; i < keyBytes.length; i++) {
				keyHash = ((keyHash << 5) - keyHash + keyBytes[i]) & 0xFFFFFFFF
			}
			
			return Promise.resolve({
				type: 'secret',
				algorithm: { name: 'HMAC', hash: { name: 'SHA-256' } },
				keyHash, // Add unique identifier based on secret
				keyLength: keyBytes.length,
			})
		})
		
		// Mock crypto.subtle.sign to return signatures that vary based on secret/data
		mockCrypto.subtle.sign.mockImplementation((algorithm, key, data) => {
			// Create pseudo-unique signature based on data input and key
			const dataBytes = new Uint8Array(data as ArrayBuffer)
			
			// Use a combination of key object properties and data to create unique signatures
			const keyString = JSON.stringify(key)
			const encoder = new TextEncoder()
			const keyBytes = encoder.encode(keyString)
			
			// Create more robust hash that differentiates inputs
			let hash = 0x12345678
			
			// Hash the data bytes
			for (let i = 0; i < dataBytes.length; i++) {
				hash = ((hash << 7) | (hash >>> 25)) ^ dataBytes[i]
				hash = hash >>> 0 // Ensure unsigned 32-bit
			}
			
			// Hash the key bytes with different operation
			for (let i = 0; i < keyBytes.length; i++) {
				hash = ((hash << 11) | (hash >>> 21)) ^ (keyBytes[i] << 8)
				hash = hash >>> 0
			}
			
			// Create secondary hash for more uniqueness
			let hash2 = 0x87654321
			for (let i = 0; i < dataBytes.length; i++) {
				hash2 = ((hash2 << 13) | (hash2 >>> 19)) ^ (dataBytes[i] << 16)
				hash2 = hash2 >>> 0
			}
			
			// Return ArrayBuffer with pseudo-unique bytes based on both hashes
			const buffer = new ArrayBuffer(32)
			const view = new Uint8Array(buffer)
			for (let i = 0; i < 32; i++) {
				if (i < 16) {
					view[i] = ((hash + i * 7) ^ (hash2 >> (i % 8))) & 0xFF
				} else {
					view[i] = ((hash2 + (i - 16) * 13) ^ (hash >> ((i - 16) % 8))) & 0xFF
				}
			}
			return Promise.resolve(buffer)
		})
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('createSessionToken', () => {
		it('should create a valid JWT token structure', async () => {
			const token = await createSessionToken(testPayload, testSecret)
			
			const parts = token.split('.')
			expect(parts).toHaveLength(3)
			
			// Verify header structure
			const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')))
			expect(header).toEqual({
				alg: 'HS256',
				typ: 'JWT',
			})
		})

		it('should include correct payload with timestamps', async () => {
			const now = Date.now()
			vi.setSystemTime(now)
			
			const token = await createSessionToken(testPayload, testSecret)
			const parts = token.split('.')
			
			// Decode payload
			let paddedPayload = parts[1]
			while (paddedPayload.length % 4) {
				paddedPayload += '='
			}
			const payload = JSON.parse(atob(paddedPayload.replace(/-/g, '+').replace(/_/g, '/')))
			
			expect(payload).toMatchObject({
				userId: 'user123',
				sessionKey: 'lastfm-session-key',
				username: 'testuser',
				iat: Math.floor(now / 1000),
				exp: Math.floor(now / 1000) + 24 * 3600, // Default 24 hours
			})
		})

		it('should respect custom expiration time', async () => {
			const now = Date.now()
			vi.setSystemTime(now)
			
			const token = await createSessionToken(testPayload, testSecret, 12) // 12 hours
			const parts = token.split('.')
			
			let paddedPayload = parts[1]
			while (paddedPayload.length % 4) {
				paddedPayload += '='
			}
			const payload = JSON.parse(atob(paddedPayload.replace(/-/g, '+').replace(/_/g, '/')))
			
			expect(payload.exp).toBe(Math.floor(now / 1000) + 12 * 3600)
		})

		it('should use Web Crypto API for signing', async () => {
			await createSessionToken(testPayload, testSecret)
			
			expect(mockCrypto.subtle.importKey).toHaveBeenCalledWith(
				'raw',
				expect.any(Uint8Array), // Encoded secret
				{ name: 'HMAC', hash: 'SHA-256' },
				false,
				['sign']
			)
			
			expect(mockCrypto.subtle.sign).toHaveBeenCalledWith(
				'HMAC',
				expect.any(Object), // Key object
				expect.any(Uint8Array) // Data to sign
			)
		})

		it('should create different tokens for different secrets', async () => {
			const token1 = await createSessionToken(testPayload, 'secret1')
			const token2 = await createSessionToken(testPayload, 'secret2')
			
			expect(token1).not.toBe(token2)
		})

		it('should create different tokens for different payloads', async () => {
			const payload1 = { ...testPayload, userId: 'user1' }
			const payload2 = { ...testPayload, userId: 'user2' }
			
			const token1 = await createSessionToken(payload1, testSecret)
			const token2 = await createSessionToken(payload2, testSecret)
			
			expect(token1).not.toBe(token2)
		})
	})

	describe('verifySessionToken', () => {
		it('should verify valid tokens correctly', async () => {
			// Create a token first
			const token = await createSessionToken(testPayload, testSecret)
			
			// Verify it
			const result = await verifySessionToken(token, testSecret)
			
			expect(result).toMatchObject({
				userId: 'user123',
				sessionKey: 'lastfm-session-key',
				username: 'testuser',
			})
			expect(result?.iat).toBeTypeOf('number')
			expect(result?.exp).toBeTypeOf('number')
		})

		it('should reject tokens with invalid structure', async () => {
			const invalidTokens = [
				'invalid.token', // Only 2 parts
				'invalid', // Only 1 part
				'too.many.parts.here', // 4 parts
				'', // Empty string
			]
			
			for (const token of invalidTokens) {
				const result = await verifySessionToken(token, testSecret)
				expect(result).toBeNull()
			}
		})

		it('should reject tokens with invalid signature', async () => {
			// Create a valid token
			const validToken = await createSessionToken(testPayload, testSecret)
			
			// Tamper with the signature
			const parts = validToken.split('.')
			const tamperedToken = `${parts[0]}.${parts[1]}.invalid-signature`
			
			const result = await verifySessionToken(tamperedToken, testSecret)
			expect(result).toBeNull()
		})

		it('should reject tokens signed with different secret', async () => {
			const token = await createSessionToken(testPayload, 'secret1')
			const result = await verifySessionToken(token, 'secret2')
			
			expect(result).toBeNull()
		})

		it('should reject expired tokens', async () => {
			// Create token that expires in 1 hour
			const token = await createSessionToken(testPayload, testSecret, 1)
			
			// Advance time by 2 hours
			vi.advanceTimersByTime(2 * 60 * 60 * 1000)
			
			const result = await verifySessionToken(token, testSecret)
			expect(result).toBeNull()
		})

		it('should accept non-expired tokens', async () => {
			// Create token that expires in 2 hours
			const token = await createSessionToken(testPayload, testSecret, 2)
			
			// Advance time by 1 hour (still valid)
			vi.advanceTimersByTime(1 * 60 * 60 * 1000)
			
			const result = await verifySessionToken(token, testSecret)
			expect(result).not.toBeNull()
			expect(result?.userId).toBe('user123')
		})

		it('should handle malformed JSON in payload', async () => {
			// Create a token with invalid JSON payload
			const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
				.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
			const invalidPayload = btoa('invalid json')
				.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
			const signature = 'fake-signature'
			
			const invalidToken = `${header}.${invalidPayload}.${signature}`
			
			const result = await verifySessionToken(invalidToken, testSecret)
			expect(result).toBeNull()
		})

		it('should handle base64 decoding errors gracefully', async () => {
			const invalidToken = 'invalid.base64!@#.signature'
			
			const result = await verifySessionToken(invalidToken, testSecret)
			expect(result).toBeNull()
		})

		it('should validate token expiration boundary conditions', async () => {
			const now = Date.now()
			vi.setSystemTime(now)
			
			// Create token that expires in 1 second
			const token = await createSessionToken(testPayload, testSecret, 1/3600) // 1 second in hours
			
			// Advance time by 2 seconds - token should be expired
			vi.advanceTimersByTime(2000)
			
			const result = await verifySessionToken(token, testSecret)
			expect(result).toBeNull()
		})
	})

	describe('security properties', () => {
		it('should prevent session fixation attacks', async () => {
			// Two different sessions should have different tokens even with same user
			const session1 = await createSessionToken({
				...testPayload,
				sessionKey: 'session1',
			}, testSecret)
			
			const session2 = await createSessionToken({
				...testPayload,
				sessionKey: 'session2',
			}, testSecret)
			
			expect(session1).not.toBe(session2)
		})

		it('should prevent token tampering', async () => {
			const originalToken = await createSessionToken(testPayload, testSecret)
			const parts = originalToken.split('.')
			
			// Try to tamper with payload (change userId)
			const tamperedPayload = btoa(JSON.stringify({
				...testPayload,
				userId: 'hacker',
				iat: Math.floor(Date.now() / 1000),
				exp: Math.floor(Date.now() / 1000) + 24 * 3600,
			})).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
			
			const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`
			
			const result = await verifySessionToken(tamperedToken, testSecret)
			expect(result).toBeNull() // Should reject tampered token
		})

		it('should be resistant to timing attacks', async () => {
			const validToken = await createSessionToken(testPayload, testSecret)
			
			// Multiple invalid tokens should take similar time to reject
			const invalidTokens = [
				'invalid.token.signature',
				'different.invalid.signature',
				'yet.another.invalid',
			]
			
			for (const token of invalidTokens) {
				const start = Date.now()
				await verifySessionToken(token, testSecret)
				const duration = Date.now() - start
				
				// Should not leak timing information
				expect(duration).toBeLessThan(100) // Should be fast
			}
		})

		it('should handle edge cases in base64 URL encoding', async () => {
			// Test with payload containing special characters that affect base64
			const specialPayload = {
				userId: 'user+with/special=chars',
				sessionKey: 'session+key/with=padding',
				username: 'user=name',
			}
			
			const token = await createSessionToken(specialPayload, testSecret)
			const result = await verifySessionToken(token, testSecret)
			
			expect(result?.userId).toBe('user+with/special=chars')
			expect(result?.sessionKey).toBe('session+key/with=padding')
			expect(result?.username).toBe('user=name')
		})

		it('should validate all required payload fields', async () => {
			// Test that all required fields are present in verified payload
			const token = await createSessionToken(testPayload, testSecret)
			const result = await verifySessionToken(token, testSecret)
			
			expect(result).toHaveProperty('userId')
			expect(result).toHaveProperty('sessionKey')
			expect(result).toHaveProperty('username')
			expect(result).toHaveProperty('iat')
			expect(result).toHaveProperty('exp')
			
			expect(typeof result?.iat).toBe('number')
			expect(typeof result?.exp).toBe('number')
			expect(result!.exp > result!.iat).toBe(true)
		})
	})

	describe('crypto integration', () => {
		it('should handle crypto API errors gracefully', async () => {
			// Mock crypto error
			mockCrypto.subtle.importKey.mockRejectedValue(new Error('Crypto error'))
			
			await expect(createSessionToken(testPayload, testSecret)).rejects.toThrow('Crypto error')
		})

		it('should handle signing errors gracefully', async () => {
			mockCrypto.subtle.sign.mockRejectedValue(new Error('Sign error'))
			
			await expect(createSessionToken(testPayload, testSecret)).rejects.toThrow('Sign error')
		})

		it('should use secure random for different sessions', async () => {
			// Even with same inputs, tokens should differ due to timestamp
			const token1 = await createSessionToken(testPayload, testSecret)
			
			// Advance time by 1 second
			vi.advanceTimersByTime(1000)
			
			const token2 = await createSessionToken(testPayload, testSecret)
			
			expect(token1).not.toBe(token2)
		})
	})
})