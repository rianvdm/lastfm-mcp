// ABOUTME: Tests for importing page sources as text modules and for the placeholder filler in src/pages/template.ts.
// ABOUTME: Proves the wrangler module rules work under vitest-pool-workers and that unfilled {{PLACEHOLDERS}} fail loudly.
import { describe, it, expect } from 'vitest'

import { fillPlaceholders } from '../../src/pages/template'
import pngFixture from '../fixtures/data-module.png'
import fixture from '../fixtures/text-module.html'
import markdownFixture from '../fixtures/text-module.md'

// The first eight bytes of every PNG file
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('page templates', () => {
	it('imports an .html file as a string', () => {
		expect(typeof fixture).toBe('string')
		expect(fixture).toContain('{{ORIGIN}}/mcp')
	})

	// Wrangler's default rules already cover .html; .md and .png need the rules wrangler.toml adds
	it('imports an .md file as a string', () => {
		expect(typeof markdownFixture).toBe('string')
		expect(markdownFixture).toContain('{{ORIGIN}}/mcp')
	})

	it('imports a .png file as an ArrayBuffer', () => {
		expect(pngFixture).toBeInstanceOf(ArrayBuffer)
		expect([...new Uint8Array(pngFixture, 0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE)
	})

	describe('fillPlaceholders', () => {
		it('fills every occurrence of a placeholder', () => {
			expect(fillPlaceholders('{{ORIGIN}}/mcp and {{ORIGIN}}/llms.txt', { ORIGIN: 'https://x.dev' })).toBe(
				'https://x.dev/mcp and https://x.dev/llms.txt',
			)
		})

		// String replacements would read $$ as $ and $& as the matched {{KEY}}; values must land literally
		it.each(['https://x.dev/$$', 'https://x.dev/$&'])('inserts %s literally, without expanding $ patterns', (value) => {
			expect(fillPlaceholders('{{ORIGIN}}/mcp', { ORIGIN: value })).toBe(`${value}/mcp`)
		})

		it('throws when a placeholder is left unfilled', () => {
			expect(() => fillPlaceholders('{{ORIGIN}} {{TOOLS}}', { ORIGIN: 'a' })).toThrow(/Unfilled placeholder: {{TOOLS}}/)
		})
	})
})
