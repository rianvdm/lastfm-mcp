// ABOUTME: Unit tests for OAuth 2.0 token endpoint  
// ABOUTME: Tests POST /oauth/token endpoint for authorization code exchange

import { describe, it, expect } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { registerOAuthClient, generateAuthorizationCode, storeAuthorizationCode } from '../../src/auth/oauth'

describe('OAuth Token Endpoint', () => {

	describe('Grant type validation', () => {
		it('should reject unsupported grant types', async () => {
			const formData = new FormData()
			formData.append('grant_type', 'client_credentials')
			formData.append('client_id', 'test')
			formData.append('client_secret', 'test')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.error).toBe('unsupported_grant_type')
			expect(data.error_description).toContain('authorization_code')
		})

		it('should require grant_type parameter', async () => {
			const formData = new FormData()
			formData.append('client_id', 'test')
			formData.append('client_secret', 'test')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.error).toBe('unsupported_grant_type')
		})

		it('should accept authorization_code grant type', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])
			const code = generateAuthorizationCode()
			await storeAuthorizationCode(env, code, client.id, 'testuser', 'testuser', 'read:listening-history', 'https://example.com')

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', code)
			formData.append('client_id', client.id)
			formData.append('client_secret', client.secret)
			formData.append('redirect_uri', 'https://example.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			// Should not fail due to grant type (may fail for other reasons)
			expect(response.status).not.toBe(400)
			if (response.status === 400) {
				const data = await response.json()
				expect(data.error).not.toBe('unsupported_grant_type')
			}
		})
	})

	describe('Parameter validation', () => {
		it('should require authorization code', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('client_id', client.id)
			formData.append('client_secret', client.secret)
			formData.append('redirect_uri', 'https://example.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.error).toBe('invalid_request')
			expect(data.error_description).toContain('authorization code')
		})

		it('should require client credentials', async () => {
			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', 'some-code')
			formData.append('redirect_uri', 'https://example.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(401)
			const data = await response.json()
			expect(data.error).toBe('invalid_client')
			expect(data.error_description).toContain('client credentials')
		})

		it('should require redirect_uri', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', 'some-code')
			formData.append('client_id', client.id)
			formData.append('client_secret', client.secret)

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.error).toBe('invalid_request')
			expect(data.error_description).toContain('redirect_uri')
		})
	})

	describe('Client validation', () => {
		it('should reject invalid client_id', async () => {
			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', 'some-code')
			formData.append('client_id', 'nonexistent')
			formData.append('client_secret', 'invalid')
			formData.append('redirect_uri', 'https://example.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(401)
			const data = await response.json()
			expect(data.error).toBe('invalid_client')
		})

		it('should reject invalid client_secret', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', 'some-code')
			formData.append('client_id', client.id)
			formData.append('client_secret', 'wrong-secret')
			formData.append('redirect_uri', 'https://example.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(401)
			const data = await response.json()
			expect(data.error).toBe('invalid_client')
		})

		it('should accept valid client credentials', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])
			const code = generateAuthorizationCode()
			await storeAuthorizationCode(env, code, client.id, 'testuser', 'testuser', 'read:listening-history', 'https://example.com')

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', code)
			formData.append('client_id', client.id)
			formData.append('client_secret', client.secret)
			formData.append('redirect_uri', 'https://example.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			// Should not fail due to client validation
			if (response.status === 401) {
				const data = await response.json()
				expect(data.error).not.toBe('invalid_client')
			}
		})
	})

	describe('Authorization code validation', () => {
		it('should reject nonexistent authorization code', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', 'nonexistent-code')
			formData.append('client_id', client.id)
			formData.append('client_secret', client.secret)
			formData.append('redirect_uri', 'https://example.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.error).toBe('invalid_grant')
			expect(data.error_description).toContain('authorization code')
		})

		it('should reject expired authorization code', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])
			const code = generateAuthorizationCode()
			
			// Store code with past expiration
			const expiredCodeData = {
				code,
				clientId: client.id,
				userId: 'testuser',
				username: 'testuser',
				scope: 'read:listening-history',
				redirectUri: 'https://example.com',
				createdAt: Date.now() - 20 * 60 * 1000, // 20 minutes ago
				expiresAt: Date.now() - 10 * 60 * 1000, // 10 minutes ago (expired)
			}
			await env.OAUTH_CODES.put(code, JSON.stringify(expiredCodeData))

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', code)
			formData.append('client_id', client.id)
			formData.append('client_secret', client.secret)
			formData.append('redirect_uri', 'https://example.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.error).toBe('invalid_grant')
			expect(data.error_description).toContain('expired')
		})

		it('should reject code with mismatched client_id', async () => {
			const client1 = await registerOAuthClient(env, 'Test Client 1', ['https://example.com'])
			const client2 = await registerOAuthClient(env, 'Test Client 2', ['https://example.com'])
			const code = generateAuthorizationCode()
			
			// Store code for client1 but try to use with client2
			await storeAuthorizationCode(env, code, client1.id, 'testuser', 'testuser', 'read:listening-history', 'https://example.com')

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', code)
			formData.append('client_id', client2.id)
			formData.append('client_secret', client2.secret)
			formData.append('redirect_uri', 'https://example.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.error).toBe('invalid_grant')
			expect(data.error_description).toContain('Client ID mismatch')
		})

		it('should reject code with mismatched redirect_uri', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com', 'https://other.com'])
			const code = generateAuthorizationCode()
			
			// Store code with one redirect_uri but try to use with another
			await storeAuthorizationCode(env, code, client.id, 'testuser', 'testuser', 'read:listening-history', 'https://example.com')

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', code)
			formData.append('client_id', client.id)
			formData.append('client_secret', client.secret)
			formData.append('redirect_uri', 'https://other.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.error).toBe('invalid_grant')
			expect(data.error_description).toContain('Redirect URI mismatch')
		})

		it('should consume authorization code after use', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])
			const code = generateAuthorizationCode()
			await storeAuthorizationCode(env, code, client.id, 'testuser', 'testuser', 'read:listening-history', 'https://example.com')

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', code)
			formData.append('client_id', client.id)
			formData.append('client_secret', client.secret)
			formData.append('redirect_uri', 'https://example.com')

			// First request should succeed
			const response1 = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})
			expect(response1.status).toBe(200)

			// Second request with same code should fail
			const response2 = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})
			expect(response2.status).toBe(400)
			const data = await response2.json()
			expect(data.error).toBe('invalid_grant')
		})
	})

	describe('Successful token exchange', () => {
		it('should return access token for valid request', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])
			const code = generateAuthorizationCode()
			await storeAuthorizationCode(env, code, client.id, 'testuser', 'testuser', 'read:listening-history', 'https://example.com')

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', code)
			formData.append('client_id', client.id)
			formData.append('client_secret', client.secret)
			formData.append('redirect_uri', 'https://example.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(200)
			const data = await response.json()
			
			expect(data.access_token).toBeDefined()
			expect(typeof data.access_token).toBe('string')
			expect(data.token_type).toBe('Bearer')
			expect(data.expires_in).toBe(7 * 24 * 60 * 60) // 7 days
			expect(data.scope).toBe('read:listening-history')

			// Verify security headers
			expect(response.headers.get('Cache-Control')).toBe('no-store')
			expect(response.headers.get('Pragma')).toBe('no-cache')
		})

		it('should store access token in KV namespace', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])
			const code = generateAuthorizationCode()
			await storeAuthorizationCode(env, code, client.id, 'testuser', 'testuser', 'read:listening-history', 'https://example.com')

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', code)
			formData.append('client_id', client.id)
			formData.append('client_secret', client.secret)
			formData.append('redirect_uri', 'https://example.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(200)
			const data = await response.json()
			
			// Verify token is stored in KV
			const storedToken = await env.OAUTH_TOKENS.get(data.access_token)
			expect(storedToken).toBeDefined()
			
			const tokenData = JSON.parse(storedToken!)
			expect(tokenData.clientId).toBe(client.id)
			expect(tokenData.userId).toBe('testuser')
			expect(tokenData.username).toBe('testuser')
			expect(tokenData.scope).toBe('read:listening-history')
		})

		it('should handle multiple scopes correctly', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])
			const code = generateAuthorizationCode()
			await storeAuthorizationCode(env, code, client.id, 'testuser', 'testuser', 'read:listening-history read:profile', 'https://example.com')

			const formData = new FormData()
			formData.append('grant_type', 'authorization_code')
			formData.append('code', code)
			formData.append('client_id', client.id)
			formData.append('client_secret', client.secret)
			formData.append('redirect_uri', 'https://example.com')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(200)
			const data = await response.json()
			expect(data.scope).toBe('read:listening-history read:profile')
		})
	})

	describe('HTTP method validation', () => {
		it('should reject GET requests', async () => {
			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'GET',
			})

			expect(response.status).toBe(405)
			const text = await response.text()
			expect(text).toContain('Method not allowed')
		})

		it('should reject PUT requests', async () => {
			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'PUT',
			})

			expect(response.status).toBe(405)
		})

		it('should only accept POST requests', async () => {
			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: new FormData(),
			})

			// Should not be a 405 error (though will be other error due to missing data)
			expect(response.status).not.toBe(405)
		})
	})

	describe('Error response format', () => {
		it('should return proper OAuth error format', async () => {
			const formData = new FormData()
			formData.append('grant_type', 'invalid_grant')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.status).toBe(400)
			const data = await response.json()
			
			expect(data.error).toBeDefined()
			expect(data.error_description).toBeDefined()
			expect(typeof data.error).toBe('string')
			expect(typeof data.error_description).toBe('string')
		})

		it('should have correct content type for errors', async () => {
			const formData = new FormData()
			formData.append('grant_type', 'invalid_grant')

			const response = await SELF.fetch('http://localhost/oauth/token', {
				method: 'POST',
				body: formData,
			})

			expect(response.headers.get('Content-Type')).toBe('application/json')
		})
	})
})