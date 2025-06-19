// ABOUTME: Unit tests for OAuth 2.0 client management and validation utilities
// ABOUTME: Tests the core OAuth functions and data structures

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import {
	generateClientId,
	generateClientSecret,
	generateAuthorizationCode,
	registerOAuthClient,
	getOAuthClient,
	validateOAuthClient,
	validateRedirectUri,
	validateScopes,
	storeAuthorizationCode,
	validateAuthorizationCode,
	storeAccessToken,
	validateAccessToken,
} from '../../src/auth/oauth'
import { OAUTH_SCOPES, OAuthError } from '../../src/types/oauth'

describe('OAuth 2.0 Core Functions', () => {
	describe('ID and secret generation', () => {
		it('should generate unique client IDs', () => {
			const id1 = generateClientId()
			const id2 = generateClientId()

			expect(id1).toHaveLength(32) // 16 bytes = 32 hex chars
			expect(id2).toHaveLength(32)
			expect(id1).not.toBe(id2)
			expect(/^[0-9a-f]+$/.test(id1)).toBe(true)
		})

		it('should generate unique client secrets', () => {
			const secret1 = generateClientSecret()
			const secret2 = generateClientSecret()

			expect(secret1).toHaveLength(64) // 32 bytes = 64 hex chars
			expect(secret2).toHaveLength(64)
			expect(secret1).not.toBe(secret2)
			expect(/^[0-9a-f]+$/.test(secret1)).toBe(true)
		})

		it('should generate unique authorization codes', () => {
			const code1 = generateAuthorizationCode()
			const code2 = generateAuthorizationCode()

			expect(code1).toHaveLength(48) // 24 bytes = 48 hex chars
			expect(code2).toHaveLength(48)
			expect(code1).not.toBe(code2)
			expect(/^[0-9a-f]+$/.test(code1)).toBe(true)
		})
	})

	describe('Client registration and validation', () => {
		it('should register OAuth client correctly', async () => {
			const client = await registerOAuthClient(
				env,
				'Test Application',
				['https://app.example.com/callback', 'https://test.example.com/callback'],
				[OAUTH_SCOPES.READ_LISTENING_HISTORY, OAUTH_SCOPES.READ_PROFILE],
			)

			expect(client.id).toHaveLength(32)
			expect(client.secret).toHaveLength(64)
			expect(client.name).toBe('Test Application')
			expect(client.redirectUris).toEqual(['https://app.example.com/callback', 'https://test.example.com/callback'])
			expect(client.allowedScopes).toEqual([OAUTH_SCOPES.READ_LISTENING_HISTORY, OAUTH_SCOPES.READ_PROFILE])
			expect(client.active).toBe(true)
			expect(client.createdAt).toBeGreaterThan(Date.now() - 1000) // Within last second
		})

		it('should store and retrieve OAuth client', async () => {
			const originalClient = await registerOAuthClient(env, 'Retrieval Test Client', ['https://example.com/callback'])

			const retrievedClient = await getOAuthClient(env, originalClient.id)
			expect(retrievedClient).toEqual(originalClient)
		})

		it('should return null for nonexistent client', async () => {
			const client = await getOAuthClient(env, 'nonexistent-client-id')
			expect(client).toBeNull()
		})

		it('should validate existing client without secret', async () => {
			const client = await registerOAuthClient(env, 'Validation Test', ['https://example.com/callback'])

			// Validation without secret should work
			const validatedClient = await validateOAuthClient(env, client.id)
			expect(validatedClient).toEqual(client)
		})

		it('should validate client with correct secret', async () => {
			const client = await registerOAuthClient(env, 'Secret Test', ['https://example.com/callback'])

			const validatedClient = await validateOAuthClient(env, client.id, client.secret)
			expect(validatedClient).toEqual(client)
		})

		it('should reject client with wrong secret', async () => {
			const client = await registerOAuthClient(env, 'Wrong Secret Test', ['https://example.com/callback'])

			await expect(validateOAuthClient(env, client.id, 'wrong-secret')).rejects.toThrow(OAuthError)
		})

		it('should reject nonexistent client', async () => {
			await expect(validateOAuthClient(env, 'nonexistent')).rejects.toThrow(OAuthError)
		})

		it('should reject inactive client', async () => {
			const client = await registerOAuthClient(env, 'Inactive Test', ['https://example.com/callback'])

			// Manually set client as inactive
			await env.OAUTH_CLIENTS.put(client.id, JSON.stringify({ ...client, active: false }))

			await expect(validateOAuthClient(env, client.id)).rejects.toThrow(OAuthError)
		})
	})

	describe('Redirect URI validation', () => {
		it('should accept registered redirect URI', () => {
			const client = {
				id: 'test',
				secret: 'secret',
				name: 'Test',
				redirectUris: ['https://app.example.com/callback', 'https://test.example.com/callback'],
				allowedScopes: [OAUTH_SCOPES.READ_LISTENING_HISTORY],
				createdAt: Date.now(),
				active: true,
			}

			expect(() => validateRedirectUri(client, 'https://app.example.com/callback')).not.toThrow()
			expect(() => validateRedirectUri(client, 'https://test.example.com/callback')).not.toThrow()
		})

		it('should reject unregistered redirect URI', () => {
			const client = {
				id: 'test',
				secret: 'secret',
				name: 'Test',
				redirectUris: ['https://app.example.com/callback'],
				allowedScopes: [OAUTH_SCOPES.READ_LISTENING_HISTORY],
				createdAt: Date.now(),
				active: true,
			}

			expect(() => validateRedirectUri(client, 'https://malicious.example.com/callback')).toThrow(OAuthError)
		})
	})

	describe('Scope validation', () => {
		const client = {
			id: 'test',
			secret: 'secret',
			name: 'Test',
			redirectUris: ['https://example.com/callback'],
			allowedScopes: [OAUTH_SCOPES.READ_LISTENING_HISTORY, OAUTH_SCOPES.READ_PROFILE],
			createdAt: Date.now(),
			active: true,
		}

		it('should return default scopes when none requested', () => {
			const scopes = validateScopes(client)
			expect(scopes).toEqual([OAUTH_SCOPES.READ_LISTENING_HISTORY, OAUTH_SCOPES.READ_PROFILE])
		})

		it('should return default scopes for empty string', () => {
			const scopes = validateScopes(client, '')
			expect(scopes).toEqual([OAUTH_SCOPES.READ_LISTENING_HISTORY, OAUTH_SCOPES.READ_PROFILE])
		})

		it('should validate requested scopes', () => {
			const scopes = validateScopes(client, OAUTH_SCOPES.READ_LISTENING_HISTORY)
			expect(scopes).toEqual([OAUTH_SCOPES.READ_LISTENING_HISTORY])
		})

		it('should validate multiple requested scopes', () => {
			const scopes = validateScopes(client, `${OAUTH_SCOPES.READ_LISTENING_HISTORY} ${OAUTH_SCOPES.READ_PROFILE}`)
			expect(scopes).toEqual([OAUTH_SCOPES.READ_LISTENING_HISTORY, OAUTH_SCOPES.READ_PROFILE])
		})

		it('should reject invalid scopes', () => {
			expect(() => validateScopes(client, 'write:data')).toThrow(OAuthError)
		})

		it('should reject mixed valid and invalid scopes', () => {
			expect(() => validateScopes(client, `${OAUTH_SCOPES.READ_LISTENING_HISTORY} write:data`)).toThrow(OAuthError)
		})
	})

	describe('Authorization code flow', () => {
		it('should store and retrieve authorization code', async () => {
			const code = generateAuthorizationCode()
			const clientId = 'test-client'
			const userId = 'testuser'
			const username = 'testuser'
			const scope = 'read:listening_history'
			const redirectUri = 'https://example.com/callback'

			await storeAuthorizationCode(env, code, clientId, userId, username, scope, redirectUri)

			const retrievedCode = await validateAuthorizationCode(env, code, clientId, redirectUri)

			expect(retrievedCode.code).toBe(code)
			expect(retrievedCode.clientId).toBe(clientId)
			expect(retrievedCode.userId).toBe(userId)
			expect(retrievedCode.username).toBe(username)
			expect(retrievedCode.scope).toBe(scope)
			expect(retrievedCode.redirectUri).toBe(redirectUri)
			expect(retrievedCode.expiresAt).toBeGreaterThan(Date.now())
		})

		it('should reject nonexistent authorization code', async () => {
			await expect(validateAuthorizationCode(env, 'nonexistent', 'client', 'https://example.com')).rejects.toThrow(OAuthError)
		})

		it('should reject authorization code with wrong client ID', async () => {
			const code = generateAuthorizationCode()
			await storeAuthorizationCode(env, code, 'client1', 'user', 'user', 'scope', 'https://example.com')

			await expect(validateAuthorizationCode(env, code, 'client2', 'https://example.com')).rejects.toThrow(OAuthError)
		})

		it('should reject authorization code with wrong redirect URI', async () => {
			const code = generateAuthorizationCode()
			await storeAuthorizationCode(env, code, 'client', 'user', 'user', 'scope', 'https://example.com')

			await expect(validateAuthorizationCode(env, code, 'client', 'https://other.com')).rejects.toThrow(OAuthError)
		})

		it('should consume authorization code after validation', async () => {
			const code = generateAuthorizationCode()
			await storeAuthorizationCode(env, code, 'client', 'user', 'user', 'scope', 'https://example.com')

			// First validation should work
			await validateAuthorizationCode(env, code, 'client', 'https://example.com')

			// Second validation should fail (code consumed)
			await expect(validateAuthorizationCode(env, code, 'client', 'https://example.com')).rejects.toThrow(OAuthError)
		})

		it('should reject expired authorization code', async () => {
			const code = generateAuthorizationCode()

			// Manually store expired code
			const expiredCodeData = {
				code,
				clientId: 'client',
				userId: 'user',
				username: 'user',
				scope: 'scope',
				redirectUri: 'https://example.com',
				createdAt: Date.now() - 20 * 60 * 1000,
				expiresAt: Date.now() - 1000, // Expired
			}
			await env.OAUTH_CODES.put(code, JSON.stringify(expiredCodeData))

			await expect(validateAuthorizationCode(env, code, 'client', 'https://example.com')).rejects.toThrow(OAuthError)
		})
	})

	describe('Access token management', () => {
		it('should store and retrieve access token', async () => {
			const token = 'test-access-token-123'
			const clientId = 'test-client'
			const userId = 'testuser'
			const username = 'testuser'
			const scope = 'read:listening_history read:profile'

			await storeAccessToken(env, token, clientId, userId, username, scope)

			const retrievedToken = await validateAccessToken(env, token)

			expect(retrievedToken.token).toBe(token)
			expect(retrievedToken.clientId).toBe(clientId)
			expect(retrievedToken.userId).toBe(userId)
			expect(retrievedToken.username).toBe(username)
			expect(retrievedToken.scope).toBe(scope)
			expect(retrievedToken.expiresAt).toBeGreaterThan(Date.now())
		})

		it('should reject nonexistent access token', async () => {
			await expect(validateAccessToken(env, 'nonexistent-token')).rejects.toThrow(OAuthError)
		})

		it('should reject expired access token', async () => {
			const token = 'expired-token-123'

			// Manually store expired token
			const expiredTokenData = {
				token,
				clientId: 'client',
				userId: 'user',
				username: 'user',
				scope: 'scope',
				createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
				expiresAt: Date.now() - 24 * 60 * 60 * 1000, // 1 day ago (expired)
			}
			await env.OAUTH_TOKENS.put(token, JSON.stringify(expiredTokenData))

			await expect(validateAccessToken(env, token)).rejects.toThrow(OAuthError)
		})

		it('should clean up expired tokens during validation', async () => {
			const token = 'cleanup-test-token'

			// Store expired token
			const expiredTokenData = {
				token,
				clientId: 'client',
				userId: 'user',
				username: 'user',
				scope: 'scope',
				createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
				expiresAt: Date.now() - 1000, // Expired
			}
			await env.OAUTH_TOKENS.put(token, JSON.stringify(expiredTokenData))

			// Validation should fail and clean up token
			await expect(validateAccessToken(env, token)).rejects.toThrow(OAuthError)

			// Token should be removed from storage
			const tokenAfter = await env.OAUTH_TOKENS.get(token)
			expect(tokenAfter).toBeNull()
		})
	})

	describe('Error handling', () => {
		it('should throw OAuthError with correct properties', () => {
			const error = new OAuthError('invalid_client', 'Client not found', 401)

			expect(error).toBeInstanceOf(Error)
			expect(error).toBeInstanceOf(OAuthError)
			expect(error.error).toBe('invalid_client')
			expect(error.description).toBe('Client not found')
			expect(error.statusCode).toBe(401)
			expect(error.message).toBe('Client not found')
		})

		it('should create OAuthError without status code', () => {
			const error = new OAuthError('invalid_request', 'Bad request')

			expect(error.error).toBe('invalid_request')
			expect(error.description).toBe('Bad request')
			expect(error.statusCode).toBe(400) // Default
		})
	})
})
