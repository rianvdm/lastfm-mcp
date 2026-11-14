// ABOUTME: Checks that server.json, the MCP Registry listing, matches the version and endpoint the Worker reports.
// ABOUTME: The registry only learns about a release when server.json is bumped, so version drift fails here.
import { describe, it, expect } from 'vitest'

import packageJson from '../package.json'
import serverJson from '../server.json'
import { SERVER_VERSION } from '../src/mcp/protocol'

describe('server.json (MCP Registry listing)', () => {
	it('should carry the same version as the server and package.json', () => {
		expect(serverJson.version).toBe(SERVER_VERSION)
		expect(serverJson.version).toBe(packageJson.version)
	})

	it('should point its only remote at the production MCP endpoint', () => {
		expect(serverJson.remotes).toEqual([{ type: 'streamable-http', url: 'https://lastfm-mcp.com/mcp' }])
	})

	it('should use an icon served from the server itself', () => {
		for (const icon of serverJson.icons) {
			expect(new URL(icon.src).hostname).toBe('lastfm-mcp.com')
		}
	})
})
