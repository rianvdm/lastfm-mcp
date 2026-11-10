// ABOUTME: Builds the one-line ListenToMore link shown in album and artist results.
// ABOUTME: Links through listentomore.com/lookup, which resolves names to a page, tagged ref=lastfm-mcp for click counts.

const LOOKUP_URL = 'https://listentomore.com/lookup'
// The lookup route answers 400 for longer names, so a link would be dead.
const MAX_NAME_LENGTH = 300

export type ListenToMoreEntity = { type: 'album'; artist: string; album: string } | { type: 'artist'; artist: string }

/**
 * A plain line for the end of an album or artist result. It is not a Next steps
 * breadcrumb, because the server instructions tell the model to copy those as tool calls.
 * Returns an empty string when a name is too long for the lookup route.
 */
export function buildListenToMoreLine(entity: ListenToMoreEntity): string {
	const names = entity.type === 'album' ? [entity.artist, entity.album] : [entity.artist]
	if (names.some((name) => name.length > MAX_NAME_LENGTH)) return ''
	const params = new URLSearchParams({ artist: entity.artist })
	if (entity.type === 'album') params.set('album', entity.album)
	params.set('ref', 'lastfm-mcp')
	return `**ListenToMore:** streaming links and an AI summary for this ${entity.type} → ${LOOKUP_URL}?${params.toString()}`
}
