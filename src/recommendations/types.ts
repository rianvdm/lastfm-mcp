// ABOUTME: Types shared by the music recommendation engine: listening windows, seeds, ranked candidates and the cached list.
// ABOUTME: Pure data shapes only; scoring.ts produces them and the engine, cache and formatter consume them.

/** A Last.fm top-artists period used as a source of seeds and of the user's library. */
export type Window = '7day' | '1month' | '12month' | 'overall'

/** A user's top artist used to fan out to similar artists. */
export interface SeedRef {
	/** Display name as it appears in the user's top artists. */
	name: string
	/** The most recent window the artist appears in. */
	window: Window
	/** 1-based position in that window's top artists. */
	rank: number
}

/** An artist to recommend, with the evidence behind it. */
export interface Candidate {
	/** Display name as Last.fm returned it the first time it was seen. */
	name: string
	/** Sum over pointing seeds of window weight × similarity match; 0 for tag top-ups. */
	score: number
	/** Seeds that point to this artist, strongest contribution first; empty for tag top-ups. */
	seeds: SeedRef[]
	/** 'similar' when found through similar artists, 'tag' when added from the genre's top artists. */
	source: 'similar' | 'tag'
	/** 1-based position in the genre's top artists, set when `source` is 'tag'. */
	tagRank?: number
}

/** The ranked candidates for one user and genre, as built and cached before `exclude` and `limit` apply. */
export interface CandidateList {
	candidates: Candidate[]
	/** True when the user's overall top artists came back shorter than the page size, so the library is their whole history. */
	libraryComplete: boolean
	/** Page size used for the overall top artists, quoted in "Not in your top N". */
	libraryPageSize: number
	/** True when the budget, deadline or rate limiting cut the fan-out short. */
	partial: boolean
	/** True when `genre` was set but Last.fm has no artists for that tag. */
	genreNotFound: boolean
	/** True when the user has no top artists in any window. */
	emptyHistory: boolean
}
