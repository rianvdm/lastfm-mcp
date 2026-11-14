// ABOUTME: Pure scoring for music recommendations: picks seeds from top-artist windows and ranks similar artists by weighted evidence.
// ABOUTME: Also applies the genre filter with tag top-up and the per-call exclude list; no network or cache access.

import type { Candidate, SeedRef, Window } from './types'

/** How much a seed from each window counts; recent listening weighs more. */
export const WINDOW_WEIGHTS: Record<Window, number> = { '7day': 3, '1month': 2, '12month': 1, overall: 0.5 }

/** Most seeds to fan out to similar artists in one build. */
export const MAX_FANOUT_SEEDS = 12

/** Overall top artists considered as seeds; the rest of the overall list only feeds the library. */
const MAX_OVERALL_SEEDS = 10

/** Windows from the best weight to the worst, which is also most recent to least. */
const WINDOWS_BY_WEIGHT: Window[] = (Object.keys(WINDOW_WEIGHTS) as Window[]).sort((a, b) => WINDOW_WEIGHTS[b] - WINDOW_WEIGHTS[a])

/** Matching key for an artist name: trimmed and lowercased. */
export function normaliseArtist(name: string): string {
	return name.trim().toLowerCase()
}

function normaliseAll(names: Iterable<string>): Set<string> {
	const normalised = new Set<string>()
	for (const name of names) normalised.add(normaliseArtist(name))
	return normalised
}

/**
 * Picks the seeds to fan out from. `windows` lists each window's artist names in rank order (index 0 is rank 1).
 * An artist in several windows keeps its most recent window and that window's rank. Seeds are ordered by window
 * weight, then rank, and capped at MAX_FANOUT_SEEDS; only the overall window's top 10 can become seeds.
 */
export function selectSeeds(windows: Partial<Record<Window, string[]>>): SeedRef[] {
	const seen = new Set<string>()
	const seeds: SeedRef[] = []

	for (const window of WINDOWS_BY_WEIGHT) {
		const names = windows[window] ?? []
		const eligible = window === 'overall' ? names.slice(0, MAX_OVERALL_SEEDS) : names
		eligible.forEach((name, index) => {
			const key = normaliseArtist(name)
			if (!key || seen.has(key)) return
			seen.add(key)
			seeds.push({ name, window, rank: index + 1 })
		})
	}

	seeds.sort((a, b) => WINDOW_WEIGHTS[b.window] - WINDOW_WEIGHTS[a.window] || a.rank - b.rank)
	return seeds.slice(0, MAX_FANOUT_SEEDS)
}

interface Evidence {
	seed: SeedRef
	contribution: number
}

/**
 * Ranks the artists that the seeds' similar-artist lists point to. `similar` is keyed by normalised seed name.
 * A candidate scores the sum of window weight × match over the seeds pointing to it; seeds and library artists
 * are dropped. Order: score desc, then number of seeds desc, then name asc.
 */
export function rankCandidates(
	seeds: SeedRef[],
	similar: Map<string, Array<{ name: string; match: number }>>,
	library: Set<string>,
): Candidate[] {
	const excluded = normaliseAll(library)
	for (const seed of seeds) excluded.add(normaliseArtist(seed.name))

	const byKey = new Map<string, { name: string; evidence: Evidence[] }>()
	const processedSeeds = new Set<string>()

	for (const seed of seeds) {
		const seedKey = normaliseArtist(seed.name)
		if (processedSeeds.has(seedKey)) continue
		processedSeeds.add(seedKey)

		// One contribution per seed and candidate, even if Last.fm lists a name variant twice.
		const bestMatch = new Map<string, { name: string; match: number }>()
		for (const entry of similar.get(seedKey) ?? []) {
			const key = normaliseArtist(entry.name)
			if (!key || excluded.has(key) || !Number.isFinite(entry.match)) continue
			const current = bestMatch.get(key)
			if (!current || entry.match > current.match) bestMatch.set(key, { name: current?.name ?? entry.name, match: entry.match })
		}

		for (const [key, { name, match }] of bestMatch) {
			const contribution = WINDOW_WEIGHTS[seed.window] * match
			const existing = byKey.get(key)
			if (existing) existing.evidence.push({ seed, contribution })
			else byKey.set(key, { name, evidence: [{ seed, contribution }] })
		}
	}

	const candidates = [...byKey.values()].map(({ name, evidence }): Candidate => {
		const ordered = [...evidence].sort((a, b) => b.contribution - a.contribution)
		return {
			name,
			score: ordered.reduce((sum, e) => sum + e.contribution, 0),
			seeds: ordered.map((e) => e.seed),
			source: 'similar',
		}
	})

	return candidates.sort((a, b) => b.score - a.score || b.seeds.length - a.seeds.length || compareNames(a.name, b.name))
}

/** Locale-independent name order, so ranking is the same in every runtime. */
function compareNames(a: string, b: string): number {
	const keyA = normaliseArtist(a)
	const keyB = normaliseArtist(b)
	if (keyA !== keyB) return keyA < keyB ? -1 : 1
	return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Keeps the candidates that appear in the genre's top artists (`tagArtists`, in tag rank order), in their existing
 * order. If fewer than `limit` remain, appends the tag's highest-ranked artists that are neither in the library nor
 * already present, as `source: 'tag'` with their 1-based tag rank. Never removes candidates to meet `limit`.
 */
export function applyGenre(candidates: Candidate[], tagArtists: string[], library: Set<string>, limit: number): Candidate[] {
	const inTag = normaliseAll(tagArtists)
	const kept = candidates.filter((candidate) => inTag.has(normaliseArtist(candidate.name)))

	const present = normaliseAll(kept.map((candidate) => candidate.name))
	const inLibrary = normaliseAll(library)

	for (let index = 0; index < tagArtists.length && kept.length < limit; index++) {
		const name = tagArtists[index]
		const key = normaliseArtist(name)
		if (!key || present.has(key) || inLibrary.has(key)) continue
		present.add(key)
		kept.push({ name, score: 0, seeds: [], source: 'tag', tagRank: index + 1 })
	}

	return kept
}

/** Drops candidates named in `exclude` (trimmed, case-insensitive), then keeps the first `limit`. */
export function applyExclude(candidates: Candidate[], exclude: string[], limit: number): Candidate[] {
	const excluded = normaliseAll(exclude)
	return candidates.filter((candidate) => !excluded.has(normaliseArtist(candidate.name))).slice(0, limit)
}
