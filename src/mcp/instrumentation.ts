// ABOUTME: Times and classifies every MCP tools/call by wrapping the request handler McpServer installs for it.
// ABOUTME: Reports one anonymous ToolCallEvent per call (outcome, cache, duration, Last.fm requests); reporting never changes or fails it.
import type { McpServer } from '@modelcontextprotocol/server'

import type { CacheOutcome, ToolCallEvent, ToolOutcome } from '../analytics/toolEvents'
import { runWithCacheTally, type CacheTally } from '../utils/cacheTally'
import { AUTH_REQUIRED_HEADING } from './tools/authenticated'
import { isToolErrorText } from './tools/error-handler'

/** Recorded instead of the requested name when it isn't a registered tool, because the request text is the caller's input. */
export const UNKNOWN_TOOL = 'unknown_tool'

type ToolsCallHandler = (request: { params?: { name?: unknown } }, ctx: unknown) => Promise<unknown>
type SetRequestHandler = (method: string, ...rest: unknown[]) => void

/**
 * Makes every `tools/call` on `server` report one ToolCallEvent through `onToolCall`, whatever happens to the call:
 * a result, a tool error, the sign-in message, a throw, arguments the SDK rejects before the tool runs, or an unknown tool.
 *
 * It wraps the `tools/call` handler McpServer installs when the first tool is registered, so call it on a fresh server,
 * before any registerTool; it throws if the handler is already installed. Each call runs inside its own CacheTally, so its
 * cache outcome and Last.fm request count cover only the lookups it made, even when a batch runs calls concurrently. The
 * event carries a registered tool name or UNKNOWN_TOOL, never the arguments, the error text or the user.
 */
export function instrumentTools(server: McpServer, onToolCall: (event: ToolCallEvent) => void): void {
	const protocolServer = server.server
	protocolServer.assertCanSetRequestHandler('tools/call')

	const registeredNames = new Set<string>()
	const registerTool = server.registerTool.bind(server) as (name: string, ...rest: unknown[]) => ReturnType<McpServer['registerTool']>
	server.registerTool = ((name: string, ...rest: unknown[]) => {
		registeredNames.add(name)
		return registerTool(name, ...rest)
	}) as McpServer['registerTool']

	const setRequestHandler = protocolServer.setRequestHandler.bind(protocolServer) as SetRequestHandler
	protocolServer.setRequestHandler = ((method: string, ...rest: unknown[]) => {
		const [handler] = rest
		if (method === 'tools/call' && rest.length === 1 && typeof handler === 'function') {
			return setRequestHandler(method, instrumentHandler(handler as ToolsCallHandler, registeredNames, onToolCall))
		}
		return setRequestHandler(method, ...rest)
	}) as typeof protocolServer.setRequestHandler
}

function instrumentHandler(
	handler: ToolsCallHandler,
	registeredNames: ReadonlySet<string>,
	onToolCall: (event: ToolCallEvent) => void,
): ToolsCallHandler {
	return async (request, ctx) => {
		const requested = request.params?.name
		const tool = typeof requested === 'string' && registeredNames.has(requested) ? requested : UNKNOWN_TOOL
		const tally: CacheTally = { hits: 0, misses: 0, requests: 0 }
		const start = performance.now()
		// Stays 'error' if the handler throws (an unknown tool, say); the throw propagates unchanged to the SDK.
		let outcome: ToolOutcome = 'error'
		try {
			const result = await runWithCacheTally(tally, () => handler(request, ctx))
			outcome = classifyResult(tool, result)
			return result
		} finally {
			report(onToolCall, {
				tool,
				outcome,
				cache: cacheOutcome(tally),
				durationMs: performance.now() - start,
				lastfmRequests: tally.requests,
			})
		}
	}
}

/** A result is an error when flagged isError or when it carries toolError's text; auth_required when it opens with the sign-in heading. */
function classifyResult(tool: string, result: unknown): ToolOutcome {
	if (typeof result !== 'object' || result === null) return 'ok'
	const { isError, content } = result as { isError?: unknown; content?: unknown }
	if (isError === true) return 'error'

	const text = firstText(content)
	if (text === undefined) return 'ok'
	if (isToolErrorText(tool, text)) return 'error'
	if (text.startsWith(AUTH_REQUIRED_HEADING)) return 'auth_required'
	return 'ok'
}

/** The text of the first `type: 'text'` content block, if any. */
function firstText(content: unknown): string | undefined {
	if (!Array.isArray(content)) return undefined
	const block = content.find(
		(item): item is { type: 'text'; text: string } => typeof item === 'object' && item?.type === 'text' && typeof item.text === 'string',
	)
	return block?.text
}

/** Any Last.fm fetch makes the call a miss; otherwise any cached read makes it a hit. */
function cacheOutcome(tally: CacheTally): CacheOutcome {
	if (tally.misses > 0) return 'miss'
	if (tally.hits > 0) return 'hit'
	return 'none'
}

/** Analytics must never fail a tool call, so a throwing callback is logged and dropped. */
function report(onToolCall: (event: ToolCallEvent) => void, event: ToolCallEvent): void {
	try {
		onToolCall(event)
	} catch (error) {
		console.error('[ANALYTICS] onToolCall failed:', error instanceof Error ? error.message : 'Unknown error')
	}
}
