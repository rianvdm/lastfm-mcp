// ABOUTME: Unit tests for the plain-http to https redirect and its loopback host check.
// ABOUTME: Loopback hosts must keep plain http (wrangler dev); every other http request gets a 308 to https.
import { describe, it, expect } from 'vitest'

import { httpsRedirect, isLoopbackHostname } from '../../src/utils/httpsRedirect'

describe('isLoopbackHostname', () => {
	it.each(['localhost', 'LOCALHOST', '127.0.0.1', '127.255.255.255', '127.1.2.3', '::1', '[::1]'])(
		'should treat %s as loopback',
		(host) => {
			expect(isLoopbackHostname(host)).toBe(true)
		},
	)

	it.each(['lastfm-mcp.com', 'localhost.example.com', '128.0.0.1', '127.256.0.1', '127.0.0', '0.0.0.0', '[::2]'])(
		'should not treat %s as loopback',
		(host) => {
			expect(isLoopbackHostname(host)).toBe(false)
		},
	)
})

describe('httpsRedirect', () => {
	it('should return null for an https request', () => {
		expect(httpsRedirect(new URL('https://lastfm-mcp.com/mcp'))).toBeNull()
	})

	it.each(['http://localhost:8787/mcp', 'http://127.0.0.1:8787/health', 'http://[::1]:8787/'])(
		'should return null for loopback http at %s',
		(url) => {
			expect(httpsRedirect(new URL(url))).toBeNull()
		},
	)

	it('should answer non-loopback http with a 308 to the same URL on https', () => {
		const res = httpsRedirect(new URL('http://lastfm-mcp.com/authorize?client_id=abc&resource=https%3A%2F%2Flastfm-mcp.com%2Fmcp'))

		expect(res?.status).toBe(308)
		expect(res?.headers.get('Location')).toBe('https://lastfm-mcp.com/authorize?client_id=abc&resource=https%3A%2F%2Flastfm-mcp.com%2Fmcp')
	})

	it('should keep a non-default port', () => {
		const res = httpsRedirect(new URL('http://lastfm-mcp.com:8080/mcp'))

		expect(res?.headers.get('Location')).toBe('https://lastfm-mcp.com:8080/mcp')
	})
})
