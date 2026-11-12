// ABOUTME: Turns an OAuth client ID (a CIMD URL or a registered ID) and its registered name into a short display label.
// ABOUTME: Shared by the MCP Worker and the dashboard Worker, so it uses only standard JavaScript and imports nothing from src/.

/** Labels for the CIMD client metadata URLs of clients we recognise. Any other CIMD URL is labelled by its hostname. */
export const KNOWN_CLIENT_LABELS: ReadonlyMap<string, string> = new Map([
	['https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude'],
	['https://claude.ai/oauth/claude-code-client-metadata', 'Claude Code'],
	['https://chatgpt.com/oauth/client.json', 'ChatGPT'],
	['https://chatgpt.com/oauth/codex/client.json', 'Codex'],
	['https://opencode.ai/oauth/opencode/client.json', 'OpenCode'],
])

const UNKNOWN_LABEL = 'unknown'

/** Registered names are attacker-controlled (registration is open), so labels built from them are capped at this many characters. */
const MAX_NAME_LENGTH = 40

/**
 * Returns the label to record and display for an OAuth client.
 *
 * A CIMD client ID is a URL whose metadata the provider fetched, so its host is trustworthy and wins over any name.
 * A registered (DCR) client ID is random, so the label comes from the client's self-chosen name, trimmed, with whitespace
 * and control characters collapsed to single spaces and capped at 40 characters. The label still needs escaping wherever
 * it's rendered.
 */
export function labelForClient(clientId: string | undefined, clientName?: string): string {
	if (!clientId) return UNKNOWN_LABEL

	const cimdUrl = parseHttpUrl(clientId)
	if (cimdUrl) return KNOWN_CLIENT_LABELS.get(clientId) ?? cimdUrl.hostname

	if (!clientName) return UNKNOWN_LABEL
	const collapsed = clientName.replace(/[\s\p{Cc}]+/gu, ' ').trim()
	// Array.from splits by code point, so the cap never leaves half of a surrogate pair
	const capped = Array.from(collapsed).slice(0, MAX_NAME_LENGTH).join('').trimEnd()
	return capped || UNKNOWN_LABEL
}

/** Whether a client ID is a CIMD metadata URL, whose label needs no registered name. */
export function isCimdClientId(clientId: string): boolean {
	return parseHttpUrl(clientId) !== null
}

function parseHttpUrl(value: string): URL | null {
	try {
		const url = new URL(value)
		return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
	} catch {
		return null
	}
}
