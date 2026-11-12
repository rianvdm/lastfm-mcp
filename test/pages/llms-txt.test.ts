// ABOUTME: Tests for the /llms.txt builder in src/pages/llms-txt.ts.
// ABOUTME: Checks the generated tool list (grouping, dedupe, sign-in line) and that the origin fills every placeholder.
import { describe, it, expect } from 'vitest'

import { AUTHENTICATED_TOOL_CATALOG, PUBLIC_TOOL_CATALOG } from '../../src/mcp/tools/catalog'
import { buildLlmsTxt, renderLlmsToolSection } from '../../src/pages/llms-txt'

// Words that would suggest a tool works without signing in
const NO_SIGN_IN_CLAIM = /no auth|without (signing in|auth)|public/i

/** Returns the lines under a `### heading`, up to the next heading or the end. */
function group(section: string, heading: string): string {
	const start = section.indexOf(`### ${heading}\n`)
	expect(start, `missing group: ${heading}`).toBeGreaterThanOrEqual(0)
	const rest = section.slice(start + heading.length + 5)
	const next = rest.indexOf('\n#')
	return next === -1 ? rest : rest.slice(0, next)
}

function occurrences(text: string, needle: string): number {
	return text.split(needle).length - 1
}

describe('llms.txt', () => {
	describe('renderLlmsToolSection', () => {
		it('lists every catalog tool exactly once', () => {
			const section = renderLlmsToolSection()
			const names = new Set([...PUBLIC_TOOL_CATALOG, ...AUTHENTICATED_TOOL_CATALOG].map((t) => t.name))

			for (const name of names) {
				expect(occurrences(section, `\`${name}\``), name).toBe(1)
			}
		})

		it('says once that all tools need sign-in', () => {
			const section = renderLlmsToolSection()

			expect(occurrences(section, 'All tools need you to sign in to Last.fm first.')).toBe(1)
			expect(section).not.toMatch(NO_SIGN_IN_CLAIM)
		})

		it('groups tools', () => {
			const section = renderLlmsToolSection()

			expect(group(section, 'Music lookups')).toContain('`get_artist_info`: Get detailed artist information')
			expect(group(section, 'Your listening history')).toContain('`get_recent_tracks`')

			const diagnostics = group(section, 'Diagnostics')
			for (const name of ['ping', 'server_info', 'lastfm_auth_status']) {
				expect(diagnostics).toContain(`\`${name}\``)
			}
			expect(section.lastIndexOf('### ')).toBe(section.indexOf('### Diagnostics'))
		})

		it('drops the auth-status wording that only makes sense inside that tool', () => {
			expect(renderLlmsToolSection()).not.toContain('(this tool)')
		})
	})

	describe('buildLlmsTxt', () => {
		it('fills the origin and leaves no placeholders', () => {
			const text = buildLlmsTxt('https://staging.example')

			expect(text).toContain('https://staging.example/mcp')
			expect(text).not.toContain('{{')
			expect(text.startsWith('# Last.fm MCP\n')).toBe(true)
		})

		it('never points at another server or suggests a tool works without sign-in', () => {
			const text = buildLlmsTxt('https://staging.example')

			expect(text).not.toContain('lastfm-mcp.com/mcp')
			expect(text).not.toMatch(NO_SIGN_IN_CLAIM)
			expect(text).not.toMatch(/revoke/i)
		})

		it('ends the agent steps with telling the human how to sign in', () => {
			const text = buildLlmsTxt('https://staging.example')
			const forAgents = text.slice(text.indexOf('## For agents setting this up'), text.indexOf('## Setup by client'))

			expect(forAgents).toContain("can't complete the Last.fm sign-in")
			expect(forAgents.trimEnd().split('\n').at(-1)).toContain('`/mcp`')
		})
	})
})
