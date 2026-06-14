import { describe, it, expect } from 'vitest'
import { formatArtist, toArray } from '../../../src/mcp/tools/formatters'

describe('toArray', () => {
	// Last.fm serialises a multi-element collection as an array.
	it('returns an array unchanged', () => {
		const input = [{ name: 'rock' }, { name: 'indie' }]
		expect(toArray(input)).toEqual([{ name: 'rock' }, { name: 'indie' }])
	})

	// Last.fm serialises a single-element collection as a bare object, not an array.
	it('wraps a single object in an array', () => {
		const input = { name: 'rock' }
		expect(toArray(input)).toEqual([{ name: 'rock' }])
	})

	// Last.fm omits empty collections entirely (undefined after optional chaining).
	it('returns an empty array for undefined', () => {
		expect(toArray(undefined)).toEqual([])
	})

	it('returns an empty array for null', () => {
		expect(toArray(null)).toEqual([])
	})

	// Some Last.fm endpoints represent an empty collection as an empty string.
	it('returns an empty array for an empty string', () => {
		expect(toArray('' as unknown as { name: string })).toEqual([])
	})

	it('returns an empty array unchanged', () => {
		expect(toArray([])).toEqual([])
	})

	// The downstream usage: .slice().map() must not throw for any of the shapes above.
	it('supports slice/map chaining on a single-object input', () => {
		const tags = toArray<{ name: string }>({ name: 'rock' })
			.slice(0, 5)
			.map((t) => t.name)
			.join(', ')
		expect(tags).toBe('rock')
	})

	it('supports slice/map chaining on an absent input', () => {
		const tags = toArray<{ name: string }>(undefined)
			.slice(0, 5)
			.map((t) => t.name)
			.join(', ')
		expect(tags).toBe('')
	})
})

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
