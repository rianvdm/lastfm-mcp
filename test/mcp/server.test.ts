// ABOUTME: Registration smoke test for the MCP server built by createMcpServer.
// ABOUTME: Snapshots the advertised tools, prompts, and resources, and checks the instructions, discovery prompt, and OAuth-only sign-in guidance.
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

async function connectClient({ signedIn = true } = {}) {
	const { server, setContext } = createMcpServer(env)
	if (signedIn) setContext({ session: { username: 'testuser', sessionKey: 'test-session-key' } })
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

	// Clients use these hints to decide whether a call needs the user's confirmation, and directories
	// (Claude's connectors directory, ChatGPT) require them. Every tool only reads, so a tool that
	// ships without them is a bug.
	it('marks every tool read-only, with a title', async () => {
		const { tools } = await client.listTools()
		const localOnly = ['ping', 'server_info', 'lastfm_auth_status']

		for (const tool of tools) {
			expect(tool.title, `${tool.name} has no title`).toBeTruthy()
			// Every MCP request needs Last.fm sign-in, so no description may say a tool works without it
			expect(tool.description, `${tool.name} claims it needs no sign-in`).not.toMatch(/no authentication required|for private profiles/i)
			expect(tool.annotations, `${tool.name} has no annotations`).toEqual({
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: !localOnly.includes(tool.name),
			})
		}
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

describe('pointing agents at get_music_recommendations', () => {
	let client: Client

	beforeAll(async () => {
		client = await connectClient()
	})

	it('names get_music_recommendations in the server instructions', () => {
		expect(client.getInstructions()).toContain('`get_music_recommendations` returns new-to-the-user artists')
	})

	it('music_discovery advertises only an optional genre', async () => {
		const { prompts } = await client.listPrompts()
		const prompt = prompts.find((p) => p.name === 'music_discovery')
		expect(prompt?.arguments).toEqual([{ name: 'genre', description: 'Optional genre, as a Last.fm tag', required: false }])
	})

	it('music_discovery tells the agent to call get_music_recommendations', async () => {
		const promptText = async (args: Record<string, string>) => {
			const { messages } = await client.getPrompt({ name: 'music_discovery', arguments: args })
			return (messages[0].content as { type: string; text: string }).text
		}

		expect(await promptText({})).toBe(
			'Find new music for me. Call get_music_recommendations. Present each pick with its reason and starter tracks, keeping the reasons grounded in my listening data. If I reject a pick, call the tool again with it in exclude.',
		)
		expect(await promptText({ genre: 'shoegaze' })).toBe(
			'Find new music for me in shoegaze. Call get_music_recommendations with genre="shoegaze". Present each pick with its reason and starter tracks, keeping the reasons grounded in my listening data. If I reject a pick, call the tool again with it in exclude.',
		)
	})
})

describe('sign-in guidance without a session', () => {
	let client: Client

	beforeAll(async () => {
		client = await connectClient({ signedIn: false })
	})

	async function toolText(name: string, args: Record<string, unknown> = {}): Promise<string> {
		const result = await client.callTool({ name, arguments: args })
		return (result.content as { type: string; text: string }[]).map((c) => c.text).join('\n')
	}

	// The manual /login flow is gone; every client signs in through MCP OAuth.
	it.each([
		['server_info', {}],
		['lastfm_auth_status', {}],
		['get_recent_tracks', {}],
	])('%s should point at OAuth, not a /login URL', async (name, args) => {
		const text = await toolText(name, args)
		expect(text).toContain('MCP client')
		expect(text).not.toContain('/login')
		expect(text).not.toContain('session_id')
	})

	it('lastfm_auth_status should tell the user to reconnect so the client signs in', async () => {
		expect(await toolText('lastfm_auth_status')).toContain('reconnect')
	})
})
