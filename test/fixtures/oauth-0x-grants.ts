// ABOUTME: KV records captured from workers-oauth-provider 0.10.3 for each requested resource variant, plus their plaintext refresh tokens.
// ABOUTME: Loaded into OAUTH_KV by upgrade tests to prove 0.10.3 grants still refresh (or are rejected) on 1.x.
// Test-only values: the refresh tokens and keys belong to fake `capture-*` users, not real credentials.
// Captured from 0.10.3 on 2026-11-07. Never regenerate this on 1.x: its value is that it is real 0.10.3 data.

export interface CapturedGrant {
	label: 'none' | 'origin' | 'origin-slash' | 'mcp'
	origin: string
	clientId: string
	refreshToken: string
	requestedResource?: string
}

export const OAUTH_0X_KV: { key: string; value: string; metadata?: unknown }[] = [
	{
		key: 'client:TUHoC7c2XUSjA8nU',
		value:
			'{"clientId":"TUHoC7c2XUSjA8nU","redirectUris":["http://localhost:3000/callback"],"clientName":"Resource Compat Test Client","grantTypes":["authorization_code","refresh_token"],"responseTypes":["code"],"registrationDate":1794061046,"tokenEndpointAuthMethod":"none","authMethodExplicit":true}',
	},
	{
		key: 'client:attWm-_eYbuOEK5Z',
		value:
			'{"clientId":"attWm-_eYbuOEK5Z","redirectUris":["http://localhost:3000/callback"],"clientName":"Resource Compat Test Client","grantTypes":["authorization_code","refresh_token"],"responseTypes":["code"],"registrationDate":1794061046,"tokenEndpointAuthMethod":"none","authMethodExplicit":true}',
	},
	{
		key: 'client:paKIaCARju0uRSsx',
		value:
			'{"clientId":"paKIaCARju0uRSsx","redirectUris":["http://localhost:3000/callback"],"clientName":"Resource Compat Test Client","grantTypes":["authorization_code","refresh_token"],"responseTypes":["code"],"registrationDate":1794061046,"tokenEndpointAuthMethod":"none","authMethodExplicit":true}',
	},
	{
		key: 'client:txugA2UuCS01q-K1',
		value:
			'{"clientId":"txugA2UuCS01q-K1","redirectUris":["http://localhost:3000/callback"],"clientName":"Resource Compat Test Client","grantTypes":["authorization_code","refresh_token"],"responseTypes":["code"],"registrationDate":1794061046,"tokenEndpointAuthMethod":"none","authMethodExplicit":true}',
	},
	{
		key: 'grant:capture-mcp:C0wjFYg0wjFKHyM6',
		value:
			'{"id":"C0wjFYg0wjFKHyM6","clientId":"attWm-_eYbuOEK5Z","userId":"capture-mcp","scope":[],"metadata":{"label":"Last.fm MCP Access","lastfmUsername":"capture-mcp","authorizedAt":"2026-11-07T14:17:26.330Z"},"encryptedProps":"GWHkRPoy1H/UFUsUBP1MlVhhnUisxueJJ+2BMgC1QY9VMOoWPQoYf4mjTPYvjDHApbqw8XQlKOZqz4hlfqqEvqt60YWbHKOEfWqQ9gCtXsGHBBUorMFutxfE6OYb/8JQ2HGkcA==","createdAt":1794061046,"authCodeId":"9599fff35f8e11610a23f8607b81e3014ccbbab9f441a6a2d53920ba4f0e0d78","resource":"https://lastfm-mcp.com/mcp","redirectUri":"http://localhost:3000/callback","refreshTokenId":"0f5dc9dc807b57db38ae2a07cb8f2af69c61ef385a5513638ced765e31516ac7","refreshTokenWrappedKey":"1Oq4K2pe9e9kstUyaq/i9Petdqq01kxhtmE+CFvYYkhWJ+P7i0zXzA==","expiresAt":1796653046}',
	},
	{
		key: 'grant:capture-none:ujUvM3AO6Rw_rVIX',
		value:
			'{"id":"ujUvM3AO6Rw_rVIX","clientId":"txugA2UuCS01q-K1","userId":"capture-none","scope":[],"metadata":{"label":"Last.fm MCP Access","lastfmUsername":"capture-none","authorizedAt":"2026-11-07T14:17:26.311Z"},"encryptedProps":"3/RCLS4RM2KTz181ksdjkEcWHYrDqk1f6ZrkllUZc1E3CV6+7xjIPqL4+i0E5sZgXWVMSOlavNy239pZJNM+g2K8XvikZing4OaijuUJTsWJlbM/nh8TxnGxUUksRRpiBLc9/NncbA==","createdAt":1794061046,"authCodeId":"f8d0f7d00214d6a2e682cfb17b7d84fca70182430745d300a48fa28fde0e2d0d","redirectUri":"http://localhost:3000/callback","refreshTokenId":"ca8e45cdf766761b9c7df29175e032dd7110a74f50087de7ebf84c2e716fa163","refreshTokenWrappedKey":"jgR1irtQbVG4uQvIOTWWLN5VVcJUmfGWkctnGNqItmN9C/ucLfiOwA==","expiresAt":1796653046}',
	},
	{
		key: 'grant:capture-origin-slash:e7jtJsno8mLmZWLU',
		value:
			'{"id":"e7jtJsno8mLmZWLU","clientId":"paKIaCARju0uRSsx","userId":"capture-origin-slash","scope":[],"metadata":{"label":"Last.fm MCP Access","lastfmUsername":"capture-origin-slash","authorizedAt":"2026-11-07T14:17:26.326Z"},"encryptedProps":"4LAuSH+jXCPj1HnXEr0VjAwm234YB88oe/V2Ob2u6yKsiC13j6WkI7P7+xwkVkIzssQysH4DfBKe1JORDZq23lR/H15iBDNxqfCGTHuoUunk4PyuEXQT6hzthSBnHCLtRy0SYK5LcRZCJ9FmUbzpR8SV3ifX2nAym6gLJoUINQ==","createdAt":1794061046,"authCodeId":"10085e5f8609f03ae1e85ca22057c90f75ca13ee1520c55ade5b14d5abdd6696","resource":"https://lastfm-mcp.com/","redirectUri":"http://localhost:3000/callback","refreshTokenId":"186013b0f4bbc9cda79656b5060cd9d770f3945a761e9ccd93091b192ea41382","refreshTokenWrappedKey":"ne/2ruguy5+b6RfyAeur5eLG0Cki8a8fpi1+iPZ4nnSTht/Q+2ZGcA==","expiresAt":1796653046}',
	},
	{
		key: 'grant:capture-origin:4Njrec79jrDl9BEv',
		value:
			'{"id":"4Njrec79jrDl9BEv","clientId":"TUHoC7c2XUSjA8nU","userId":"capture-origin","scope":[],"metadata":{"label":"Last.fm MCP Access","lastfmUsername":"capture-origin","authorizedAt":"2026-11-07T14:17:26.322Z"},"encryptedProps":"fvMPYEekMlNtzg+tPBhjS6OGaPLSc0j2R+YzFcJ7ZrdD/6VzOJYLVwuLUDvjR/diqWHnsB0AyVEMnLsWlrWnjLjyGu1B6jW61CZAkHngucrzcF8uU3fru6lTtCWHh2LXjn8cBTzyg+LFYCSBTg==","createdAt":1794061046,"authCodeId":"621094daeef3f9c9f6c39b60da62b62d030f243130e1d7f619f8b78c28090d03","resource":"https://lastfm-mcp.com","redirectUri":"http://localhost:3000/callback","refreshTokenId":"db826616b9b71cf8d5be71afaaa96b319f73127d4eb9fbf2b78795e188cc304b","refreshTokenWrappedKey":"bE67ntLZQgh72Q51qCGeC3+juAjY95n26NqzaZ50MJq+h6FjkEwpQQ==","expiresAt":1796653046}',
	},
	{
		key: 'token:capture-mcp:C0wjFYg0wjFKHyM6:ee19b65593711d4ef0c88881845f6a45b685b885b1e22a5e665f5d022f1e0203',
		value:
			'{"id":"ee19b65593711d4ef0c88881845f6a45b685b885b1e22a5e665f5d022f1e0203","grantId":"C0wjFYg0wjFKHyM6","userId":"capture-mcp","createdAt":1794061046,"expiresAt":1794064646,"audience":"https://lastfm-mcp.com/mcp","scope":[],"wrappedEncryptionKey":"PhnlHJQGOJQf3lPLAX5NGETaf5+L1h9X+T0GlVlrULrbgxepc0w6Ew==","grant":{"clientId":"attWm-_eYbuOEK5Z","scope":[],"encryptedProps":"GWHkRPoy1H/UFUsUBP1MlVhhnUisxueJJ+2BMgC1QY9VMOoWPQoYf4mjTPYvjDHApbqw8XQlKOZqz4hlfqqEvqt60YWbHKOEfWqQ9gCtXsGHBBUorMFutxfE6OYb/8JQ2HGkcA=="}}',
	},
	{
		key: 'token:capture-none:ujUvM3AO6Rw_rVIX:34809fc0cc23a2daac2a6ec256d1cf4bb849f3cf1e4bcadff2342e6e9f100312',
		value:
			'{"id":"34809fc0cc23a2daac2a6ec256d1cf4bb849f3cf1e4bcadff2342e6e9f100312","grantId":"ujUvM3AO6Rw_rVIX","userId":"capture-none","createdAt":1794061046,"expiresAt":1794064646,"scope":[],"wrappedEncryptionKey":"fTC/cbPIzP7X7lOKi8Kn1Q/iQCpRelsIBsZh8FEv5nBf/EDpDmdyrw==","grant":{"clientId":"txugA2UuCS01q-K1","scope":[],"encryptedProps":"3/RCLS4RM2KTz181ksdjkEcWHYrDqk1f6ZrkllUZc1E3CV6+7xjIPqL4+i0E5sZgXWVMSOlavNy239pZJNM+g2K8XvikZing4OaijuUJTsWJlbM/nh8TxnGxUUksRRpiBLc9/NncbA=="}}',
	},
	{
		key: 'token:capture-origin-slash:e7jtJsno8mLmZWLU:3c3cb1357e58388e293e15e56dfc67b484b4958ea7ddd4dc09652f86ee356b4b',
		value:
			'{"id":"3c3cb1357e58388e293e15e56dfc67b484b4958ea7ddd4dc09652f86ee356b4b","grantId":"e7jtJsno8mLmZWLU","userId":"capture-origin-slash","createdAt":1794061046,"expiresAt":1794064646,"audience":"https://lastfm-mcp.com/","scope":[],"wrappedEncryptionKey":"vLfPoaefxf9iaVRwNkJFg7XNhzTXZqGgZBCBmTTOxeJ1UvlMTjpxrA==","grant":{"clientId":"paKIaCARju0uRSsx","scope":[],"encryptedProps":"4LAuSH+jXCPj1HnXEr0VjAwm234YB88oe/V2Ob2u6yKsiC13j6WkI7P7+xwkVkIzssQysH4DfBKe1JORDZq23lR/H15iBDNxqfCGTHuoUunk4PyuEXQT6hzthSBnHCLtRy0SYK5LcRZCJ9FmUbzpR8SV3ifX2nAym6gLJoUINQ=="}}',
	},
	{
		key: 'token:capture-origin:4Njrec79jrDl9BEv:0baa0592d500282a491e1fc56bc288a43f014cb17dc38f43b3946cba886ba70e',
		value:
			'{"id":"0baa0592d500282a491e1fc56bc288a43f014cb17dc38f43b3946cba886ba70e","grantId":"4Njrec79jrDl9BEv","userId":"capture-origin","createdAt":1794061046,"expiresAt":1794064646,"audience":"https://lastfm-mcp.com","scope":[],"wrappedEncryptionKey":"XeSUYSuoqlE9DWYdgalqHHIMZcTPCEBCcTs8mBtHqc5aiuosIXlPog==","grant":{"clientId":"TUHoC7c2XUSjA8nU","scope":[],"encryptedProps":"fvMPYEekMlNtzg+tPBhjS6OGaPLSc0j2R+YzFcJ7ZrdD/6VzOJYLVwuLUDvjR/diqWHnsB0AyVEMnLsWlrWnjLjyGu1B6jW61CZAkHngucrzcF8uU3fru6lTtCWHh2LXjn8cBTzyg+LFYCSBTg=="}}',
	},
]

export const OAUTH_0X_GRANTS: CapturedGrant[] = [
	{
		label: 'none',
		origin: 'https://lastfm-mcp.com',
		clientId: 'txugA2UuCS01q-K1',
		refreshToken: 'capture-none:ujUvM3AO6Rw_rVIX:jWyU3q3wndxOZ47-_ZBzxev_CJ58hMY6',
	},
	{
		label: 'origin',
		origin: 'https://lastfm-mcp.com',
		clientId: 'TUHoC7c2XUSjA8nU',
		refreshToken: 'capture-origin:4Njrec79jrDl9BEv:P_sSqAvwe_1muLO0vLLJKS9RNM4Q6CEH',
		requestedResource: 'https://lastfm-mcp.com',
	},
	{
		label: 'origin-slash',
		origin: 'https://lastfm-mcp.com',
		clientId: 'paKIaCARju0uRSsx',
		refreshToken: 'capture-origin-slash:e7jtJsno8mLmZWLU:85A-I5dBhR7b3fnm0s5ze978Y7JAJ5kW',
		requestedResource: 'https://lastfm-mcp.com/',
	},
	{
		label: 'mcp',
		origin: 'https://lastfm-mcp.com',
		clientId: 'attWm-_eYbuOEK5Z',
		refreshToken: 'capture-mcp:C0wjFYg0wjFKHyM6:leTKRtxWprKXDa_ECphRfI0WqoyWDEGW',
		requestedResource: 'https://lastfm-mcp.com/mcp',
	},
]

/** Epoch seconds at which the records above were written (their `createdAt`). */
export const OAUTH_0X_CAPTURED_AT = 1794061046

/** Record fields holding epoch-second timestamps in 0.10.3 client, grant and token records. */
const TIMESTAMP_FIELDS = ['createdAt', 'expiresAt', 'registrationDate']

/** Shift the timestamp fields of one JSON record by `offsetSeconds`; everything else is left as captured. */
function rebaseRecord(value: string, offsetSeconds: number): string {
	const record = JSON.parse(value) as Record<string, unknown>
	for (const field of TIMESTAMP_FIELDS) {
		if (typeof record[field] === 'number') record[field] += offsetSeconds
	}
	return JSON.stringify(record)
}

/**
 * Write every captured record into the namespace with no KV expiration.
 *
 * The library checks the in-record `expiresAt`, so records loaded long after capture would be expired. Timestamps are
 * rebased by (now - capture time) so each record is as fresh relative to now as it was when captured, without fake timers.
 * `OAUTH_0X_KV` itself is not modified.
 */
export async function loadOAuth0xFixture(kv: KVNamespace): Promise<void> {
	const offsetSeconds = Math.floor(Date.now() / 1000) - OAUTH_0X_CAPTURED_AT
	for (const entry of OAUTH_0X_KV) {
		const value = rebaseRecord(entry.value, offsetSeconds)
		await kv.put(entry.key, value, entry.metadata === undefined ? undefined : { metadata: entry.metadata })
	}
}
