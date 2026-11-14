// ABOUTME: Normalises Last.fm list fields, which come back as an array, a bare object or nothing, to an array.
// ABOUTME: Neutral helper shared by the MCP tools (through formatters.ts) and the recommendation engine.

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
