// ABOUTME: Upgrade survival tests that load real workers-oauth-provider 0.10.3 KV records, plus a 0.1.0-shaped variant, and refresh them.
// ABOUTME: Unbound, origin, origin-slash and 0.1.0 grants must keep working; /mcp-bound grants get invalid_grant so clients sign in again.
import { env } from 'cloudflare:test'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import worker from '../src/index-oauth'
import { OAUTH_0X_GRANTS, loadOAuth0xFixture } from './fixtures/oauth-0x-grants'
import { callMcp, refresh } from './helpers/oauth-flow'

// The source does `new LastfmAuth(...)`, so the mock implementation must be a class.
vi.mock('../src/auth/lastfm', () => ({
	LastfmAuth: class {
		getAuthUrl = vi.fn().mockImplementation((callbackUrl?: string) => {
			const params = new URLSearchParams({ api_key: 'test-key' })
			if (callbackUrl) params.set('cb', callbackUrl)
			return `https://www.last.fm/api/auth/?${params.toString()}`
		})
		getSessionKey = vi.fn().mockResolvedValue({
			sessionKey: 'mock-session-key',
			username: 'testuser',
		})
	},
}))

const SURVIVING_GRANTS = OAUTH_0X_GRANTS.filter(({ label }) => label !== 'mcp')
const MCP_BOUND_GRANT = OAUTH_0X_GRANTS.find(({ label }) => label === 'mcp')!
const UNBOUND_GRANT = OAUTH_0X_GRANTS.find(({ label }) => label === 'none')!

/**
 * Rewrite the unbound 0.10.3 grant and its client in KV into the shape 0.1.0 wrote (production ran 0.1.0 until 2026-08-24).
 *
 * After a code exchange, 0.1.0 deleted `authCodeId` from the grant, never stored `redirectUri`, and left `expiresAt` unset
 * because no `refreshTokenTTL` was configured. Its client records had no `authMethodExplicit`. Everything else (record
 * keys, token hashing, key wrapping and props encryption) is the same in both versions, so the captured secrets still work.
 */
async function rewriteAs010Shape(kv: KVNamespace, userId: string, grantId: string, clientId: string): Promise<void> {
	await dropFields(kv, `grant:${userId}:${grantId}`, ['authCodeId', 'redirectUri', 'expiresAt'])
	await dropFields(kv, `client:${clientId}`, ['authMethodExplicit'])
}

/** Remove fields from a JSON record in KV and write it back under the same key. */
async function dropFields(kv: KVNamespace, key: string, fields: string[]): Promise<void> {
	const raw = await kv.get(key)
	if (raw === null) throw new Error(`Fixture record ${key} is missing`)
	const record = JSON.parse(raw) as Record<string, unknown>
	for (const field of fields) delete record[field]
	await kv.put(key, JSON.stringify(record))
}

describe('0.10.3 grants after the OAuth provider upgrade', () => {
	beforeEach(async () => {
		await loadOAuth0xFixture(env.OAUTH_KV)
	})

	it.each(SURVIVING_GRANTS)(
		'should refresh a 0.10.3 grant bound to $label and call a tool',
		async ({ origin, clientId, refreshToken, requestedResource }) => {
			const refreshRes = await refresh(worker, env, { origin, clientId, refreshToken, resource: requestedResource })
			expect(refreshRes.status).toBe(200)
			const refreshed = (await refreshRes.json()) as { access_token?: string }
			expect(refreshed.access_token).toBeTruthy()

			expect((await callMcp(worker, env, origin, refreshed.access_token!)).status).toBe(200)
		},
	)

	it('should answer a refresh of a /mcp-bound 0.10.3 grant with invalid_grant so the client signs in again', async () => {
		const { origin, clientId, refreshToken, requestedResource } = MCP_BOUND_GRANT

		const refreshRes = await refresh(worker, env, { origin, clientId, refreshToken, resource: requestedResource })

		expect(refreshRes.status).toBe(400)
		const body = (await refreshRes.json()) as { error?: string }
		expect(body.error).not.toBe('invalid_target')
		expect(body.error).toBe('invalid_grant')
	})
})

describe('0.1.0-shaped grants after the OAuth provider upgrade', () => {
	beforeEach(async () => {
		await loadOAuth0xFixture(env.OAUTH_KV)
		const [userId, grantId] = UNBOUND_GRANT.refreshToken.split(':')
		await rewriteAs010Shape(env.OAUTH_KV, userId, grantId, UNBOUND_GRANT.clientId)
	})

	it('should refresh a grant with no expiry, redirect URI or auth-code hash and call a tool', async () => {
		const { origin, clientId, refreshToken } = UNBOUND_GRANT

		const refreshRes = await refresh(worker, env, { origin, clientId, refreshToken })
		expect(refreshRes.status).toBe(200)
		const refreshed = (await refreshRes.json()) as { access_token?: string }
		expect(refreshed.access_token).toBeTruthy()

		expect((await callMcp(worker, env, origin, refreshed.access_token!)).status).toBe(200)
	})
})
