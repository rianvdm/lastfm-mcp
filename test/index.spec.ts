import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import worker from '../src'

describe('Discogs MCP Server', () => {
	describe('HTTP method handling', () => {
		it('should reject GET requests', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(405)
			expect(await response.text()).toBe('Method not allowed')
		})

		it('should accept POST requests', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/', {
				method: 'POST',
				body: 'ping',
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
		})
	})

	describe('MCP command routing', () => {
		it('should respond to ping with pong', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/', {
				method: 'POST',
				body: 'ping',
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
			expect(await response.text()).toBe('pong')
		})

		it('should handle unknown commands', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/', {
				method: 'POST',
				body: 'unknown-command',
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			expect(await response.text()).toBe('Unknown command')
		})

		it('should handle errors gracefully', async () => {
			// Test with invalid body that would cause JSON.parse to fail if we were parsing JSON
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/', {
				method: 'POST',
				body: '',
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
			expect(await response.text()).toBe('Unknown command')
		})
	})
})
