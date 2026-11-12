// ABOUTME: Tests for the tool-call instrumentation that times and classifies every MCP tool call.
// ABOUTME: Drives a real McpServer over an in-memory transport and checks the emitted ToolCallEvent and the unchanged tool result.
import { env } from 'cloudflare:test'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

import type { ToolCallEvent } from '../../src/analytics/toolEvents'
import { instrumentTools } from '../../src/mcp/instrumentation'
import { createMcpServer } from '../../src/mcp/server'
import { AUTH_REQUIRED_HEADING } from '../../src/mcp/tools/authenticated'
import { toolError } from '../../src/mcp/tools/error-handler'
import { SmartCache, type CacheTally } from '../../src/utils/cache'

type ToolHandler = () => unknown

/** Registers one zero-argument tool per entry; called after instrumentTools so the wrapper applies. */
function registerTools(server: McpServer, tools: Record<string, ToolHandler>) {
	for (const [name, handler] of Object.entries(tools)) {
		server.registerTool(name, { description: `test tool ${name}`, inputSchema: z.object({}) }, async () => handler() as never)
	}
}

async function connect(server: McpServer): Promise<Client> {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	const client = new Client({ name: 'instrumentation-test', version: '0.0.0' })
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
	return client
}

/** Builds a server with `tools` registered, instrumented when `onToolCall` is given. */
async function serverWith(tools: Record<string, ToolHandler>, onToolCall?: (event: ToolCallEvent) => void, tally?: CacheTally) {
	const server = new McpServer({ name: 'instrumentation-test', version: '0.0.0' })
	if (onToolCall) instrumentTools(server, tally ?? { hits: 0, misses: 0 }, onToolCall)
	registerTools(server, tools)
	return connect(server)
}

/** A Map-backed KV with just the methods SmartCache calls. */
function memoryKV(): KVNamespace {
	const store = new Map<string, string>()
	return {
		get: async (key: string) => store.get(key) ?? null,
		put: async (key: string, value: string) => {
			store.set(key, value)
		},
		delete: async (key: string) => {
			store.delete(key)
		},
		list: async () => ({ keys: [...store.keys()].map((name) => ({ name })) }),
	} as unknown as KVNamespace
}

const okResult = { content: [{ type: 'text' as const, text: 'all good' }] }

describe('instrumentTools', () => {
	let events: ToolCallEvent[]
	let onToolCall: (event: ToolCallEvent) => void

	beforeEach(() => {
		events = []
		onToolCall = vi.fn((event: ToolCallEvent) => {
			events.push(event)
		})
		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('outcome', () => {
		it('should report ok with no cache lookup for a normal text result', async () => {
			const client = await serverWith({ plain: () => okResult }, onToolCall)

			await client.callTool({ name: 'plain', arguments: {} })

			expect(events).toHaveLength(1)
			expect(events[0]).toMatchObject({ tool: 'plain', outcome: 'ok', cache: 'none' })
			expect(events[0].durationMs).toBeGreaterThanOrEqual(0)
			expect(Object.keys(events[0]).sort()).toEqual(['cache', 'durationMs', 'outcome', 'tool'])
		})

		it('should report error for a toolError result', async () => {
			const client = await serverWith({ get_thing: () => toolError('get_thing', new Error('boom')) }, onToolCall)

			await client.callTool({ name: 'get_thing', arguments: {} })

			expect(events[0]).toMatchObject({ tool: 'get_thing', outcome: 'error' })
		})

		it('should report error for a result flagged isError', async () => {
			const client = await serverWith({ flagged: () => ({ ...okResult, isError: true }) }, onToolCall)

			await client.callTool({ name: 'flagged', arguments: {} })

			expect(events[0].outcome).toBe('error')
		})

		it('should report auth_required for the sign-in message', async () => {
			const text = `${AUTH_REQUIRED_HEADING}\n\nThis tool requires authentication with Last.fm.`
			const client = await serverWith({ needs_auth: () => ({ content: [{ type: 'text', text }] }) }, onToolCall)

			await client.callTool({ name: 'needs_auth', arguments: {} })

			expect(events[0].outcome).toBe('auth_required')
		})

		it('should report error for a throwing tool and leave the client-visible failure unchanged', async () => {
			const throwing = () => {
				throw new Error('kaboom')
			}
			const plainClient = await serverWith({ throws: throwing })
			const instrumentedClient = await serverWith({ throws: throwing }, onToolCall)

			const expected = await plainClient.callTool({ name: 'throws', arguments: {} })
			const actual = await instrumentedClient.callTool({ name: 'throws', arguments: {} })

			expect(actual).toEqual(expected)
			expect(actual.isError).toBe(true)
			expect(events[0]).toMatchObject({ tool: 'throws', outcome: 'error', cache: 'none' })
		})
	})

	describe('callback failures', () => {
		it('should return the uninstrumented result when onToolCall throws', async () => {
			const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
			const throwingCallback = vi.fn(() => {
				throw new Error('analytics down')
			})
			const plainClient = await serverWith({ plain: () => okResult })
			const instrumentedClient = await serverWith({ plain: () => okResult }, throwingCallback)

			const expected = await plainClient.callTool({ name: 'plain', arguments: {} })
			const actual = await instrumentedClient.callTool({ name: 'plain', arguments: {} })

			expect(throwingCallback).toHaveBeenCalledTimes(1)
			expect(actual).toEqual(expected)
			expect(errorLog).toHaveBeenCalledWith('[ANALYTICS] onToolCall failed:', 'analytics down')
		})

		it('should rethrow the tool error, not the callback error, when both throw', async () => {
			const throwingCallback = () => {
				throw new Error('analytics down')
			}
			const throwing = () => {
				throw new Error('kaboom')
			}
			const plainClient = await serverWith({ throws: throwing })
			const instrumentedClient = await serverWith({ throws: throwing }, throwingCallback)

			const expected = await plainClient.callTool({ name: 'throws', arguments: {} })
			const actual = await instrumentedClient.callTool({ name: 'throws', arguments: {} })

			expect(actual).toEqual(expected)
		})
	})

	describe('cache outcome', () => {
		it('should report miss then hit for the same lookup on one tally', async () => {
			const tally: CacheTally = { hits: 0, misses: 0 }
			const cache = new SmartCache(memoryKV(), {}, tally)
			const fetcher = vi.fn(async () => ({ name: 'Radiohead' }))
			const client = await serverWith(
				{
					lookup: async () => {
						const data = await cache.getOrFetch('artistInfo', 'radiohead', fetcher)
						return { content: [{ type: 'text', text: data.name }] }
					},
				},
				onToolCall,
				tally,
			)

			await client.callTool({ name: 'lookup', arguments: {} })
			await client.callTool({ name: 'lookup', arguments: {} })

			expect(fetcher).toHaveBeenCalledTimes(1)
			expect(tally).toEqual({ hits: 1, misses: 1 })
			expect(events.map((e) => e.cache)).toEqual(['miss', 'hit'])
		})
	})
})

describe('createMcpServer with onToolCall', () => {
	it('should report every tool call through onToolCall', async () => {
		const events: ToolCallEvent[] = []
		const { server } = createMcpServer(env, { onToolCall: (event) => events.push(event) })
		const client = await connect(server)

		await client.callTool({ name: 'ping', arguments: {} })
		await client.callTool({ name: 'get_recent_tracks', arguments: {} })

		expect(events.map(({ tool, outcome, cache }) => ({ tool, outcome, cache }))).toEqual([
			{ tool: 'ping', outcome: 'ok', cache: 'none' },
			{ tool: 'get_recent_tracks', outcome: 'auth_required', cache: 'none' },
		])
	})
})
