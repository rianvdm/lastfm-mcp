// ABOUTME: Unit tests for OAuth 2.0 authorization endpoint
// ABOUTME: Tests GET /oauth/authorize endpoint functionality and error handling

import { describe, it, expect } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { registerOAuthClient } from '../../src/auth/oauth'

describe('OAuth Authorization Endpoint', () => {

	describe('Parameter validation', () => {
		it('should reject missing client_id parameter', async () => {
			const response = await SELF.fetch('http://localhost/oauth/authorize?redirect_uri=https://example.com&response_type=code', {
				method: 'GET',
			})

			// Check if we get an error redirect or direct error response
			if (response.status === 302) {
				const location = response.headers.get('Location')
				expect(location).toContain('error=invalid_request')
				expect(location).toContain('Missing client_id parameter')
			} else {
				expect(response.status).toBe(400)
				const text = await response.text()
				expect(text).toContain('Missing client_id parameter')
			}
		})

		it('should reject missing redirect_uri parameter', async () => {
			const response = await SELF.fetch('http://localhost/oauth/authorize?client_id=test123&response_type=code', {
				method: 'GET',
			})

			expect(response.status).toBe(400)
			const text = await response.text()
			expect(text).toContain('Missing redirect_uri parameter')
		})

		it('should reject invalid response_type', async () => {
			const response = await SELF.fetch('http://localhost/oauth/authorize?client_id=test123&redirect_uri=https://example.com&response_type=token', {
				method: 'GET',
			})

			expect(response.status).toBe(400)
			const text = await response.text()
			expect(text).toContain('Only response_type=code is supported')
		})

		it('should reject missing response_type parameter', async () => {
			const response = await SELF.fetch('http://localhost/oauth/authorize?client_id=test123&redirect_uri=https://example.com', {
				method: 'GET',
			})

			expect(response.status).toBe(400)
			const text = await response.text()
			expect(text).toContain('Only response_type=code is supported')
		})
	})

	describe('Client validation', () => {
		it('should reject unregistered client', async () => {
			const response = await SELF.fetch('http://localhost/oauth/authorize?client_id=nonexistent&redirect_uri=https://example.com&response_type=code', {
				method: 'GET',
			})

			expect(response.status).toBe(401)
			const text = await response.text()
			expect(text).toContain('Client not found')
		})

		it('should reject inactive client', async () => {
			// Register a client and then deactivate it
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])
			await env.OAUTH_CLIENTS.put(client.id, JSON.stringify({ ...client, active: false }))

			const response = await SELF.fetch(`http://localhost/oauth/authorize?client_id=${client.id}&redirect_uri=https://example.com&response_type=code`, {
				method: 'GET',
			})

			expect(response.status).toBe(401)
			const text = await response.text()
			expect(text).toContain('Client is inactive')
		})

		it('should reject unregistered redirect_uri', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://allowed.com'])

			const response = await SELF.fetch(`http://localhost/oauth/authorize?client_id=${client.id}&redirect_uri=https://notallowed.com&response_type=code`, {
				method: 'GET',
			})

			expect(response.status).toBe(400)
			const text = await response.text()
			expect(text).toContain('Redirect URI not registered')
		})

		it('should accept valid client and redirect_uri', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			const response = await SELF.fetch(`http://localhost/oauth/authorize?client_id=${client.id}&redirect_uri=https://example.com&response_type=code`, {
				method: 'GET',
			})

			// Should redirect to Last.fm for authentication
			expect(response.status).toBe(302)
			const location = response.headers.get('Location')
			expect(location).toContain('last.fm/api/auth')
		})
	})

	describe('Scope validation', () => {
		it('should accept valid scopes', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'], ['read:listening-history', 'read:profile'])

			const response = await SELF.fetch(`http://localhost/oauth/authorize?client_id=${client.id}&redirect_uri=https://example.com&response_type=code&scope=read:listening-history`, {
				method: 'GET',
			})

			expect(response.status).toBe(302)
			const location = response.headers.get('Location')
			expect(location).toContain('last.fm/api/auth')
		})

		it('should reject invalid scopes', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'], ['read:listening-history'])

			const response = await SELF.fetch(`http://localhost/oauth/authorize?client_id=${client.id}&redirect_uri=https://example.com&response_type=code&scope=write:data`, {
				method: 'GET',
			})

			expect(response.status).toBe(400)
			const text = await response.text()
			expect(text).toContain('not allowed for this client')
		})

		it('should use default scopes when none provided', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			const response = await SELF.fetch(`http://localhost/oauth/authorize?client_id=${client.id}&redirect_uri=https://example.com&response_type=code`, {
				method: 'GET',
			})

			expect(response.status).toBe(302)
			// Should still work with default scopes
		})
	})

	describe('Authenticated user flow', () => {
		it('should redirect to Last.fm when user not authenticated', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			const response = await SELF.fetch(`http://localhost/oauth/authorize?client_id=${client.id}&redirect_uri=https://example.com&response_type=code`, {
				method: 'GET',
			})

			expect(response.status).toBe(302)
			const location = response.headers.get('Location')
			expect(location).toContain('last.fm/api/auth')
			
			// Should preserve OAuth parameters in callback URL
			expect(location).toContain('client_id=' + client.id)
			expect(location).toContain('redirect_uri=https://example.com')
		})

		it('should preserve state parameter in Last.fm redirect', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])
			const state = 'random-state-123'

			const response = await SELF.fetch(`http://localhost/oauth/authorize?client_id=${client.id}&redirect_uri=https://example.com&response_type=code&state=${state}`, {
				method: 'GET',
			})

			expect(response.status).toBe(302)
			const location = response.headers.get('Location')
			expect(location).toContain('state=' + state)
		})

		// Note: Testing authenticated user flow would require mock JWT sessions
		// This is covered in integration tests
	})

	describe('Error handling', () => {
		it('should handle OAuth errors with redirect when possible', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])

			// Test with invalid scope but valid redirect_uri
			const response = await SELF.fetch(`http://localhost/oauth/authorize?client_id=${client.id}&redirect_uri=https://example.com&response_type=code&scope=invalid:scope`, {
				method: 'GET',
			})

			// Should redirect with error instead of returning error response
			expect(response.status).toBe(302)
			const location = response.headers.get('Location')
			expect(location).toContain('error=invalid_scope')
			expect(location).toContain('error_description=')
		})

		it('should return error response when redirect not possible', async () => {
			// No redirect_uri provided, so can't redirect with error
			const response = await SELF.fetch('http://localhost/oauth/authorize?client_id=invalid', {
				method: 'GET',
			})

			expect(response.status).toBe(400)
			const text = await response.text()
			expect(text).toContain('Missing redirect_uri parameter')
		})

		it('should preserve state in error redirects', async () => {
			const client = await registerOAuthClient(env, 'Test Client', ['https://example.com'])
			const state = 'error-state-456'

			const response = await SELF.fetch(`http://localhost/oauth/authorize?client_id=${client.id}&redirect_uri=https://example.com&response_type=code&scope=invalid:scope&state=${state}`, {
				method: 'GET',
			})

			expect(response.status).toBe(302)
			const location = response.headers.get('Location')
			expect(location).toContain('state=' + state)
		})
	})

	describe('HTTP method validation', () => {
		it('should reject POST requests', async () => {
			const response = await SELF.fetch('http://localhost/oauth/authorize', {
				method: 'POST',
			})

			expect(response.status).toBe(405)
			const text = await response.text()
			expect(text).toContain('Method not allowed')
		})

		it('should reject PUT requests', async () => {
			const response = await SELF.fetch('http://localhost/oauth/authorize', {
				method: 'PUT',
			})

			expect(response.status).toBe(405)
		})

		it('should only accept GET requests', async () => {
			const response = await SELF.fetch('http://localhost/oauth/authorize?client_id=test&redirect_uri=https://example.com&response_type=code', {
				method: 'GET',
			})

			// Should not be a 405 error (though will be other error due to invalid client)
			expect(response.status).not.toBe(405)
		})
	})
})