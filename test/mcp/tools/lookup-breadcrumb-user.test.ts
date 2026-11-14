// ABOUTME: Tests that lookup breadcrumbs (get_artist_info, get_album_info, get_track_info) keep the user a result was for.
// ABOUTME: Drives public and authenticated handlers, signed in as alice, through a stub server and a stubbed Last.fm client.
import { describe, it, expect, vi } from 'vitest'
import type { z } from 'zod'

import type { CachedLastfmClient } from '../../../src/clients/cachedLastfm'
import type { AuthSession } from '../../../src/mcp/tools/authenticated'
import { registerAuthenticatedTools } from '../../../src/mcp/tools/authenticated'
import { registerPublicTools } from '../../../src/mcp/tools/public'

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>

interface ToolMeta {
	inputSchema: z.ZodType
}

const LOOKUPS = ['get_artist_info', 'get_album_info', 'get_track_info']

function stubClient() {
	return {
		getRecentTracks: vi.fn(async () => ({
			recenttracks: {
				track: [{ name: 'Alison', artist: { '#text': 'Slowdive' }, url: '', streamable: '0', date: { uts: '1700000000', '#text': '' } }],
				'@attr': { user: 'x', page: '1', perPage: '50', total: '1', totalPages: '1' },
			},
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

/** Registers the public and authenticated tools against a stub client and the given session. */
function setup(session: AuthSession | null) {
	const tools = new Map<string, { meta: ToolMeta; handler: ToolHandler }>()
	const server = {
		registerTool: (name: string, meta: ToolMeta, handler: ToolHandler) => {
			tools.set(name, { meta, handler })
		},
	}
	const client = stubClient() as unknown as CachedLastfmClient
	registerPublicTools(server as never, client, () => session)
	registerAuthenticatedTools(server as never, client, () => session)

	/** Calls a handler with arguments parsed by the tool's own schema, as the SDK does. */
	return async function textOf(name: string, args: Record<string, unknown>): Promise<string> {
		const { meta, handler } = tools.get(name)!
		const result = await handler(meta.inputSchema.parse(args) as Record<string, unknown>)
		return result.content[0].text
	}
}

/** The Next steps lines that call one of the user-defaulting lookups. */
function lookupSteps(text: string): string[] {
	const steps = text.split('**Next steps:**')[1] ?? ''
	return steps.split('\n').filter((line) => LOOKUPS.some((tool) => line.startsWith(`- \`${tool}(`)))
}

const alice = { username: 'alice', sessionKey: 'key' }

/** A history tool and a public lookup, each with the arguments for one call. */
const CASES: Array<[string, Record<string, unknown>]> = [
	['get_recent_tracks', {}],
	['get_album_info', { artist: 'Slowdive', album: 'Souvlaki' }],
	['get_track_info', { artist: 'Slowdive', track: 'Alison' }],
]

describe('lookup breadcrumbs keep the user the result was for', () => {
	it.each(CASES)('%s for another user passes username to every lookup it suggests', async (name, args) => {
		const textOf = setup(alice)

		const steps = lookupSteps(await textOf(name, { ...args, username: 'bob' }))

		expect(steps.length).toBeGreaterThan(0)
		for (const step of steps) expect(step).toContain('username="bob"')
	})

	it.each(CASES)('%s for the signed-in user suggests lookups without a username', async (name, args) => {
		const textOf = setup(alice)

		for (const username of [undefined, 'alice', 'Alice']) {
			const steps = lookupSteps(await textOf(name, { ...args, username }))
			expect(steps.length).toBeGreaterThan(0)
			for (const step of steps) expect(step).not.toContain('username=')
		}
	})

	it('keeps an explicit username in lookup breadcrumbs when nobody is signed in', async () => {
		const textOf = setup(null)

		const steps = lookupSteps(await textOf('get_album_info', { artist: 'Slowdive', album: 'Souvlaki', username: 'bob' }))

		for (const step of steps) expect(step).toContain('username="bob"')
	})

	it('names whose plays a lookup shows', async () => {
		const textOf = setup(alice)

		expect(await textOf('get_album_info', { artist: 'Slowdive', album: 'Souvlaki', username: 'bob' })).toContain('• Plays by bob: 42')
		expect(await textOf('get_track_info', { artist: 'Slowdive', track: 'Alison' })).toContain('• Plays by alice: 42')
	})
})
