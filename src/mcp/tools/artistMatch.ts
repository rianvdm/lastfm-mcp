// ABOUTME: Artist-name matching helpers for tools that filter Last.fm history by artist.
// ABOUTME: Exact case-insensitive matching plus "did you mean" suggestions for near misses.

const MIN_CONTAINED_NAME_LENGTH = 3

/** Canonical form used to compare artist names: Unicode NFC, trimmed, lower-cased. */
export function normalizeArtistName(name: string): string {
	return name.normalize('NFC').trim().toLowerCase()
}

/** True when both names are the same artist after normalisation. */
export function isSameArtist(a: string, b: string): boolean {
	return normalizeArtistName(a) === normalizeArtistName(b)
}

/**
 * Distinct names (input order, first spelling kept) that are close to `query` without matching it exactly:
 * the name contains the query, or the query contains a name of 3+ characters.
 */
export function suggestArtistNames(names: string[], query: string, max = 5): string[] {
	const q = normalizeArtistName(query)
	if (!q) return []

	const seen = new Set<string>()
	const suggestions: string[] = []
	for (const name of names) {
		const n = normalizeArtistName(name)
		if (n === q || seen.has(n)) continue
		seen.add(n)
		if (n.includes(q) || (n.length >= MIN_CONTAINED_NAME_LENGTH && q.includes(n))) {
			suggestions.push(name)
			if (suggestions.length >= max) break
		}
	}
	return suggestions
}
