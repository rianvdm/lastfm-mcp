// ABOUTME: Formats a recommendation result as the get_music_recommendations tool text.
// ABOUTME: Writes each pick's reason from the user's own data, its starters and link, the partial note, empty states and Next steps.

import { buildNextSteps } from '../utils/breadcrumb'
import { buildListenToMoreLine } from '../utils/listentomore-link'
import { MAX_EXCLUDE, type Pick, type RecommendationResult } from './engine'
import { normaliseArtist } from './scoring'
import type { SeedRef, Window } from './types'

/** What the caller asked for that the result doesn't carry, needed to write a follow-up call that continues this one. */
export interface RecommendationRequest {
	/** The username the request named; absent when it fell back to the signed-in user. */
	username?: string
	/** The names this call excluded, in the order given. */
	exclude: string[]
}

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

const LIBRARY_UNCHECKED = "Couldn't check your full library, so you may already know this one."

const ALL_FILTERED = 'Everything that matched is already in your library or excluded. Try a genre, or a shorter exclude list.'

/**
 * Turns a recommendation result into the tool's text: a heading, then the picks or the reason there are none.
 * `request` shapes the "different picks" Next step so it keeps the same user and excludes every earlier pick.
 */
export function formatRecommendations(result: RecommendationResult, request: RecommendationRequest = { exclude: [] }): string {
	const heading = `🎯 **New music for ${result.username}**${result.genre ? ` · ${result.genre}` : ''}`

	if (result.emptyHistory) return `${heading}\n\n${EMPTY_HISTORY}`
	if (result.genreNotFound) {
		return `${heading}\n\nLast.fm has no artists tagged "${result.genre}". Try a broader or differently spelled genre.`
	}
	// With nothing back from a cut-short call, "ask again" is the useful advice, not "already in your library"
	if (result.picks.length === 0) return `${heading}\n\n${result.partial ? PARTIAL_NOTE : ALL_FILTERED}`

	const libraryNote = libraryNoteFor(result)
	const sections = [heading, ...result.picks.map((pick, index) => formatPick(pick, index + 1, result.genre, libraryNote))]
	if (result.partial) sections.push(PARTIAL_NOTE)

	return sections.join('\n\n') + nextSteps(result, request)
}

/** The reason line's last sentence: how far the library check reached, or that it couldn't run. */
function libraryNoteFor(result: RecommendationResult): string {
	if (!result.libraryChecked) return LIBRARY_UNCHECKED
	return result.libraryComplete ? 'Not in your library.' : `Not in your top ${result.libraryPageSize}.`
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

function nextSteps(result: RecommendationResult, request: RecommendationRequest): string {
	const top = JSON.stringify(result.picks[0].name)
	const exclude = nextExclude(request.exclude, result.picks)
	// Name the user only if the request did, and keep the genre, so the follow-up continues this call
	const args = [
		...(request.username ? [`username=${JSON.stringify(request.username)}`] : []),
		...(result.genre ? [`genre=${JSON.stringify(result.genre)}`] : []),
		`exclude=${JSON.stringify(exclude)}`,
	].join(', ')

	return buildNextSteps([
		{ tool: 'get_music_recommendations', args, hint: 'different picks' },
		{ tool: 'get_artist_info', args: `artist=${top}`, hint: 'expand the top pick' },
		{ tool: 'get_similar_artists', args: `artist=${top}`, hint: 'fan out from a pick' },
	])
}

/**
 * The exclude list for the next round: the earlier names, then this call's picks, one entry per normalised name
 * (its latest spelling, in its latest position), keeping the newest MAX_EXCLUDE so the list always fits the schema.
 */
function nextExclude(earlier: string[], picks: Pick[]): string[] {
	const seen = new Set<string>()
	const newestFirst: string[] = []
	for (const name of [...earlier, ...picks.map((pick) => pick.name)].reverse()) {
		const key = normaliseArtist(name)
		if (seen.has(key)) continue
		seen.add(key)
		newestFirst.push(name)
	}
	return newestFirst.slice(0, MAX_EXCLUDE).reverse()
}
