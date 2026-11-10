// ABOUTME: Builds the one-line ListenToMore link shown in album and artist results.
// ABOUTME: Links through listentomore.com/lookup, which resolves names to a page, tagged ref=lastfm-mcp for click counts.

const LOOKUP_URL = 'https://listentomore.com/lookup'

export type ListenToMoreEntity = { type: 'album'; artist: string; album: string } | { type: 'artist'; artist: string }

/**
 * A plain line for the end of an album or artist result. It is not a Next steps
 * breadcrumb, because the server instructions tell the model to copy those as tool calls.
 */
export function buildListenToMoreLine(entity: ListenToMoreEntity): string {
	const params = new URLSearchParams({ artist: entity.artist })
	if (entity.type === 'album') params.set('album', entity.album)
	params.set('ref', 'lastfm-mcp')
	return `**ListenToMore:** streaming links and an AI summary for this ${entity.type} → ${LOOKUP_URL}?${params.toString()}`
}
