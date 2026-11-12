// ABOUTME: Creates and configures the McpServer instance using the official MCP SDK.
// ABOUTME: Registers tools, prompts, and resources, and manages per-request auth context.
import { McpServer } from '@modelcontextprotocol/server'

import type { ToolCallEvent } from '../analytics/toolEvents'
import { CachedLastfmClient } from '../clients/cachedLastfm'
import { LastfmClient } from '../clients/lastfm'
import type { Env } from '../types/env'

import { instrumentTools } from './instrumentation'
import { SERVER_VERSION } from './protocol'
import { registerPrompts } from './prompts/analysis'
import { registerResources } from './resources/lastfm'
import { registerAuthenticatedTools, registerPublicTools, type AuthSession } from './tools'

// Server metadata
const SERVER_NAME = 'lastfm-mcp'

/**
 * Request context that can be updated per-request.
 * Tools access this via getter functions captured in closures.
 */
export interface McpRequestContext {
	session: AuthSession | null
}

/**
 * Result of createMcpServer - includes server and context setter.
 */
export interface McpServerWithContext {
	server: McpServer
	setContext: (ctx: Partial<McpRequestContext>) => void
}

export interface CreateMcpServerOptions {
	/** Called once per tool call with its anonymous ToolCallEvent. Exceptions are logged and never reach the caller. */
	onToolCall?: (event: ToolCallEvent) => void
}

/**
 * Creates a configured MCP server instance with access to environment bindings.
 *
 * Uses a factory function pattern to provide env access to all tools via closure.
 * Returns both the server and a context setter for per-request session management.
 *
 * @param env - Cloudflare Worker environment bindings
 * @param options - `onToolCall` turns on tool-call instrumentation for this server
 */
export function createMcpServer(env: Env, options: CreateMcpServerOptions = {}): McpServerWithContext {
	const server = new McpServer(
		{
			name: SERVER_NAME,
			version: SERVER_VERSION,
		},
		{
			instructions: [
				'Recommended path:',
				'- Artist questions: `get_artist_info` → `get_artist_top_tracks` / `get_artist_top_albums` / `get_similar_artists`.',
				'- Album / track lookups: `get_album_info` / `get_track_info` → `get_similar_tracks` for "more like this".',
				"- The user's listening history (auth required): `get_recent_tracks` for the live feed; `get_top_artists` / `get_top_albums` / `get_top_tracks` for period summaries; `get_loved_tracks` for favorites; `get_listening_stats` for shape.",
				'- Personalized picks (auth required): `get_music_recommendations`.',
				'- Historical week-by-week: `get_weekly_chart_list` first to discover periods → `get_weekly_artist_chart` / `get_weekly_track_chart` with a specific `from`/`to`.',
				'- Profile and diagnostics: `get_user_info`, `lastfm_auth_status`, `server_info`, `ping`.',
				'',
				'Most tool responses end with a "Next steps" block listing the most likely follow-up calls and the exact argument shape — copy those verbatim when chaining.',
			].join('\n'),
		},
	)

	// Instrumentation must run before any tool is registered: registering the first tool installs the tools/call handler it wraps.
	if (options.onToolCall) instrumentTools(server, options.onToolCall)

	// Create Last.fm client with caching
	const lastfmClient = new LastfmClient(env.LASTFM_API_KEY)
	const cachedClient = new CachedLastfmClient(lastfmClient, env.MCP_SESSIONS)

	// Mutable request context - updated per-request before handling
	const context: McpRequestContext = {
		session: null,
	}

	// Getters that tools use to access current context
	const getSession = () => context.session

	// Register public tools (no auth required)
	registerPublicTools(server, cachedClient)

	// Register authenticated tools (they explain how to sign in when there is no session)
	registerAuthenticatedTools(server, cachedClient, getSession)

	// Register resources
	registerResources(server, cachedClient, getSession)

	// Register prompts
	registerPrompts(server)

	return {
		server,
		setContext: (ctx: Partial<McpRequestContext>) => {
			if (ctx.session !== undefined) context.session = ctx.session
		},
	}
}
