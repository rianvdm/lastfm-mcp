// ABOUTME: Tests for the recommendation formatter: heading, reason lines, starters, partial note and empty states.
// ABOUTME: Checks the exact user-facing copy and that Next steps carries the request's username and the growing exclude list.

import { describe, it, expect } from 'vitest'

import { MAX_EXCLUDE, type Pick, type RecommendationResult } from '../../src/recommendations/engine'
import { formatRecommendations } from '../../src/recommendations/format'

const PARTIAL_NOTE =
	'_Some lookups were skipped to keep this fast, so this list may be shorter or missing starter tracks. Ask again in a minute for the full set._'

function pick(overrides: Partial<Pick> = {}): Pick {
	return {
		name: 'Chapterhouse',
		seeds: [
			{ name: 'Slowdive', window: '7day', rank: 2 },
			{ name: 'Mojave 3', window: '1month', rank: 5 },
			{ name: 'Cocteau Twins', window: '12month', rank: 14 },
		],
		source: 'similar',
		album: 'Whirlpool',
		tracks: ['Pearl', 'Falling Down'],
		...overrides,
	}
}

function result(overrides: Partial<RecommendationResult> = {}): RecommendationResult {
	return {
		username: 'rj',
		picks: [pick()],
		partial: false,
		genreNotFound: false,
		emptyHistory: false,
		libraryComplete: false,
		libraryPageSize: 1000,
		...overrides,
	}
}

describe('formatRecommendations', () => {
	describe('heading', () => {
		it('should name the user', () => {
			expect(formatRecommendations(result()).split('\n')[0]).toBe('🎯 **New music for rj**')
		})

		it('should add the genre when one was asked for', () => {
			expect(formatRecommendations(result({ genre: 'shoegaze' })).split('\n')[0]).toBe('🎯 **New music for rj** · shoegaze')
		})
	})

	describe('picks', () => {
		it('should number each pick in bold', () => {
			const text = formatRecommendations(result({ picks: [pick(), pick({ name: 'Ride' })] }))
			expect(text).toContain('**1. Chapterhouse**')
			expect(text).toContain('**2. Ride**')
		})

		it('should cite up to three seeds with their rank and window, in the order given', () => {
			const text = formatRecommendations(result())
			expect(text).toContain(
				'Similar to Slowdive (#2 this week), Mojave 3 (#5 this month) and Cocteau Twins (#14 this year). Not in your top 1000.',
			)
		})

		it('should cite only the first three seeds and label the overall window as all time', () => {
			const seeds = [
				{ name: 'Lush', window: 'overall' as const, rank: 40 },
				{ name: 'Slowdive', window: '7day' as const, rank: 2 },
				{ name: 'Ride', window: '1month' as const, rank: 3 },
				{ name: 'Cocteau Twins', window: '12month' as const, rank: 14 },
			]
			const text = formatRecommendations(result({ picks: [pick({ seeds })] }))
			expect(text).toContain('Similar to Lush (#40 all time), Slowdive (#2 this week) and Ride (#3 this month). Not in your top 1000.')
			expect(text).not.toContain('Cocteau Twins')
		})

		it('should join one or two seeds without a comma', () => {
			const one = formatRecommendations(result({ picks: [pick({ seeds: [{ name: 'Slowdive', window: '7day', rank: 2 }] })] }))
			expect(one).toContain('Similar to Slowdive (#2 this week). Not in your top 1000.')

			const two = formatRecommendations(
				result({
					picks: [
						pick({
							seeds: [
								{ name: 'Slowdive', window: '7day', rank: 2 },
								{ name: 'Ride', window: '1month', rank: 3 },
							],
						}),
					],
				}),
			)
			expect(two).toContain('Similar to Slowdive (#2 this week) and Ride (#3 this month). Not in your top 1000.')
		})

		it('should say "Not in your library" when the library is the whole history', () => {
			const text = formatRecommendations(result({ libraryComplete: true }))
			expect(text).toContain('and Cocteau Twins (#14 this year). Not in your library.')
			expect(text).not.toContain('Not in your top')
		})

		it('should explain a genre top-up by its rank in the tag', () => {
			const text = formatRecommendations(result({ genre: 'shoegaze', picks: [pick({ source: 'tag', seeds: [], tagRank: 7 })] }))
			expect(text).toContain("One of Last.fm's top artists tagged shoegaze (#7). Not in your top 1000.")

			const complete = formatRecommendations(
				result({ genre: 'shoegaze', libraryComplete: true, picks: [pick({ source: 'tag', seeds: [], tagRank: 7 })] }),
			)
			expect(complete).toContain("One of Last.fm's top artists tagged shoegaze (#7). Not in your library.")
		})

		it('should list the starter album and tracks', () => {
			expect(formatRecommendations(result())).toContain('Start with: *Whirlpool* · "Pearl" · "Falling Down"')
		})

		it('should leave out missing starter parts, and the line when there are none', () => {
			expect(formatRecommendations(result({ picks: [pick({ album: undefined })] }))).toContain('Start with: "Pearl" · "Falling Down"')
			expect(formatRecommendations(result({ picks: [pick({ tracks: ['Pearl'] })] }))).toContain('Start with: *Whirlpool* · "Pearl"\n')
			expect(formatRecommendations(result({ picks: [pick({ album: undefined, tracks: [] })] }))).not.toContain('Start with:')
		})

		it('should add a ListenToMore line for each pick', () => {
			expect(formatRecommendations(result())).toContain('https://listentomore.com/lookup?artist=Chapterhouse&ref=lastfm-mcp')
		})
	})

	describe('partial note', () => {
		it('should add the note when lookups were skipped', () => {
			expect(formatRecommendations(result({ partial: true }))).toContain(PARTIAL_NOTE)
		})

		it('should leave it out otherwise', () => {
			expect(formatRecommendations(result())).not.toContain('Some lookups were skipped')
		})
	})

	describe('empty states', () => {
		it('should explain an empty listening history', () => {
			const text = formatRecommendations(result({ picks: [], emptyHistory: true }))
			expect(text).toContain(
				"There isn't enough listening history on this Last.fm account yet to base recommendations on. Scrobble a few days of listening and try again.",
			)
			expect(text).not.toContain('**Next steps:**')
		})

		it('should explain an unknown genre', () => {
			const text = formatRecommendations(result({ genre: 'shoegayze', picks: [], genreNotFound: true }))
			expect(text).toContain('Last.fm has no artists tagged "shoegayze". Try a broader or differently spelled genre.')
			expect(text).not.toContain('**Next steps:**')
		})

		it('should suggest a genre or a shorter exclude list when everything was filtered out', () => {
			const text = formatRecommendations(result({ picks: [] }))
			expect(text).toContain('Everything that matched is already in your library or excluded. Try a genre, or a shorter exclude list.')
			expect(text).not.toContain('**Next steps:**')
		})

		it('should show the partial note instead when lookups were skipped and nothing came back', () => {
			const text = formatRecommendations(result({ picks: [], partial: true }))
			expect(text).toContain(PARTIAL_NOTE)
			expect(text).not.toContain('Everything that matched')
		})
	})

	describe('next steps', () => {
		it("should pass this call's picks as exclude and point at the top pick", () => {
			const text = formatRecommendations(result({ picks: [pick({ name: 'Slowdive' }), pick({ name: 'Mojave 3' })] }))
			expect(text).toContain('**Next steps:**')
			expect(text).toContain('- `get_music_recommendations(exclude=["Slowdive","Mojave 3"])` — different picks')
			expect(text).toContain('- `get_artist_info(artist="Slowdive")` — expand the top pick')
			expect(text).toContain('- `get_similar_artists(artist="Slowdive")` — fan out from a pick')
		})

		it('should keep the genre in the different-picks call', () => {
			const text = formatRecommendations(result({ genre: 'post rock', picks: [pick({ name: 'Mogwai' })] }))
			expect(text).toContain('- `get_music_recommendations(genre="post rock", exclude=["Mogwai"])` — different picks')
		})

		it("should add the earlier exclude list ahead of this call's picks", () => {
			const text = formatRecommendations(result({ picks: [pick({ name: 'C' }), pick({ name: 'D' })] }), { exclude: ['A', 'B'] })
			expect(text).toContain('- `get_music_recommendations(exclude=["A","B","C","D"])` — different picks')
		})

		it('should drop repeated names, keeping the latest spelling', () => {
			const text = formatRecommendations(result({ picks: [pick({ name: 'C' })] }), { exclude: ['A', 'b', ' a ', 'B'] })
			expect(text).toContain('- `get_music_recommendations(exclude=[" a ","B","C"])` — different picks')
		})

		it(`should cap the exclude list at ${MAX_EXCLUDE}, dropping the oldest names first`, () => {
			const earlier = Array.from({ length: 49 }, (_, i) => `Artist ${i + 1}`)
			const text = formatRecommendations(result({ picks: [pick({ name: 'C' }), pick({ name: 'D' })] }), { exclude: earlier })
			const args = text.match(/get_music_recommendations\(exclude=(\[.*?\])\)/)
			const exclude = JSON.parse(args![1]) as string[]
			expect(exclude).toHaveLength(MAX_EXCLUDE)
			expect(exclude[0]).toBe('Artist 2')
			expect(exclude.slice(-2)).toEqual(['C', 'D'])
		})

		it('should carry a username the request named, and only then', () => {
			const named = formatRecommendations(result({ username: 'friend', picks: [pick({ name: 'C' })] }), { username: 'friend', exclude: [] })
			expect(named).toContain('- `get_music_recommendations(username="friend", exclude=["C"])` — different picks')

			const own = formatRecommendations(result({ picks: [pick({ name: 'C' })] }), { exclude: [] })
			expect(own).toContain('- `get_music_recommendations(exclude=["C"])` — different picks')
		})

		it('should order username, genre, then exclude', () => {
			const text = formatRecommendations(result({ genre: 'shoegaze', picks: [pick({ name: 'C' })] }), {
				username: 'friend',
				exclude: ['A'],
			})
			expect(text).toContain('- `get_music_recommendations(username="friend", genre="shoegaze", exclude=["A","C"])` — different picks')
		})

		it('should come after the picks and the partial note', () => {
			const text = formatRecommendations(result({ partial: true }))
			expect(text.indexOf(PARTIAL_NOTE)).toBeGreaterThan(text.indexOf('**1. Chapterhouse**'))
			expect(text.indexOf('**Next steps:**')).toBeGreaterThan(text.indexOf(PARTIAL_NOTE))
		})
	})
})
