// ABOUTME: Unit tests for the artist-name matching helpers used by the history filter tools.
// ABOUTME: Covers normalisation, exact matching and near-miss suggestions.
import { describe, it, expect } from 'vitest'

import { isSameArtist, normalizeArtistName, suggestArtistNames } from '../../../src/mcp/tools/artistMatch'

describe('normalizeArtistName', () => {
	it('trims, lower-cases and composes Unicode', () => {
		expect(normalizeArtistName('  Sigur Rós ')).toBe('sigur rós')
	})
})

describe('isSameArtist', () => {
	it('ignores case and surrounding whitespace', () => {
		expect(isSameArtist('The Paper Kites', '  the paper kites ')).toBe(true)
	})

	it('treats composed and decomposed accents as equal', () => {
		expect(isSameArtist('Sigur Rós', 'Sigur Rós')).toBe(true)
		expect(isSameArtist('Sigur Rós', 'Sigur Rós')).toBe(true)
	})

	it('does not match a longer name', () => {
		expect(isSameArtist('Slowdive', 'Slowdive Tribute')).toBe(false)
	})
})

describe('suggestArtistNames', () => {
	it('returns distinct near matches in input order', () => {
		expect(suggestArtistNames(['The Paper Kites', 'Kites', 'Pink Floyd', 'The Paper Kites'], 'Paper Kites')).toEqual([
			'The Paper Kites',
			'Kites',
		])
	})

	it('excludes exact matches', () => {
		expect(suggestArtistNames(['Slowdive', 'Slowdive Tribute'], 'slowdive')).toEqual(['Slowdive Tribute'])
	})

	it('suggests a name contained in the query only when it has 3+ characters', () => {
		expect(suggestArtistNames(['Mu', 'Muse'], 'Muse Tribute')).toEqual(['Muse'])
	})

	it('caps the result at max (default 5)', () => {
		const names = Array.from({ length: 10 }, (_, i) => `x${i}`)
		expect(suggestArtistNames(names, 'x')).toHaveLength(5)
		expect(suggestArtistNames(names, 'x', 2)).toHaveLength(2)
	})

	it('returns [] for an empty list', () => {
		expect(suggestArtistNames([], 'x')).toEqual([])
	})
})
