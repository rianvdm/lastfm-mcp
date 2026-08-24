// ABOUTME: Registration smoke test for the MCP server built by createMcpServer.
// ABOUTME: Snapshots the advertised tools, prompts, and resources so a bad registration change cannot pass silently.
import { env } from 'cloudflare:test'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { describe, it, expect, beforeAll } from 'vitest'

import { createMcpServer } from '../../src/mcp/server'

// Tools that legitimately take no arguments. Every other tool must advertise at
// least one input property, otherwise a registration bug (schema dropped on the
// floor) would still "work" until a client passes an argument.
const ZERO_ARG_TOOLS = ['server_info', 'lastfm_auth_status']

// The five lastfm://user/{username}/... templates list one concrete resource each
// once a session exists; the five catalog templates (track/artist/album) have no list.
const LISTED_USER_RESOURCES = 5

async function connectClient() {
	const { server, setContext } = createMcpServer(env, 'https://example.com')
	setContext({ session: { username: 'testuser', sessionKey: 'test-session-key' } })
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	const client = new Client({ name: 'registration-smoke', version: '0.0.0' })
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
	return client
}

describe('createMcpServer registration', () => {
	let client: Client

	beforeAll(async () => {
		client = await connectClient()
	})

	it('advertises the expected tool catalogue', async () => {
		const { tools } = await client.listTools()
		const catalogue = tools
			.map((t) => ({
				name: t.name,
				description: t.description,
				properties: Object.keys(t.inputSchema.properties ?? {}).sort(),
				required: [...(t.inputSchema.required ?? [])].sort(),
			}))
			.sort((a, b) => a.name.localeCompare(b.name))

		expect(catalogue).toHaveLength(21)
		for (const tool of catalogue) {
			if (!ZERO_ARG_TOOLS.includes(tool.name)) {
				expect(tool.properties, `${tool.name} registered with an empty input schema`).not.toHaveLength(0)
			}
			expect(tool.description, `${tool.name} has no description`).toBeTruthy()
		}
		expect(catalogue).toMatchSnapshot()
	})

	it('advertises the expected prompt catalogue', async () => {
		const { prompts } = await client.listPrompts()
		const catalogue = prompts
			.map((p) => ({
				name: p.name,
				description: p.description,
				arguments: (p.arguments ?? []).map((a) => ({ name: a.name, required: a.required ?? false })),
			}))
			.sort((a, b) => a.name.localeCompare(b.name))

		expect(catalogue).toHaveLength(6)
		for (const prompt of catalogue) {
			expect(prompt.description, `${prompt.name} has no description`).toBeTruthy()
		}
		expect(catalogue).toMatchSnapshot()
	})

	it('advertises the expected resource templates', async () => {
		const { resourceTemplates } = await client.listResourceTemplates()
		const catalogue = resourceTemplates
			.map((r) => ({
				name: r.name,
				uriTemplate: r.uriTemplate,
				description: r.description,
				mimeType: r.mimeType,
			}))
			.sort((a, b) => a.name.localeCompare(b.name))

		expect(catalogue).toHaveLength(10)
		expect(catalogue).toMatchSnapshot()
	})

	it('advertises the resources each template lists', async () => {
		const { resources } = await client.listResources()
		const catalogue = resources
			.map((r) => ({
				name: r.name,
				uri: r.uri,
				description: r.description,
				mimeType: r.mimeType,
			}))
			.sort((a, b) => a.uri.localeCompare(b.uri))

		// If a template's `list` callback stops advertising, this count drops.
		expect(catalogue).toHaveLength(LISTED_USER_RESOURCES)
		for (const resource of catalogue) {
			expect(resource.uri).toContain('testuser')
			expect(resource.mimeType).toBe('application/json')
		}
		expect(catalogue).toMatchSnapshot()
	})
})
