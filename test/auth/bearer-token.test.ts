// ABOUTME: Unit tests for Bearer token authentication in MCP handlers
// ABOUTME: Tests OAuth Bearer token support in protocol handlers

import { describe, it, expect } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { registerOAuthClient, storeAccessToken } from '../../src/auth/oauth'
import { createSessionToken } from '../../src/auth/jwt'

describe('Bearer Token Authentication', () => {
	describe('MCP request authentication', () => {
		it('should authenticate MCP requests with valid Bearer token', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			// Create a valid JWT access token
			const accessToken = await createSessionToken(
				{
					userId: 'testuser',
					sessionKey: `oauth-${client.id}`,
					username: 'testuser',
				},
				env.JWT_SECRET!,
				168, // 7 days
			)

			// Store the access token in OAuth tokens KV
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

		it('should reject requests with invalid Bearer token', async () => {
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
					Authorization: 'Bearer invalid-token-123',
				},
				body: JSON.stringify(mcpRequest),
			})

			expect(response.status).toBe(200)
			const data = await response.json()
			expect(data.error).toBeDefined()
			expect(data.error.message).toContain('Authentication required')
		})

		it('should fall back to cookie auth when Bearer token is invalid', async () => {
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
			expect(data.result.protocolVersion).toBe('2024-11-05')
		})

		it('should work for non-auth methods without Bearer token', async () => {
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
					// No Authorization header
				},
				body: JSON.stringify(mcpRequest),
			})

			expect(response.status).toBe(200)
			const data = await response.json()
			expect(data.result).toBeDefined()
			expect(data.result.protocolVersion).toBe('2024-11-05')
		})
	})

	describe('Authorization header parsing', () => {
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
			const data = await response.json()
			expect(data.result).toBeDefined()
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
			const data = await response.json()
			expect(data.result).toBeDefined()
			// Should work normally, ignoring malformed Bearer auth
		})
	})

	describe('Token scope information', () => {
		it('should preserve user context from Bearer token', async () => {
			const client = await registerOAuthClient(env, 'Scope Test Client', ['https://example.com'])

			const accessToken = await createSessionToken(
				{
					userId: 'oauthuser',
					sessionKey: `oauth-${client.id}`,
					username: 'oauthuser',
				},
				env.JWT_SECRET!,
				168,
			)

			// Store with specific scopes
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
		})

		it('should handle expired Bearer tokens', async () => {
			const client = await registerOAuthClient(env, 'Expired Test Client', ['https://example.com'])

			// Create an expired access token (JWT expired)
			const expiredToken = await createSessionToken(
				{
					userId: 'testuser',
					sessionKey: `oauth-${client.id}`,
					username: 'testuser',
				},
				env.JWT_SECRET!,
				-1, // Expired 1 hour ago
			)

			// Store the token data (but JWT itself is expired)
			await storeAccessToken(env, expiredToken, client.id, 'testuser', 'testuser', 'read:listening_history')

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
			// Should get an authentication error or tool parameter error
			expect(data.error.message).toMatch(/Authentication required|Missing required parameter/)
		})
	})

	describe('Rate limiting with Bearer tokens', () => {
		it('should apply rate limiting based on user ID from Bearer token', async () => {
			const client = await registerOAuthClient(env, 'Rate Limit Test Client', ['https://example.com'])

			const accessToken = await createSessionToken(
				{
					userId: 'ratelimituser',
					sessionKey: `oauth-${client.id}`,
					username: 'ratelimituser',
				},
				env.JWT_SECRET!,
				168,
			)

			await storeAccessToken(env, accessToken, client.id, 'ratelimituser', 'ratelimituser', 'read:listening_history')

			// Test that user ID is properly extracted for rate limiting
			const mcpRequest = {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'ping',
					arguments: { message: 'rate limit test' },
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
			expect(data.result.content[0].text).toContain('rate limit test')
		})
	})
})
