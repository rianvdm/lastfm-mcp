// ABOUTME: Redirects plain-http requests on non-loopback hosts to https with a 308.
// ABOUTME: workers-oauth-provider 1.x refuses an http protected resource outside loopback, so such requests must not reach it.

/**
 * Whether a URL hostname is a loopback host: `localhost`, 127.0.0.0/8 or `::1`.
 *
 * Mirrors workers-oauth-provider 1.x's internal `isLoopbackHostname` (RFC 8252 §7.3), which decides where it accepts
 * an `http` resource. The library doesn't export it, so the two must be kept in step.
 */
export function isLoopbackHostname(hostname: string): boolean {
	const host = hostname.toLowerCase()
	if (host === 'localhost' || host === '::1' || host === '[::1]') return true
	const ipv4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
	return ipv4 !== null && ipv4.slice(1).every((octet) => Number(octet) <= 255)
}

/**
 * A 308 to the same URL on https for a plain-http request to a non-loopback host; null otherwise.
 *
 * The Worker builds its OAuth provider from the request origin, and workers-oauth-provider 1.x throws at construction
 * for an `http` resource on a non-loopback host. Neither the custom domain nor workers.dev redirects http to https
 * for us. 308 (not 301/302) keeps the method and body, so a POST to /oauth/token is replayed as a POST. Loopback http
 * (`wrangler dev` on localhost:8787) is left alone.
 */
export function httpsRedirect(url: URL): Response | null {
	if (url.protocol !== 'http:' || isLoopbackHostname(url.hostname)) return null
	const target = new URL(url)
	target.protocol = 'https:'
	return Response.redirect(target.toString(), 308)
}
