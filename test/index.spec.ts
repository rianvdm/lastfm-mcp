import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import worker from '../src'

describe('Discogs MCP Server', () => {
	it('should handle initialize request', async () => {
		const initRequest = {
			jsonrpc: '2.0',
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: {
					name: 'TestClient',
					version: '1.0.0',
				},
			},
			id: 1,
		}

		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/', {
			method: 'POST',
			body: JSON.stringify(initRequest),
			headers: {
				'Content-Type': 'application/json',
			},
		})

		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('application/json')

		const result = await response.json()
		expect(result).toMatchObject({
			jsonrpc: '2.0',
			id: 1,
			result: {
				protocolVersion: '2024-11-05',
				capabilities: {
					prompts: { listChanged: true },
					resources: { subscribe: false, listChanged: true },
					tools: { listChanged: true },
					logging: {},
				},
				serverInfo: {
					name: 'discogs-mcp',
					version: '1.0.0',
				},
			},
		})
	})

	it('should reject GET requests to main endpoint', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(405)
		expect(await response.text()).toBe('Method not allowed')
	})

	it('should handle parse errors', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/', {
			method: 'POST',
			body: 'invalid json',
		})

		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200) // JSON-RPC errors still return 200
		const result = await response.json()
		expect(result).toMatchObject({
			jsonrpc: '2.0',
			id: null,
			error: {
				code: -32700,
				message: 'Parse error',
			},
		})
	})

	it('should handle empty body', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/', {
			method: 'POST',
			body: '',
		})

		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const result = await response.json()
		expect(result).toMatchObject({
			jsonrpc: '2.0',
			id: null,
			error: {
				code: -32600,
				message: 'Empty request body',
			},
		})
	})

	it('should return 404 for unknown paths', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/unknown')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(404)
	})

	describe('SSE endpoint', () => {
		it('should accept GET requests to /sse', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/sse')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			expect(response.headers.get('content-type')).toBe('text/event-stream')
			expect(response.headers.get('cache-control')).toBe('no-cache')
		})

		it('should reject POST requests to /sse', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/sse', {
				method: 'POST',
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(405)
		})
	})
})
