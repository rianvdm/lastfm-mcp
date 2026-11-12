// ABOUTME: Error handling utility for MCP tool callbacks.
// ABOUTME: Wraps tool errors into user-friendly MCP content responses instead of raw exceptions.

/** The opening of every toolError text; isToolErrorText matches on it. */
function errorPrefix(toolName: string): string {
	return `Error in ${toolName}: `
}

/**
 * Format an error into a user-friendly MCP tool response.
 * Returns a content array suitable for use as a tool result.
 */
export function toolError(toolName: string, error: unknown): { content: Array<{ type: 'text'; text: string }> } {
	const message = error instanceof Error ? error.message : 'An unexpected error occurred'
	console.error(`[TOOL ERROR] ${toolName}:`, error)

	return {
		content: [
			{
				type: 'text' as const,
				text: `${errorPrefix(toolName)}${message}\n\nPlease try again. If the issue persists, the Last.fm API may be temporarily unavailable.`,
			},
		],
	}
}

/** True when `text` is the message toolError builds for `toolName`. */
export function isToolErrorText(toolName: string, text: string): boolean {
	return text.startsWith(errorPrefix(toolName))
}
