// ABOUTME: Tests for the pure recommendation scoring functions: seed selection, candidate ranking, genre and exclude filters.
// ABOUTME: Covers window weighting, summed evidence, name normalisation, the fan-out cap, genre top-up and exclude-then-limit.

import { describe, it, expect } from 'vitest'

import {
	MAX_FANOUT_SEEDS,
	WINDOW_WEIGHTS,
	applyExclude,
	applyGenre,
	normaliseArtist,
	rankCandidates,
	selectSeeds,
} from '../../src/recommendations/scoring'
import type { Candidate, SeedRef } from '../../src/recommendations/types'

type Similar = Map<string, Array<{ name: string; match: number }>>

function similarCandidate(name: string, score: number): Candidate {
	return { name, score, seeds: [], source: 'similar' }
}

describe('scoring', () => {
	it('should weigh recent windows above older ones', () => {
		const seeds: SeedRef[] = [
			{ name: 'B', window: '12month', rank: 1 },
			{ name: 'A', window: '7day', rank: 1 },
		]
		const similar: Similar = new Map([
			['a', [{ name: 'X', match: 1 }]],
			['b', [{ name: 'Y', match: 1 }]],
		])

		const ranked = rankCandidates(seeds, similar, new Set(['A', 'B']))

		expect(ranked.map((c) => c.name)).toEqual(['X', 'Y'])
		expect(ranked[0].score).toBe(3)
		expect(ranked[1].score).toBe(1)
		expect(ranked[0]).toMatchObject({ source: 'similar', seeds: [{ name: 'A', window: '7day', rank: 1 }] })
		expect(WINDOW_WEIGHTS).toEqual({ '7day': 3, '1month': 2, '12month': 1, overall: 0.5 })
	})

	it('should sum evidence from several seeds', () => {
		// Weakest seed first, so the evidence order below comes from the sort, not from the input order
		const seeds: SeedRef[] = [
			{ name: 'C', window: '12month', rank: 1 },
			{ name: 'B', window: '1month', rank: 1 },
			{ name: 'A', window: '7day', rank: 1 },
		]
		// X: 3 × 0.5 + 2 × 0.6 = 2.7 from two seeds; Y: 3 × 0.8 = 2.4 from one stronger seed.
		const similar: Similar = new Map([
			[
				'a',
				[
					{ name: 'Y', match: 0.8 },
					{ name: 'X', match: 0.5 },
				],
			],
			['b', [{ name: 'X', match: 0.6 }]],
		])

		const ranked = rankCandidates(seeds, similar, new Set())

		expect(ranked.map((c) => c.name)).toEqual(['X', 'Y'])
		expect(ranked[0].score).toBeCloseTo(2.7)
		expect(ranked[1].score).toBeCloseTo(2.4)
		// Seeds are ordered by their contribution: B gives 1.2, A gives 1.5.
		expect(ranked[0].seeds.map((s) => s.name)).toEqual(['A', 'B'])

		// Ties: equal score from two seeds beats one seed; equal score and seed count fall back to name.
		const tieSimilar: Similar = new Map([
			[
				'a',
				[
					{ name: 'Beta', match: 0.5 },
					{ name: 'Alpha', match: 0.5 },
				],
			],
			[
				'b',
				[
					{ name: 'Solo', match: 1 },
					{ name: 'Zed', match: 0.5 },
				],
			],
			['c', [{ name: 'Zed', match: 1 }]],
		])
		const tied = rankCandidates(seeds, tieSimilar, new Set())

		// Zed 2 (two seeds), Solo 2 (one seed), Alpha 1.5 and Beta 1.5 (one seed each).
		expect(tied.map((c) => c.name)).toEqual(['Zed', 'Solo', 'Alpha', 'Beta'])
	})

	it('should treat name variants as the same artist', () => {
		expect(normaliseArtist('  The National ')).toBe('the national')

		const seeds: SeedRef[] = [{ name: 'Bon Iver', window: '7day', rank: 1 }]
		const similar: Similar = new Map([
			[
				'bon iver',
				[
					{ name: 'the national ', match: 1 },
					{ name: 'Sufjan Stevens', match: 0.9 },
					{ name: 'BON IVER', match: 0.8 },
				],
			],
		])

		const ranked = rankCandidates(seeds, similar, new Set(['The National']))

		expect(ranked.map((c) => c.name)).toEqual(['Sufjan Stevens'])

		const selected = selectSeeds({
			'7day': ['Radiohead', 'Bon Iver'],
			'12month': ['bon iver ', 'Radiohead', 'Low'],
		})

		expect(selected).toEqual([
			{ name: 'Radiohead', window: '7day', rank: 1 },
			{ name: 'Bon Iver', window: '7day', rank: 2 },
			{ name: 'Low', window: '12month', rank: 3 },
		])
	})

	it('should cap fan-out seeds at 12 and use only the top 10 overall', () => {
		expect(MAX_FANOUT_SEEDS).toBe(12)

		const overall = Array.from({ length: 20 }, (_, i) => `Overall ${i + 1}`)
		const overallOnly = selectSeeds({ overall })

		expect(overallOnly).toHaveLength(10)
		expect(overallOnly.every((s) => s.window === 'overall')).toBe(true)
		expect(overallOnly.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

		const selected = selectSeeds({
			overall,
			'12month': ['Year 1', 'Year 2', 'Year 3'],
			'1month': ['Month 1', 'Month 2', 'Month 3', 'Month 4'],
			'7day': ['Week 1', 'Week 2', 'Week 3'],
		})

		expect(selected).toHaveLength(12)
		expect(selected.map((s) => s.name)).toEqual([
			'Week 1',
			'Week 2',
			'Week 3',
			'Month 1',
			'Month 2',
			'Month 3',
			'Month 4',
			'Year 1',
			'Year 2',
			'Year 3',
			'Overall 1',
			'Overall 2',
		])

		// Overall artists ranked below 10 never become seeds, even with room to spare.
		const short = selectSeeds({ '7day': ['Week 1'], overall })
		expect(short.map((s) => s.name)).not.toContain('Overall 11')
	})

	it('should keep only tag artists and top up in tag order', () => {
		const candidates: Candidate[] = [similarCandidate('X', 5), similarCandidate('Not Jazz', 4)]
		const tagArtists = ['T1', 't2', 'Library Artist', 'T3', 'x']
		const library = new Set(['library artist'])

		const topped = applyGenre(candidates, tagArtists, library, 3)

		expect(topped.map((c) => c.name)).toEqual(['X', 'T1', 't2'])
		expect(topped[0]).toMatchObject({ source: 'similar', score: 5 })
		expect(topped[1]).toMatchObject({ source: 'tag', tagRank: 1, seeds: [] })
		expect(topped[2]).toMatchObject({ source: 'tag', tagRank: 2, seeds: [] })

		// With room for one more, the library artist at tag rank 3 is skipped for T3 at rank 4.
		const wider = applyGenre(candidates, tagArtists, library, 4)

		expect(wider.map((c) => c.name)).toEqual(['X', 'T1', 't2', 'T3'])
		expect(wider[3]).toMatchObject({ source: 'tag', tagRank: 4 })
	})

	it('should drop excluded artists case-insensitively and then apply limit', () => {
		const candidates = ['A', 'B', 'C', 'D', 'E'].map((name, i) => similarCandidate(name, 5 - i))

		const result = applyExclude(candidates, [' b ', 'D', 'Not A Candidate'], 2)

		expect(result.map((c) => c.name)).toEqual(['A', 'C'])
		expect(applyExclude(candidates, ['a'], 10).map((c) => c.name)).toEqual(['B', 'C', 'D', 'E'])
	})
})
