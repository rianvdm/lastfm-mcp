// ABOUTME: Tests for OAuth 2.1 discovery endpoints required by MCP spec.
// ABOUTME: Verifies /.well-known/oauth-protected-resource and /.well-known/oauth-authorization-server return correct metadata.
import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import worker from '../src/index-oauth'

const BASE_URL = 'https://lastfm-mcp.com'

describe('OAuth discovery endpoints', () => {
	describe('/.well-known/oauth-protected-resource', () => {
		it('should return 200 with correct content type', async () => {
			const req = new Request(`${BASE_URL}/.well-known/oauth-protected-resource`)
			const res = await worker.fetch(req, env, {} as ExecutionContext)
			expect(res.status).toBe(200)
			expect(res.headers.get('content-type')).toContain('application/json')
		})

		it('should include resource field matching base URL', async () => {
			const req = new Request(`${BASE_URL}/.well-known/oauth-protected-resource`)
			const res = await worker.fetch(req, env, {} as ExecutionContext)
			const body = await res.json() as Record<string, unknown>
			expect(body.resource).toBe(BASE_URL)
		})

		it('should include authorization_servers array with base URL', async () => {
			const req = new Request(`${BASE_URL}/.well-known/oauth-protected-resource`)
			const res = await worker.fetch(req, env, {} as ExecutionContext)
			const body = await res.json() as Record<string, unknown>
			expect(Array.isArray(body.authorization_servers)).toBe(true)
			expect(body.authorization_servers).toContain(BASE_URL)
		})

		it('should include bearer_methods_supported with header', async () => {
			const req = new Request(`${BASE_URL}/.well-known/oauth-protected-resource`)
			const res = await worker.fetch(req, env, {} as ExecutionContext)
			const body = await res.json() as Record<string, unknown>
			expect(Array.isArray(body.bearer_methods_supported)).toBe(true)
			expect(body.bearer_methods_supported).toContain('header')
		})
	})

	describe('/.well-known/oauth-authorization-server', () => {
		it('should return 200 with correct content type', async () => {
			const req = new Request(`${BASE_URL}/.well-known/oauth-authorization-server`)
			const res = await worker.fetch(req, env, {} as ExecutionContext)
			expect(res.status).toBe(200)
			expect(res.headers.get('content-type')).toContain('application/json')
		})

		it('should include all required MCP OAuth fields', async () => {
			const req = new Request(`${BASE_URL}/.well-known/oauth-authorization-server`)
			const res = await worker.fetch(req, env, {} as ExecutionContext)
			const body = await res.json() as Record<string, unknown>
			expect(body.issuer).toBeDefined()
			expect(body.authorization_endpoint).toBeDefined()
			expect(body.token_endpoint).toBeDefined()
		})

		it('should support authorization_code grant type', async () => {
			const req = new Request(`${BASE_URL}/.well-known/oauth-authorization-server`)
			const res = await worker.fetch(req, env, {} as ExecutionContext)
			const body = await res.json() as Record<string, unknown>
			expect(Array.isArray(body.grant_types_supported)).toBe(true)
			expect(body.grant_types_supported).toContain('authorization_code')
		})

		it('should support code response type', async () => {
			const req = new Request(`${BASE_URL}/.well-known/oauth-authorization-server`)
			const res = await worker.fetch(req, env, {} as ExecutionContext)
			const body = await res.json() as Record<string, unknown>
			expect(Array.isArray(body.response_types_supported)).toBe(true)
			expect(body.response_types_supported).toContain('code')
		})

		it('should support S256 PKCE code challenge method', async () => {
			const req = new Request(`${BASE_URL}/.well-known/oauth-authorization-server`)
			const res = await worker.fetch(req, env, {} as ExecutionContext)
			const body = await res.json() as Record<string, unknown>
			expect(Array.isArray(body.code_challenge_methods_supported)).toBe(true)
			expect(body.code_challenge_methods_supported).toContain('S256')
		})
	})
})
