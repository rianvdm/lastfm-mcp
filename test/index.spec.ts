import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import worker from '../src'

describe('Discogs MCP Server', () => {
	it('should return 501 not implemented', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(501)
		expect(await response.text()).toBe('MCP Server - Not yet implemented')
	})
})
