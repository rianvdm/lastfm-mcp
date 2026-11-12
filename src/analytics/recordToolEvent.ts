// ABOUTME: Writes one anonymous tool-call event to the TOOL_EVENTS Analytics Engine dataset, labelled with the calling OAuth client.
// ABOUTME: Never rejects: a missing binding, a failing write or a failing client lookup must not affect the tool call.
import { SERVER_VERSION } from '../mcp/protocol'
import type { Env } from '../types/env'
import { isCimdClientId, labelForClient } from './clientLabel'
import { toDataPoint, type ToolCallEvent } from './toolEvents'

/** Most client labels kept in memory per isolate. Registration is open, so the memo must not grow without bound. */
const MAX_MEMOISED_LABELS = 500

/** Labels for registered (DCR) clients by client ID, oldest first, so a client's name is read from KV once per isolate. */
const labelsByClientId = new Map<string, string>()

/**
 * Records one tool call. Call it inside `ctx.waitUntil` so the write stays off the response path.
 *
 * The client label comes from the client ID alone for a CIMD (URL) client, and from the registered `clientName` in
 * OAUTH_KV for a DCR client. The event carries no user identifier: only the tool, the client label, the outcome,
 * the cache result, the server version and the duration.
 */
export async function recordToolEvent(env: Env, clientId: string | undefined, event: ToolCallEvent): Promise<void> {
	try {
		const label = await clientLabelFor(env, clientId)
		env.TOOL_EVENTS?.writeDataPoint(toDataPoint(event, label, SERVER_VERSION))
	} catch (error) {
		console.warn('[ANALYTICS] tool event not recorded:', error instanceof Error ? error.message : 'Unknown error')
	}
}

async function clientLabelFor(env: Env, clientId: string | undefined): Promise<string> {
	// No ID, or a CIMD URL: labelForClient needs no stored name
	if (!clientId || isCimdClientId(clientId)) return labelForClient(clientId)

	const memoised = labelsByClientId.get(clientId)
	if (memoised !== undefined) return memoised

	let client: { clientName?: unknown } | null
	try {
		client = await env.OAUTH_KV.get<{ clientName?: unknown }>(`client:${clientId}`, 'json')
	} catch (error) {
		// Not memoised, so the next call for this client tries KV again
		console.warn('[ANALYTICS] client lookup failed:', error instanceof Error ? error.message : 'Unknown error')
		return labelForClient(clientId)
	}

	const label = labelForClient(clientId, typeof client?.clientName === 'string' ? client.clientName : undefined)
	if (labelsByClientId.size >= MAX_MEMOISED_LABELS) {
		// Maps iterate in insertion order, so the first key is the oldest
		const oldest = labelsByClientId.keys().next().value
		if (oldest !== undefined) labelsByClientId.delete(oldest)
	}
	labelsByClientId.set(clientId, label)
	return label
}
