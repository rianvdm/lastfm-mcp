// ABOUTME: MCP tool annotations shared by every tool registration: all tools only read.
// ABOUTME: Clients use the hints to skip per-call confirmation; directories require them on every tool.
import type { ToolAnnotations } from '@modelcontextprotocol/server'

/** A tool that reads Last.fm data, which can reach any public artist, track, album, or username. */
export const LASTFM_READ: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: true,
}

/** A tool that answers from the server itself (connectivity, version, sign-in state) without calling Last.fm. */
export const LOCAL_READ: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: false,
}
