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
import { SmartCache } from '../../src/utils/cache'
import { countLastfmRequest } from '../../src/utils/cacheTally'

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
async function serverWith(tools: Record<string, ToolHandler>, onToolCall?: (event: ToolCallEvent) => void) {
	const server = new McpServer({ name: 'instrumentation-test', version: '0.0.0' })
	if (onToolCall) instrumentTools(server, onToolCall)
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
			expect(Object.keys(events[0]).sort()).toEqual(['cache', 'durationMs', 'lastfmRequests', 'outcome', 'tool'])
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

	describe('calls the SDK rejects before the tool runs', () => {
		/** Registers `needs_artist`, whose input schema requires a string `artist`, on a plain or an instrumented server. */
		async function artistServer(instrumented: boolean) {
			const server = new McpServer({ name: 'instrumentation-test', version: '0.0.0' })
			if (instrumented) instrumentTools(server, onToolCall)
			server.registerTool('needs_artist', { description: 'test tool', inputSchema: z.object({ artist: z.string() }) }, async () => okResult)
			return connect(server)
		}

		it('should report one error event, without arguments or error text, for invalid arguments', async () => {
			const plainClient = await artistServer(false)
			const instrumentedClient = await artistServer(true)

			const expected = await plainClient.callTool({ name: 'needs_artist', arguments: { artist: 42 } })
			const actual = await instrumentedClient.callTool({ name: 'needs_artist', arguments: { artist: 42 } })

			expect(actual).toEqual(expected)
			expect(actual.isError).toBe(true)
			expect(events).toHaveLength(1)
			expect(events[0]).toMatchObject({ tool: 'needs_artist', outcome: 'error', cache: 'none' })
			expect(Object.keys(events[0]).sort()).toEqual(['cache', 'durationMs', 'lastfmRequests', 'outcome', 'tool'])
		})

		it('should report one unknown_tool error event, never the requested name, for an unknown tool', async () => {
			const plainClient = await artistServer(false)
			const instrumentedClient = await artistServer(true)
			const call = (client: Client) => client.callTool({ name: 'rianvdm_secret_tool', arguments: {} }).catch((error: unknown) => error)

			const expected = await call(plainClient)
			const actual = await call(instrumentedClient)

			expect(actual).toEqual(expected)
			expect(events).toHaveLength(1)
			expect(events[0]).toMatchObject({ tool: 'unknown_tool', outcome: 'error', cache: 'none' })
			expect(JSON.stringify(events)).not.toContain('rianvdm')
		})

		it('should report one event per call for a valid call', async () => {
			const client = await artistServer(true)

			await client.callTool({ name: 'needs_artist', arguments: { artist: 'Radiohead' } })

			expect(events).toEqual([expect.objectContaining({ tool: 'needs_artist', outcome: 'ok' })])
		})
	})

	describe('setup', () => {
		it('should refuse a server whose tools/call handler is already installed', () => {
			const server = new McpServer({ name: 'instrumentation-test', version: '0.0.0' })
			registerTools(server, { plain: () => okResult })

			expect(() => instrumentTools(server, onToolCall)).toThrow(/tools\/call/)
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
		it('should report miss then hit for the same lookup', async () => {
			const cache = new SmartCache(memoryKV())
			const fetcher = vi.fn(async () => ({ name: 'Radiohead' }))
			const client = await serverWith(
				{
					lookup: async () => {
						const data = await cache.getOrFetch('artistInfo', 'radiohead', fetcher)
						return { content: [{ type: 'text', text: data.name }] }
					},
				},
				onToolCall,
			)

			await client.callTool({ name: 'lookup', arguments: {} })
			await client.callTool({ name: 'lookup', arguments: {} })

			expect(fetcher).toHaveBeenCalledTimes(1)
			expect(events.map((e) => e.cache)).toEqual(['miss', 'hit'])
		})

		it('should keep concurrent calls from sharing a cache outcome', async () => {
			// A JSON-RPC batch dispatches its calls concurrently on one server. `idle` starts first and is still running
			// when `lookup` misses the cache, so a server-wide count would wrongly charge the miss to `idle` as well.
			const cache = new SmartCache(memoryKV())
			let releaseIdle: () => void = () => {}
			const idleGate = new Promise<void>((resolve) => (releaseIdle = resolve))
			const client = await serverWith(
				{
					idle: async () => {
						await idleGate
						return okResult
					},
					lookup: async () => {
						const data = await cache.getOrFetch('artistInfo', 'radiohead', async () => ({ name: 'Radiohead' }))
						releaseIdle()
						return { content: [{ type: 'text', text: data.name }] }
					},
				},
				onToolCall,
			)

			await Promise.all([client.callTool({ name: 'idle', arguments: {} }), client.callTool({ name: 'lookup', arguments: {} })])

			const cacheByTool = Object.fromEntries(events.map((e) => [e.tool, e.cache]))
			expect(cacheByTool).toEqual({ idle: 'none', lookup: 'miss' })
		})
	})

	describe('Last.fm requests', () => {
		it('should report how many Last.fm requests the call made', async () => {
			const client = await serverWith(
				{
					three_requests: () => {
						countLastfmRequest()
						countLastfmRequest()
						countLastfmRequest()
						return okResult
					},
					no_requests: () => okResult,
				},
				onToolCall,
			)

			await client.callTool({ name: 'three_requests', arguments: {} })
			await client.callTool({ name: 'no_requests', arguments: {} })

			const requestsByTool = Object.fromEntries(events.map((e) => [e.tool, e.lastfmRequests]))
			expect(requestsByTool).toEqual({ three_requests: 3, no_requests: 0 })
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

describe('createMcpServer cache attribution', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('should charge a Last.fm lookup to the tool that made it, not to a concurrent ping', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		const artist = `Artist ${crypto.randomUUID()}`
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
			Response.json({ artist: { name: artist, url: 'https://www.last.fm/music/x', stats: { listeners: '1', playcount: '1' } } }),
		)
		const events: ToolCallEvent[] = []
		const { server } = createMcpServer(env, { onToolCall: (event) => events.push(event) })
		const client = await connect(server)

		await Promise.all([
			client.callTool({ name: 'get_artist_info', arguments: { artist } }),
			client.callTool({ name: 'ping', arguments: {} }),
		])

		const cacheByTool = Object.fromEntries(events.map((e) => [e.tool, e.cache]))
		expect(cacheByTool).toEqual({ get_artist_info: 'miss', ping: 'none' })
	})
})
