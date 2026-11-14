// ABOUTME: Tests that get_artist_info, get_album_info, and get_track_info default to the signed-in user's username.
// ABOUTME: Drives the registered public tool handlers through a stub server, a stubbed client, and a session accessor.
import { describe, it, expect, vi } from 'vitest'
import type { z } from 'zod'

import type { CachedLastfmClient } from '../../../src/clients/cachedLastfm'
import type { AuthSession } from '../../../src/mcp/tools/authenticated'
import { registerPublicTools } from '../../../src/mcp/tools/public'

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>

interface ToolMeta {
	inputSchema: z.ZodType
}

const SIGN_IN_NOTE = 'Sign in to see your personal listening stats'

function stubClient() {
	return {
		getArtistInfo: vi.fn(async () => ({
			artist: { name: 'Slowdive', stats: { playcount: '1000', listeners: '500', userplaycount: '42' } },
		})),
		getAlbumInfo: vi.fn(async () => ({
			album: { name: 'Souvlaki', artist: 'Slowdive', playcount: '1000', listeners: '500', userplaycount: '42' },
		})),
		getTrackInfo: vi.fn(async () => ({
			track: {
				name: 'Alison',
				artist: { '#text': 'Slowdive' },
				album: { '#text': 'Souvlaki' },
				playcount: '1000',
				listeners: '500',
				userplaycount: '42',
			},
		})),
	}
}

type Client = ReturnType<typeof stubClient>

/** Each tool, its lookup arguments, and how to read the username it passed to the client. */
const CASES: Array<[string, Record<string, unknown>, (client: Client) => unknown]> = [
	['get_artist_info', { artist: 'Slowdive' }, (client) => client.getArtistInfo.mock.calls[0]],
	['get_album_info', { artist: 'Slowdive', album: 'Souvlaki' }, (client) => client.getAlbumInfo.mock.calls[0]],
	['get_track_info', { artist: 'Slowdive', track: 'Alison' }, (client) => client.getTrackInfo.mock.calls[0]],
]

/** Registers the public tools against a fresh stub client and the given session accessor. */
function setup(getSession: () => AuthSession | null) {
	const tools = new Map<string, { meta: ToolMeta; handler: ToolHandler }>()
	const server = {
		registerTool: (name: string, meta: ToolMeta, handler: ToolHandler) => {
			tools.set(name, { meta, handler })
		},
	}
	const client = stubClient()
	registerPublicTools(server as never, client as unknown as CachedLastfmClient, getSession)

	/** Calls a handler with arguments parsed by the tool's own schema, as the SDK does. */
	async function textOf(name: string, args: Record<string, unknown>): Promise<string> {
		const { meta, handler } = tools.get(name)!
		const result = await handler(meta.inputSchema.parse(args) as Record<string, unknown>)
		return result.content[0].text
	}

	return { client, textOf }
}

const signedIn = () => ({ username: 'rj', sessionKey: 'key' })

describe('public lookups default to the signed-in user', () => {
	it.each(CASES)('%s uses the session username when none is given', async (name, args, callOf) => {
		const { client, textOf } = setup(signedIn)
		const text = await textOf(name, args)
		expect((callOf(client) as unknown[]).at(-1)).toBe('rj')
		expect(text).toContain('Plays by rj: 42')
		expect(text).not.toContain(SIGN_IN_NOTE)
	})

	it.each(CASES)('%s prefers an explicit username over the session', async (name, args, callOf) => {
		const { client, textOf } = setup(signedIn)
		await textOf(name, { ...args, username: 'someone' })
		expect((callOf(client) as unknown[]).at(-1)).toBe('someone')
	})

	it.each(CASES)('%s still works signed out and shows the sign-in note', async (name, args, callOf) => {
		const { client, textOf } = setup(() => null)
		const text = await textOf(name, args)
		expect((callOf(client) as unknown[]).at(-1)).toBeUndefined()
		expect(text).not.toContain('Plays by')
		expect(text).toContain(SIGN_IN_NOTE)
	})

	it('reads the session at call time, not at registration', async () => {
		let session: AuthSession | null = null
		const { client, textOf } = setup(() => session)
		session = { username: 'rj', sessionKey: 'key' }
		await textOf('get_artist_info', { artist: 'Slowdive' })
		expect(client.getArtistInfo.mock.calls[0]).toEqual(['Slowdive', 'rj'])
	})
})
