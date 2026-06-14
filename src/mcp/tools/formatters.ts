// ABOUTME: Shared formatting helpers for MCP tool responses.
// ABOUTME: Normalises Last.fm fields that the API returns in mixed shapes (e.g. artist as string or object).

/**
 * Last.fm returns the `artist` field on tracks/albums either as a plain string
 * or as an object `{ name, mbid?, url? }` depending on the endpoint and request
 * shape. Normalise to the displayable name.
 */
export function formatArtist(artist: string | { name: string } | undefined | null): string {
	if (!artist) return 'Unknown Artist'
	if (typeof artist === 'string') return artist
	return artist.name ?? 'Unknown Artist'
}

/**
 * Last.fm serialises list fields (tags, tracks, similar artists, …) in three
 * shapes depending on cardinality: an array for many, a bare object for exactly
 * one, and an omitted key (or empty string) for none. Callers want to `.slice()`
 * / `.map()` the result, so normalise every shape to an array.
 *
 * Passing a non-empty string returns `[]` — list items are always objects, so a
 * string only ever represents Last.fm's "empty collection" sentinel.
 */
export function toArray<T>(value: T | T[] | undefined | null): T[] {
	if (value == null || typeof value === 'string') return []
	return Array.isArray(value) ? value : [value]
}
