import { describe, it, expect } from 'vitest'
import { formatArtist } from '../../../src/mcp/tools/formatters'

describe('formatArtist', () => {
	it('returns a string artist unchanged', () => {
		expect(formatArtist('Radiohead')).toBe('Radiohead')
	})

	it('extracts name from an object artist', () => {
		expect(formatArtist({ name: 'Radiohead' })).toBe('Radiohead')
	})

	it('falls back to Unknown Artist for nullish input', () => {
		expect(formatArtist(undefined)).toBe('Unknown Artist')
		expect(formatArtist(null)).toBe('Unknown Artist')
	})
})
