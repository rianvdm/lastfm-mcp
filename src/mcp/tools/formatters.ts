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
