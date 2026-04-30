// ABOUTME: Single source of truth for the human-readable tool list shown in auth-status messages.
// ABOUTME: Auth-prompt messages render this catalog instead of hardcoding the list, so adding a tool only requires one edit.

export interface ToolListEntry {
	name: string
	summary: string
}

/**
 * Tools available without authentication.
 * Add new public tools here so they show up in the unauthenticated auth-status / requiresAuth messages.
 */
export const PUBLIC_TOOL_CATALOG: ToolListEntry[] = [
	{ name: 'ping', summary: 'Test server connectivity' },
	{ name: 'server_info', summary: 'Get server information' },
	{ name: 'lastfm_auth_status', summary: 'Check authentication status (this tool)' },
	{ name: 'get_track_info', summary: 'Get basic track information' },
	{ name: 'get_artist_info', summary: 'Get basic artist information' },
	{ name: 'get_album_info', summary: 'Get basic album information' },
	{ name: 'get_similar_artists', summary: 'Find similar artists' },
	{ name: 'get_similar_tracks', summary: 'Find similar tracks' },
]

/**
 * Tools that require authentication.
 * Add new authenticated tools here so they show up in the authenticated auth-status message.
 */
export const AUTHENTICATED_TOOL_CATALOG: ToolListEntry[] = [
	{ name: 'get_recent_tracks', summary: 'Get your recent listening history' },
	{ name: 'get_top_artists', summary: 'Get your top artists by time period' },
	{ name: 'get_top_albums', summary: 'Get your top albums by time period' },
	{ name: 'get_loved_tracks', summary: 'Get your loved/favorite tracks' },
	{ name: 'get_track_info', summary: 'Get detailed track information' },
	{ name: 'get_artist_info', summary: 'Get detailed artist information' },
	{ name: 'get_album_info', summary: 'Get detailed album information' },
	{ name: 'get_user_info', summary: 'Get your profile information' },
	{ name: 'get_similar_artists', summary: 'Find similar artists' },
	{ name: 'get_similar_tracks', summary: 'Find similar tracks' },
	{ name: 'get_listening_stats', summary: 'Get listening statistics' },
	{ name: 'get_music_recommendations', summary: 'Get personalized recommendations' },
	{ name: 'get_weekly_chart_list', summary: 'Get available historical time periods' },
	{ name: 'get_weekly_artist_chart', summary: 'Get artist listening data for specific periods' },
	{ name: 'get_weekly_track_chart', summary: 'Get track listening data for specific periods' },
]

/**
 * Render a catalog as a markdown bullet list of `\`name\` - summary` lines.
 */
export function renderToolList(catalog: ToolListEntry[]): string {
	return catalog.map((t) => `• \`${t.name}\` - ${t.summary}`).join('\n')
}
