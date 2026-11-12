// ABOUTME: Cloudflare Access gate for the dashboard Worker: verifies the Cf-Access-Jwt-Assertion header on every request.
// ABOUTME: Fails closed, so a missing, invalid or unverifiable token, or an unset ACCESS_AUD, gets a plain 403.
import { createRemoteJWKSet, jwtVerify } from 'jose'

import type { DashEnv } from './env'

const ACCESS_JWT_HEADER = 'Cf-Access-Jwt-Assertion'

type RemoteKeySet = ReturnType<typeof createRemoteJWKSet>

/** One key set per team domain for the isolate's lifetime, so jose's key cache and refetch cooldown carry across requests */
const keySets = new Map<string, RemoteKeySet>()

function keySetFor(teamDomain: string): RemoteKeySet {
	let keySet = keySets.get(teamDomain)
	if (!keySet) {
		keySet = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
		keySets.set(teamDomain, keySet)
	}
	return keySet
}

function forbidden(): Response {
	return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}

/**
 * Returns null when the request carries a valid Access JWT for this application, and a 403 response otherwise.
 *
 * The token must be signed by a key the team domain publishes, issued by that team domain, and addressed to ACCESS_AUD.
 * An empty ACCESS_AUD refuses everything: jose would otherwise accept a token whose audience is the empty string.
 */
export async function requireAccess(request: Request, env: DashEnv): Promise<Response | null> {
	if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
		console.warn('[ACCESS] ACCESS_TEAM_DOMAIN or ACCESS_AUD is unset; refusing the request')
		return forbidden()
	}

	const token = request.headers.get(ACCESS_JWT_HEADER)
	if (!token) return forbidden()

	try {
		await jwtVerify(token, keySetFor(env.ACCESS_TEAM_DOMAIN), {
			issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
			audience: env.ACCESS_AUD,
			algorithms: ['RS256'],
		})
		return null
	} catch (error) {
		console.warn('[ACCESS] Rejected Access JWT:', error instanceof Error ? error.message : 'Unknown error')
		return forbidden()
	}
}
