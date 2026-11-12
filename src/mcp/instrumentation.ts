// ABOUTME: Times and classifies every MCP tool call by wrapping McpServer.registerTool.
// ABOUTME: Reports one anonymous ToolCallEvent per call (tool, outcome, cache, duration); reporting never changes or fails the call.
import type { McpServer } from '@modelcontextprotocol/server'

import type { CacheOutcome, ToolCallEvent, ToolOutcome } from '../analytics/toolEvents'
import type { CacheTally } from '../utils/cache'
import { AUTH_REQUIRED_HEADING } from './tools/authenticated'
import { isToolErrorText } from './tools/error-handler'

type ToolCallback = (...args: unknown[]) => unknown
type RegisterTool = (name: string, config: object, cb: ToolCallback) => ReturnType<McpServer['registerTool']>

/**
 * Wraps `server.registerTool` so every tool registered afterwards reports a ToolCallEvent through `onToolCall`.
 * `tally` must be the one the tools' CachedLastfmClient counts on; the event's cache outcome is read from how it
 * changed during the call. The event carries only the tool name, never its arguments or the user.
 */
export function instrumentTools(server: McpServer, tally: CacheTally, onToolCall: (event: ToolCallEvent) => void): void {
	const register = server.registerTool.bind(server) as unknown as RegisterTool

	const registerInstrumented: RegisterTool = (name, config, cb) =>
		register(name, config, async (...args: unknown[]) => {
			const hitsBefore = tally.hits
			const missesBefore = tally.misses
			const start = performance.now()
			// Stays 'error' if the callback throws; the throw propagates unchanged to the SDK.
			let outcome: ToolOutcome = 'error'
			try {
				const result = await cb(...args)
				outcome = classifyResult(name, result)
				return result
			} finally {
				const cache = cacheOutcome(tally, hitsBefore, missesBefore)
				report(onToolCall, { tool: name, outcome, cache, durationMs: performance.now() - start })
			}
		})

	server.registerTool = registerInstrumented as unknown as McpServer['registerTool']
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
function cacheOutcome(tally: CacheTally, hitsBefore: number, missesBefore: number): CacheOutcome {
	if (tally.misses > missesBefore) return 'miss'
	if (tally.hits > hitsBefore) return 'hit'
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
