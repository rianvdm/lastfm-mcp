// ABOUTME: Formats a recommendation result as the get_music_recommendations tool text.
// ABOUTME: Writes each pick's reason from the user's own data, its starters and link, the partial note, empty states and Next steps.

import { buildNextSteps } from '../utils/breadcrumb'
import { buildListenToMoreLine } from '../utils/listentomore-link'
import type { Pick, RecommendationResult } from './engine'
import type { SeedRef, Window } from './types'

/** Seeds cited in one reason line; the rest still count toward the ranking. */
const MAX_CITED_SEEDS = 3

const WINDOW_LABELS: Record<Window, string> = {
	'7day': 'this week',
	'1month': 'this month',
	'12month': 'this year',
	overall: 'all time',
}

const PARTIAL_NOTE =
	'_Some lookups were skipped to keep this fast, so this list may be shorter or missing starter tracks. Ask again in a minute for the full set._'

const EMPTY_HISTORY =
	"There isn't enough listening history on this Last.fm account yet to base recommendations on. Scrobble a few days of listening and try again."

const ALL_FILTERED = 'Everything that matched is already in your library or excluded. Try a genre, or a shorter exclude list.'

/** Turns a recommendation result into the tool's text: a heading, then the picks or the reason there are none. */
export function formatRecommendations(result: RecommendationResult): string {
	const heading = `🎯 **New music for ${result.username}**${result.genre ? ` · ${result.genre}` : ''}`

	if (result.emptyHistory) return `${heading}\n\n${EMPTY_HISTORY}`
	if (result.genreNotFound) {
		return `${heading}\n\nLast.fm has no artists tagged "${result.genre}". Try a broader or differently spelled genre.`
	}
	// With nothing back from a cut-short call, "ask again" is the useful advice, not "already in your library"
	if (result.picks.length === 0) return `${heading}\n\n${result.partial ? PARTIAL_NOTE : ALL_FILTERED}`

	const libraryNote = result.libraryComplete ? 'Not in your library.' : `Not in your top ${result.libraryPageSize}.`
	const sections = [heading, ...result.picks.map((pick, index) => formatPick(pick, index + 1, result.genre, libraryNote))]
	if (result.partial) sections.push(PARTIAL_NOTE)

	return sections.join('\n\n') + nextSteps(result)
}

function formatPick(pick: Pick, number: number, genre: string | undefined, libraryNote: string): string {
	const lines = [`**${number}. ${pick.name}**`, `${reason(pick, genre)} ${libraryNote}`]
	const starters = [...(pick.album ? [`*${pick.album}*`] : []), ...pick.tracks.map((track) => `"${track}"`)]
	if (starters.length > 0) lines.push(`Start with: ${starters.join(' · ')}`)
	const link = buildListenToMoreLine({ type: 'artist', artist: pick.name })
	if (link) lines.push(link)
	return lines.join('\n')
}

/** Why this artist was picked: the user's seeds that point to it, or its place in the genre's top artists. */
function reason(pick: Pick, genre: string | undefined): string {
	if (pick.source === 'tag') {
		const rank = pick.tagRank !== undefined ? ` (#${pick.tagRank})` : ''
		return `One of Last.fm's top artists tagged ${genre}${rank}.`
	}
	return `Similar to ${joinNames(pick.seeds.slice(0, MAX_CITED_SEEDS).map(citeSeed))}.`
}

function citeSeed(seed: SeedRef): string {
	return `${seed.name} (#${seed.rank} ${WINDOW_LABELS[seed.window]})`
}

/** "A", "A and B", "A, B and C". */
function joinNames(names: string[]): string {
	if (names.length <= 1) return names.join('')
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function nextSteps(result: RecommendationResult): string {
	const names = result.picks.map((pick) => pick.name)
	const top = JSON.stringify(names[0])
	// Keep the genre so the follow-up stays in it; only this call's picks are known here
	const genreArg = result.genre ? `genre=${JSON.stringify(result.genre)}, ` : ''

	return buildNextSteps([
		{ tool: 'get_music_recommendations', args: `${genreArg}exclude=${JSON.stringify(names)}`, hint: 'different picks' },
		{ tool: 'get_artist_info', args: `artist=${top}`, hint: 'expand the top pick' },
		{ tool: 'get_similar_artists', args: `artist=${top}`, hint: 'fan out from a pick' },
	])
}
