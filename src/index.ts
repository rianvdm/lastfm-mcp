/**
 * Discogs MCP Server - Cloudflare Worker
 * Implements Model Context Protocol for Discogs collection access
 */

export default {
	async fetch(request, _env, _ctx): Promise<Response> {
		// TODO: Implement JSON-RPC message handling
		// TODO: Add SSE endpoint for bidirectional communication
		// TODO: Add OAuth endpoints
		
		return new Response('MCP Server - Not yet implemented', { 
			status: 501,
			headers: {
				'Content-Type': 'text/plain',
			},
		})
	},
} satisfies ExportedHandler<Env>
