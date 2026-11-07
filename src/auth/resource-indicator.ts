// ABOUTME: Maps the `<origin>/mcp` resource indicator to the bare server origin on /authorize and /oauth/token.
// ABOUTME: Lets clients that name the MCP endpoint as their resource pass the OAuth provider's exact-match check.

/**
 * Some MCP clients send `resource=${origin}/mcp` (the endpoint they connect to) rather than the
 * protected resource the server advertises, which is the bare origin. RFC 8707 §2.2 says the
 * authorization server should accept only resources it recognizes, and the OAuth provider compares
 * exactly, so it would answer such requests with `invalid_target`.
 *
 * These helpers rewrite exactly `${origin}/mcp` to `${origin}` and nothing else, so the provider keeps
 * rejecting every other value. Strings are compared as-is rather than as parsed URLs, so dot segments
 * and percent-encodings never match. Each returns the same `Request` object when nothing changes.
 *
 * Delete this module once the library maps path descendants of an origin resource itself:
 * https://github.com/cloudflare/workers-oauth-provider/issues/430
 */

/** Map each `resource` value equal to `${origin}/mcp` to the origin; null when none matched. */
function rewriteResources(params: URLSearchParams, origin: string): URLSearchParams | null {
	const mcpResource = `${origin}/mcp`
	let changed = false
	const rewritten = new URLSearchParams()
	for (const [key, value] of params) {
		if (key === 'resource' && value === mcpResource) {
			rewritten.append(key, origin)
			changed = true
		} else {
			rewritten.append(key, value)
		}
	}
	return changed ? rewritten : null
}

/** Rewrite `resource` in the query string of a GET /authorize request. */
export function normalizeAuthorizeResource(request: Request, url: URL): Request {
	const rewritten = rewriteResources(url.searchParams, url.origin)
	if (!rewritten) return request
	const target = new URL(url)
	target.search = rewritten.toString()
	return new Request(target.toString(), request)
}

/** Rewrite `resource` in the form body of a POST /oauth/token request. */
export async function normalizeTokenResource(request: Request): Promise<Request> {
	if (request.method !== 'POST') return request
	// Match the media type the way the provider does (case-insensitive, parameters ignored), so every body it parses is rewritten
	const contentType = request.headers.get('content-type') ?? ''
	if (contentType.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return request

	// Read a clone so the original body stays unconsumed when nothing changes. Decode the bytes directly:
	// workerd warns on .text() for urlencoded bodies.
	const body = new TextDecoder().decode(await request.clone().arrayBuffer())
	const rewritten = rewriteResources(new URLSearchParams(body), new URL(request.url).origin)
	if (!rewritten) return request
	// The rewrite shortens the body, so drop the incoming Content-Length and let the runtime set it
	const headers = new Headers(request.headers)
	headers.delete('content-length')
	return new Request(request.url, { method: request.method, headers, body: rewritten.toString() })
}
