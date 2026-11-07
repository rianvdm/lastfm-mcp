// ABOUTME: Test helpers that stand in for a Client ID Metadata Document (CIMD) host.
// ABOUTME: Routes outbound fetches for one metadata URL to a canned response and builds valid document responses.
import { vi } from 'vitest'

/** Extract the URL string from a fetch input. */
export function fetchTarget(input: RequestInfo | URL): string {
	return input instanceof Request ? input.url : input.toString()
}

/** A valid public-client metadata document for `metadataUrl`, with `fields` overriding the defaults. */
export function clientMetadataDocument(metadataUrl: string, fields: Record<string, unknown>): Response {
	return new Response(
		JSON.stringify({
			client_id: metadataUrl,
			client_name: 'Example CIMD Client',
			grant_types: ['authorization_code'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			...fields,
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
	)
}

/**
 * Route outbound fetches for a single metadata URL to a canned response; everything else
 * goes to the real fetch. Use a unique metadata URL per test so the provider's CIMD
 * cache can't carry a document over between tests. Undo with `vi.restoreAllMocks()`.
 */
export function mockMetadataFetch(metadataUrl: string, response: () => Response) {
	const realFetch = globalThis.fetch
	return vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
		if (fetchTarget(input) === metadataUrl) {
			return Promise.resolve(response())
		}
		return realFetch(input, init)
	})
}
