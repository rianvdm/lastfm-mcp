/**
 * Simple command router for MCP commands
 */

export async function route(command: string): Promise<string> {
	// Trim whitespace and convert to lowercase for consistent matching
	const normalizedCommand = command.trim().toLowerCase()

	switch (normalizedCommand) {
		case 'ping':
			return 'pong'
		default:
			return 'Unknown command'
	}
}
