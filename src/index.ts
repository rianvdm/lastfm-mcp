/**
 * Discogs MCP Server - Cloudflare Worker
 * Implements Model Context Protocol for Discogs collection access
 */

import { parseMessage, createError, serializeResponse } from './protocol/parser'
import { handleMethod } from './protocol/handlers'
import { ErrorCode } from './types/jsonrpc'
import { createSSEResponse, getConnection } from './transport/sse'

export default {
	async fetch(request, _env, _ctx): Promise<Response> {
		const url = new URL(request.url)

		// Handle different endpoints
		switch (url.pathname) {
			case '/':
				// Main MCP endpoint - accepts JSON-RPC messages
				if (request.method !== 'POST') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleMCPRequest(request)

			case '/sse':
				// SSE endpoint for bidirectional communication
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 })
				}
				return handleSSEConnection()

			case '/login':
				// TODO: Implement OAuth login in C2
				return new Response('OAuth not implemented yet', { status: 501 })

			case '/callback':
				// TODO: Implement OAuth callback in C2
				return new Response('OAuth not implemented yet', { status: 501 })

			default:
				return new Response('Not found', { status: 404 })
		}
	},
} satisfies ExportedHandler<Env>

/**
 * Handle SSE connection request
 */
function handleSSEConnection(): Response {
	const { response, connectionId } = createSSEResponse()
	console.log(`New SSE connection established: ${connectionId}`)
	return response
}

/**
 * Handle MCP JSON-RPC request
 */
async function handleMCPRequest(request: Request): Promise<Response> {
	try {
		// Check for connection ID header (for SSE-connected clients)
		const connectionId = request.headers.get('X-Connection-ID')
		if (connectionId) {
			const connection = getConnection(connectionId)
			if (!connection) {
				console.warn(`Invalid connection ID: ${connectionId}`)
			}
		}

		// Parse request body
		const body = await request.text()

		// Handle empty body
		if (!body) {
			const errorResponse = createError(null, ErrorCode.InvalidRequest, 'Empty request body')
			return new Response(serializeResponse(errorResponse), {
				headers: { 'Content-Type': 'application/json' },
			})
		}

		// Parse JSON-RPC message
		let jsonrpcRequest
		try {
			jsonrpcRequest = parseMessage(body)
		} catch (error) {
			// Parse error or invalid request
			const errorResponse = createError(null, (error as any).code || ErrorCode.ParseError, (error as any).message || 'Parse error')
			return new Response(serializeResponse(errorResponse), {
				headers: { 'Content-Type': 'application/json' },
			})
		}

		// Handle the method
		const response = await handleMethod(jsonrpcRequest)

		// If no response (notification), return 204 No Content
		if (!response) {
			return new Response(null, { status: 204 })
		}

		// Return JSON-RPC response
		return new Response(serializeResponse(response), {
			headers: { 'Content-Type': 'application/json' },
		})
	} catch (error) {
		// Internal server error
		console.error('Internal error:', error)
		const errorResponse = createError(null, ErrorCode.InternalError, 'Internal server error')
		return new Response(serializeResponse(errorResponse), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		})
	}
}
