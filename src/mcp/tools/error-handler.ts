// ABOUTME: Error handling utility for MCP tool callbacks.
// ABOUTME: Wraps tool errors into user-friendly MCP content responses instead of raw exceptions.

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
				text: `Error in ${toolName}: ${message}\n\nPlease try again. If the issue persists, the Last.fm API may be temporarily unavailable.`,
			},
		],
	}
}
