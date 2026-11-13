// ABOUTME: Builds the /llms.txt body: setup instructions for agents from llms.md plus a tool list generated from the tool catalogs.
// ABOUTME: Groups tools into music lookups, listening history and diagnostics, listing each once, so the list can't drift from the code.
import { AUTHENTICATED_TOOL_CATALOG, PUBLIC_TOOL_CATALOG, type ToolListEntry } from '../mcp/tools/catalog'
import llms from './llms.md'
import { fillPlaceholders } from './template'

// Every /mcp request needs an OAuth token, including for "public" tools, so the list says so once up front
const SIGN_IN_LINE = 'All tools need you to sign in to Last.fm first.'

// Public tools that check the server rather than look up music; listed last
const DIAGNOSTIC_TOOL_NAMES = new Set(['ping', 'server_info', 'lastfm_auth_status'])

// The catalog's auth-status summary is written for the output of that tool itself
const IN_TOOL_SUFFIX = / \(this tool\)$/

function renderGroup(heading: string, tools: ToolListEntry[]): string {
	return [`### ${heading}`, '', ...tools.map((tool) => `- \`${tool.name}\`: ${tool.summary}`)].join('\n')
}

/**
 * Renders the tool list for llms.txt. Tools in both catalogs are listed once, under Music lookups, with the
 * authenticated catalog's summary; tools only in the authenticated catalog go under Your listening history.
 */
export function renderLlmsToolSection(): string {
	const authenticatedSummaries = new Map(AUTHENTICATED_TOOL_CATALOG.map((tool) => [tool.name, tool.summary]))
	const publicNames = new Set(PUBLIC_TOOL_CATALOG.map((tool) => tool.name))

	const musicLookups = PUBLIC_TOOL_CATALOG.filter((tool) => !DIAGNOSTIC_TOOL_NAMES.has(tool.name)).map((tool) => ({
		name: tool.name,
		summary: authenticatedSummaries.get(tool.name) ?? tool.summary,
	}))
	const listeningHistory = AUTHENTICATED_TOOL_CATALOG.filter((tool) => !publicNames.has(tool.name))
	const diagnostics = PUBLIC_TOOL_CATALOG.filter((tool) => DIAGNOSTIC_TOOL_NAMES.has(tool.name)).map((tool) => ({
		name: tool.name,
		summary: tool.summary.replace(IN_TOOL_SUFFIX, ''),
	}))

	return [
		SIGN_IN_LINE,
		renderGroup('Music lookups', musicLookups),
		renderGroup('Your listening history', listeningHistory),
		renderGroup('Diagnostics', diagnostics),
	].join('\n\n')
}

/** Returns the llms.txt body with every server URL pointing at `origin`. */
export function buildLlmsTxt(origin: string): string {
	return fillPlaceholders(llms, { ORIGIN: origin, TOOLS: renderLlmsToolSection() })
}
