// ABOUTME: Schema for the anonymous tool-call events the MCP Worker writes to Workers Analytics Engine (TOOL_EVENTS).
// ABOUTME: Fixes the data point layout the usage dashboard's SQL reads; events never carry a user identifier or tool arguments.
import type { AnalyticsEngineDataPoint } from '@cloudflare/workers-types'

export type ToolOutcome = 'ok' | 'error' | 'auth_required'

/** Whether the call's Last.fm data came from the response cache; 'none' when the tool made no cacheable lookup. */
export type CacheOutcome = 'hit' | 'miss' | 'none'

export interface ToolCallEvent {
	tool: string
	outcome: ToolOutcome
	cache: CacheOutcome
	durationMs: number
}

/**
 * Builds the Analytics Engine data point for one tool call. The dashboard's SQL depends on this layout:
 * index1 = tool; blob1 = tool, blob2 = client label, blob3 = outcome, blob4 = cache, blob5 = server version; double1 = duration in ms.
 */
export function toDataPoint(event: ToolCallEvent, clientLabel: string, serverVersion: string): AnalyticsEngineDataPoint {
	return {
		indexes: [event.tool],
		blobs: [event.tool, clientLabel, event.outcome, event.cache, serverVersion],
		doubles: [event.durationMs],
	}
}
