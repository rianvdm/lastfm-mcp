// ABOUTME: Unit tests for the /mcp resource indicator rewrite on /authorize and /oauth/token.
// ABOUTME: Pins the narrow mapping of exactly `${origin}/mcp` to the origin and the pass-through of everything else.
import { describe, it, expect } from 'vitest'

import { normalizeAuthorizeResource, normalizeTokenResource } from '../../src/auth/resource-indicator'

const ORIGIN = 'https://lastfm-mcp.com'
const OTHER_HOST = 'https://lastfm-mcp.rian-db8.workers.dev'

const UNCHANGED_RESOURCES = [
	'https://evil.example/mcp',
	'https://lastfm-mcp.com/mcp/x',
	'https://lastfm-mcp.com/mcp?x=1',
	'https://lastfm-mcp.com/mcp-other',
	'https://lastfm-mcp.com',
]

function authorizeRequest(query: string, origin = ORIGIN): { request: Request; url: URL } {
	const url = new URL(`${origin}/authorize${query}`)
	return { request: new Request(url.toString()), url }
}

function tokenRequest(body: string, init: { method?: string; contentType?: string; origin?: string } = {}): Request {
	const method = init.method ?? 'POST'
	return new Request(`${init.origin ?? ORIGIN}/oauth/token`, {
		method,
		headers: {
			'Content-Type': init.contentType ?? 'application/x-www-form-urlencoded',
			Authorization: 'Basic abc',
		},
		body: method === 'GET' ? undefined : body,
	})
}

// workerd warns on .text() for urlencoded bodies, so decode the bytes
const bodyText = async (request: Request) => new TextDecoder().decode(await request.arrayBuffer())

const form = (...pairs: [string, string][]) => new URLSearchParams(pairs).toString()

describe('normalizeAuthorizeResource', () => {
	it('should map the /mcp resource to the origin and keep other params', () => {
		const { request, url } = authorizeRequest('?resource=https://lastfm-mcp.com/mcp&state=x')
		const result = normalizeAuthorizeResource(request, url)
		const params = new URL(result.url).searchParams
		expect(result).not.toBe(request)
		expect(params.get('resource')).toBe(ORIGIN)
		expect(params.get('state')).toBe('x')
	})

	it.each(UNCHANGED_RESOURCES)('should leave resource %s unchanged', (resource) => {
		const { request, url } = authorizeRequest(`?resource=${encodeURIComponent(resource)}&state=x`)
		expect(normalizeAuthorizeResource(request, url)).toBe(request)
	})

	it('should leave a request without resource unchanged', () => {
		const { request, url } = authorizeRequest('?state=x')
		expect(normalizeAuthorizeResource(request, url)).toBe(request)
	})

	it('should not map the production origin on a different host', () => {
		const { request, url } = authorizeRequest('?resource=https://lastfm-mcp.com/mcp', OTHER_HOST)
		expect(normalizeAuthorizeResource(request, url)).toBe(request)
	})

	it('should replace each matching repeated resource and keep the others', () => {
		const { request, url } = authorizeRequest(
			'?resource=https://lastfm-mcp.com/mcp&resource=https://evil.example/mcp&resource=https://lastfm-mcp.com/mcp',
		)
		const result = normalizeAuthorizeResource(request, url)
		expect(new URL(result.url).searchParams.getAll('resource')).toEqual([ORIGIN, 'https://evil.example/mcp', ORIGIN])
	})
})

describe('normalizeTokenResource', () => {
	it('should map the /mcp resource to the origin, keeping fields and Authorization', async () => {
		const request = tokenRequest('grant_type=refresh_token&refresh_token=r&resource=https%3A%2F%2Flastfm-mcp.com%2Fmcp')
		const result = await normalizeTokenResource(request)
		const params = new URLSearchParams(await bodyText(result))
		expect(result).not.toBe(request)
		expect(result.method).toBe('POST')
		expect(result.headers.get('Authorization')).toBe('Basic abc')
		expect(params.get('resource')).toBe(ORIGIN)
		expect(params.get('grant_type')).toBe('refresh_token')
		expect(params.get('refresh_token')).toBe('r')
	})

	it.each(UNCHANGED_RESOURCES)('should leave resource %s unchanged', async (resource) => {
		const request = tokenRequest(form(['grant_type', 'refresh_token'], ['resource', resource]))
		expect(await normalizeTokenResource(request)).toBe(request)
	})

	it('should leave a request without resource unchanged', async () => {
		const request = tokenRequest(form(['grant_type', 'refresh_token']))
		expect(await normalizeTokenResource(request)).toBe(request)
	})

	it('should leave a GET request unchanged', async () => {
		const request = tokenRequest('', { method: 'GET' })
		expect(await normalizeTokenResource(request)).toBe(request)
	})

	it('should leave a JSON body unchanged', async () => {
		const request = tokenRequest(JSON.stringify({ resource: `${ORIGIN}/mcp` }), { contentType: 'application/json' })
		expect(await normalizeTokenResource(request)).toBe(request)
	})

	it('should not map the production origin on a different host', async () => {
		const request = tokenRequest(form(['resource', `${ORIGIN}/mcp`]), { origin: OTHER_HOST })
		expect(await normalizeTokenResource(request)).toBe(request)
	})

	it('should replace each matching repeated resource and keep the others', async () => {
		const request = tokenRequest(
			form(['resource', `${ORIGIN}/mcp`], ['resource', 'https://evil.example/mcp'], ['resource', `${ORIGIN}/mcp`]),
		)
		const result = await normalizeTokenResource(request)
		expect(new URLSearchParams(await bodyText(result)).getAll('resource')).toEqual([ORIGIN, 'https://evil.example/mcp', ORIGIN])
	})
})
