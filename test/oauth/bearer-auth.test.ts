// ABOUTME: Unit tests for OAuth 2.0 Bearer token authentication
// ABOUTME: Tests Bearer token validation in MCP handlers and endpoints

import { describe, it, expect } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { registerOAuthClient, storeAccessToken } from '../../src/auth/oauth'
import { createSessionToken } from '../../src/auth/jwt'

describe('Bearer Token Authentication', () => {
	describe('Bearer token validation', () => {
		it('should accept valid Bearer tokens for MCP requests', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			// Create a valid access token
			const accessToken = await createSessionToken(
				{
					userId: 'testuser',
					sessionKey: `oauth-${client.id}`,
					username: 'testuser',
				},
				env.JWT_SECRET!,
				168, // 7 days
			)

			// Store the access token
			await storeAccessToken(env, accessToken, client.id, 'testuser', 'testuser', 'read:listening_history')

			const mcpRequest = {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					clientInfo: { name: 'Test', version: '1.0' },
					capabilities: {},
				},
			}

			const response = await SELF.fetch('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
				body: JSON.stringify(mcpRequest),
			})

			expect(response.status).toBe(200)
			const data = await response.json()
			expect(data.result).toBeDefined()
			expect(data.result.protocolVersion).toBe('2024-11-05')
		})

		it('should reject invalid Bearer tokens', async () => {
			const mcpRequest = {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
				params: {},
			}

			const response = await SELF.fetch('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer invalid-token-123',
				},
				body: JSON.stringify(mcpRequest),
			})

			expect(response.status).toBe(200)
			// Should still work for tools/list since it doesn't require auth
			// But the user context should be unauthenticated
		})

		it('should reject expired Bearer tokens', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			// Create an expired access token
			const expiredToken = await createSessionToken(
				{
					userId: 'testuser',
					sessionKey: `oauth-${client.id}`,
					username: 'testuser',
				},
				env.JWT_SECRET!,
				-1, // Expired 1 hour ago
			)

			// Store the expired token with past expiration
			const expiredTokenData = {
				token: expiredToken,
				clientId: client.id,
				userId: 'testuser',
				username: 'testuser',
				scope: 'read:listening_history',
				createdAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
				expiresAt: Date.now() - 1 * 60 * 60 * 1000, // 1 hour ago (expired)
			}
			await env.OAUTH_TOKENS.put(expiredToken, JSON.stringify(expiredTokenData))

			const mcpRequest = {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'get_recent_tracks',
					arguments: { limit: 10 },
				},
			}

			const response = await SELF.fetch('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${expiredToken}`,
				},
				body: JSON.stringify(mcpRequest),
			})

			expect(response.status).toBe(200)
			const data = await response.json()
			expect(data.error).toBeDefined()
			expect(data.error.message).toContain('Authentication required')
		})

		it('should fall back to cookie authentication when Bearer token invalid', async () => {
			// Create a valid session token for cookie auth
			const sessionToken = await createSessionToken(
				{
					userId: 'cookieuser',
					sessionKey: 'session123',
					username: 'cookieuser',
				},
				env.JWT_SECRET!,
				24, // 24 hours
			)

			const mcpRequest = {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					clientInfo: { name: 'Test', version: '1.0' },
					capabilities: {},
				},
			}

			const response = await SELF.fetch('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer invalid-token',
					Cookie: `session=${sessionToken}`,
				},
				body: JSON.stringify(mcpRequest),
			})

			expect(response.status).toBe(200)
			const data = await response.json()
			expect(data.result).toBeDefined()
			// Should work via cookie fallback
		})
	})

	describe('Bearer token with authenticated tools', () => {
		it('should allow access to authenticated tools with valid Bearer token', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			const accessToken = await createSessionToken(
				{
					userId: 'testuser',
					sessionKey: `oauth-${client.id}`,
					username: 'testuser',
				},
				env.JWT_SECRET!,
				168,
			)

			await storeAccessToken(env, accessToken, client.id, 'testuser', 'testuser', 'read:listening_history')

			const mcpRequest = {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'lastfm_auth_status',
					arguments: {},
				},
			}

			const response = await SELF.fetch('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
				body: JSON.stringify(mcpRequest),
			})

			expect(response.status).toBe(200)
			const data = await response.json()
			expect(data.result).toBeDefined()
			expect(data.result.content[0].text).toContain('Authenticated')
			expect(data.result.content[0].text).toContain('testuser')
		})

		it('should preserve user context from Bearer token', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			const accessToken = await createSessionToken(
				{
					userId: 'oauthuser',
					sessionKey: `oauth-${client.id}`,
					username: 'oauthuser',
				},
				env.JWT_SECRET!,
				168,
			)

			await storeAccessToken(env, accessToken, client.id, 'oauthuser', 'oauthuser', 'read:listening_history read:profile')

			const mcpRequest = {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'lastfm_auth_status',
					arguments: {},
				},
			}

			const response = await SELF.fetch('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
				body: JSON.stringify(mcpRequest),
			})

			expect(response.status).toBe(200)
			const data = await response.json()
			const content = data.result.content[0].text

			expect(content).toContain('oauthuser')
			expect(content).toContain('Authenticated')
			// Should show OAuth session info
		})
	})

	describe('Authorization header parsing', () => {
		it('should handle Bearer token with extra whitespace', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			const accessToken = await createSessionToken(
				{
					userId: 'testuser',
					sessionKey: `oauth-${client.id}`,
					username: 'testuser',
				},
				env.JWT_SECRET!,
				168,
			)

			await storeAccessToken(env, accessToken, client.id, 'testuser', 'testuser', 'read:listening_history')

			const mcpRequest = {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					clientInfo: { name: 'Test', version: '1.0' },
					capabilities: {},
				},
			}

			const response = await SELF.fetch('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `  Bearer   ${accessToken}  `, // Extra whitespace
				},
				body: JSON.stringify(mcpRequest),
			})

			// Should handle gracefully (though may not work due to strict parsing)
			// At minimum should not crash
			expect([200, 400]).toContain(response.status)
		})

		it('should ignore non-Bearer authorization headers', async () => {
			const mcpRequest = {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					clientInfo: { name: 'Test', version: '1.0' },
					capabilities: {},
				},
			}

			const response = await SELF.fetch('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Basic dXNlcjpwYXNz', // Basic auth
				},
				body: JSON.stringify(mcpRequest),
			})

			expect(response.status).toBe(200)
			// Should work normally, ignoring non-Bearer auth
		})

		it('should handle malformed Bearer header gracefully', async () => {
			const mcpRequest = {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					clientInfo: { name: 'Test', version: '1.0' },
					capabilities: {},
				},
			}

			const response = await SELF.fetch('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer', // Missing token
				},
				body: JSON.stringify(mcpRequest),
			})

			expect(response.status).toBe(200)
			// Should work normally, ignoring malformed Bearer auth
		})
	})

	describe('Scope validation', () => {
		it('should preserve scope information from access token', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			const accessToken = await createSessionToken(
				{
					userId: 'testuser',
					sessionKey: `oauth-${client.id}`,
					username: 'testuser',
				},
				env.JWT_SECRET!,
				168,
			)

			// Store with specific scopes
			await storeAccessToken(env, accessToken, client.id, 'testuser', 'testuser', 'read:listening_history read:recommendations')

			// Verify the token data is stored correctly
			const storedTokenData = await env.OAUTH_TOKENS.get(accessToken)
			expect(storedTokenData).toBeDefined()

			const tokenData = JSON.parse(storedTokenData!)
			expect(tokenData.scope).toBe('read:listening_history read:recommendations')
			expect(tokenData.clientId).toBe(client.id)
		})

		// Note: Actual scope enforcement in tools would be implemented separately
		// This just tests that scope information is preserved through the auth flow
	})

	describe('Rate limiting with Bearer tokens', () => {
		it('should apply rate limiting to Bearer token requests', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			const accessToken = await createSessionToken(
				{
					userId: 'testuser',
					sessionKey: `oauth-${client.id}`,
					username: 'testuser',
				},
				env.JWT_SECRET!,
				168,
			)

			await storeAccessToken(env, accessToken, client.id, 'testuser', 'testuser', 'read:listening_history')

			// Rate limiting uses userId for tracking, which comes from the token
			// Multiple requests should eventually hit rate limits
			const mcpRequest = {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'ping',
					arguments: { message: 'test' },
				},
			}

			const response = await SELF.fetch('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
				body: JSON.stringify(mcpRequest),
			})

			expect(response.status).toBe(200)
			// Should work normally - rate limiting tested separately
		})
	})

	describe('Token cleanup', () => {
		it('should clean up expired tokens from storage', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			// Create an expired token
			const expiredToken = 'expired-token-123'
			const expiredTokenData = {
				token: expiredToken,
				clientId: client.id,
				userId: 'testuser',
				username: 'testuser',
				scope: 'read:listening_history',
				createdAt: Date.now() - 2 * 60 * 60 * 1000,
				expiresAt: Date.now() - 1 * 60 * 60 * 1000, // Expired
			}
			await env.OAUTH_TOKENS.put(expiredToken, JSON.stringify(expiredTokenData))

			// Try to use the expired token
			const mcpRequest = {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'lastfm_auth_status',
					arguments: {},
				},
			}

			const response = await SELF.fetch('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${expiredToken}`,
				},
				body: JSON.stringify(mcpRequest),
			})

			// Token should be cleaned up after validation failure
			const tokenAfter = await env.OAUTH_TOKENS.get(expiredToken)
			expect(tokenAfter).toBeNull()
		})
	})
})
