// ABOUTME: Maps an OAuth client ID (a CIMD URL or a registered ID) and its registered name to a label from a fixed list.
// ABOUTME: Shared by the MCP Worker and the dashboard Worker, so it uses only standard JavaScript and imports nothing from src/.

/** Labels for the CIMD client metadata URLs of clients we recognise, matched exactly. Any other URL is labelled "other". */
export const KNOWN_CLIENT_LABELS: ReadonlyMap<string, string> = new Map([
	['https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude'],
	['https://claude.ai/oauth/claude-code-client-metadata', 'Claude Code'],
	['https://chatgpt.com/oauth/client.json', 'ChatGPT'],
	['https://chatgpt.com/oauth/codex/client.json', 'Codex'],
	['https://opencode.ai/oauth/opencode/client.json', 'OpenCode'],
	['https://nousresearch.github.io/hermes-agent/docs/oauth/client-metadata.json', 'Hermes Agent'],
	['https://sesameai.app/api/oauth/external-mcp/client.json', 'Sesame'],
])

/** Labels for registered (DCR) client names, keyed by the normalised name (see normaliseName). */
const KNOWN_CLIENT_NAMES: ReadonlyMap<string, string> = new Map([
	['claude', 'Claude'],
	['chatgpt', 'ChatGPT'],
	['codex', 'Codex'],
	['cursor', 'Cursor'],
	['google', 'Google'],
	['hermes agent', 'Hermes Agent'],
	['open webui', 'Open WebUI'],
	['grok', 'Grok'],
	['perplexity', 'Perplexity'],
	['lm studio', 'LM Studio'],
	['mcp cli proxy', 'MCP CLI Proxy'],
	['opencode', 'OpenCode'],
	['goose', 'Goose'],
	['windsurf', 'Windsurf'],
	['vscode', 'VS Code'],
	['visual studio code', 'VS Code'],
	['zed', 'Zed'],
])

/** Claude Code registers with names like "Claude Code (hostname)", so any name with this prefix is Claude Code. */
const CLAUDE_CODE_PREFIX = 'claude code'
const CLAUDE_CODE_LABEL = 'Claude Code'

const OTHER_LABEL = 'other'
const UNKNOWN_LABEL = 'unknown'

/** Every label labelForClient can return. Nothing outside this set is ever recorded or shown. */
export const CLIENT_LABELS: ReadonlySet<string> = new Set([
	...KNOWN_CLIENT_LABELS.values(),
	...KNOWN_CLIENT_NAMES.values(),
	CLAUDE_CODE_LABEL,
	OTHER_LABEL,
	UNKNOWN_LABEL,
])

/**
 * Returns the label to record and display for an OAuth client, always one of CLIENT_LABELS.
 *
 * Client IDs and registered names are chosen by whoever registers the client, so either can contain a username. Neither is
 * ever returned as is: a CIMD (URL) client ID must match a known URL exactly, and a registered client's name must match a
 * known app name after trimming, collapsing whitespace and lowercasing. Anything else is "other"; no ID, or a registered ID
 * without a name, is "unknown".
 */
export function labelForClient(clientId: string | undefined, clientName?: string): string {
	if (!clientId) return UNKNOWN_LABEL
	if (isCimdClientId(clientId)) return KNOWN_CLIENT_LABELS.get(clientId) ?? OTHER_LABEL

	const name = clientName === undefined ? '' : normaliseName(clientName)
	if (!name) return UNKNOWN_LABEL
	if (name.startsWith(CLAUDE_CODE_PREFIX)) return CLAUDE_CODE_LABEL
	return KNOWN_CLIENT_NAMES.get(name) ?? OTHER_LABEL
}

/** Whether a client ID is a CIMD metadata URL, whose label needs no registered name. */
export function isCimdClientId(clientId: string): boolean {
	try {
		const { protocol } = new URL(clientId)
		return protocol === 'https:' || protocol === 'http:'
	} catch {
		return false
	}
}

/** Trims, collapses runs of whitespace and control characters to one space, and lowercases. */
function normaliseName(name: string): string {
	return name
		.replace(/[\s\p{Cc}]+/gu, ' ')
		.trim()
		.toLowerCase()
}
