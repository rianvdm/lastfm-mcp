// ABOUTME: KV records captured from workers-oauth-provider 1.2.4 for each requested resource variant, plus their plaintext tokens.
// ABOUTME: Loaded into OAUTH_KV by rollback tests to prove 0.10.3 with origin-only matching still serves and refreshes 1.x grants.
// Test-only values: the tokens and keys belong to fake `capture1x-*` users, not real credentials.
// Captured from 1.2.4 on 2026-11-07 (sign-in, code exchange, then one refresh per variant). Never regenerate this on 0.10.3:
// its value is that it is real 1.x data. 1.x also set KV expirations (clients 90 days, grants 30 days, tokens 1 hour); the loader
// writes without them, as the in-record timestamps are what the library checks.

export interface CapturedGrant {
	label: 'none' | 'origin' | 'origin-slash' | 'mcp'
	origin: string
	clientId: string
	/** The latest refresh token, issued by the 1.x refresh. */
	refreshToken: string
	/** The latest access token, issued by the 1.x refresh. */
	accessToken: string
	requestedResource?: string
}

export const OAUTH_1X_KV: { key: string; value: string; metadata?: unknown }[] = [
	{
		key: 'client:OzRvOmuxvbpL3W6J',
		value:
			'{"clientId":"OzRvOmuxvbpL3W6J","redirectUris":["http://localhost:3000/callback"],"clientName":"Resource Compat Test Client","grantTypes":["authorization_code","refresh_token"],"responseTypes":["code"],"registrationDate":1794063523,"tokenEndpointAuthMethod":"none","authMethodExplicit":true,"registrationExpiresAt":1801839523}',
	},
	{
		key: 'client:deQdeXCj1Sv-0xv7',
		value:
			'{"clientId":"deQdeXCj1Sv-0xv7","redirectUris":["http://localhost:3000/callback"],"clientName":"Resource Compat Test Client","grantTypes":["authorization_code","refresh_token"],"responseTypes":["code"],"registrationDate":1794063523,"tokenEndpointAuthMethod":"none","authMethodExplicit":true,"registrationExpiresAt":1801839523}',
	},
	{
		key: 'client:hZ6MrrD_9H4QGMcu',
		value:
			'{"clientId":"hZ6MrrD_9H4QGMcu","redirectUris":["http://localhost:3000/callback"],"clientName":"Resource Compat Test Client","grantTypes":["authorization_code","refresh_token"],"responseTypes":["code"],"registrationDate":1794063523,"tokenEndpointAuthMethod":"none","authMethodExplicit":true,"registrationExpiresAt":1801839523}',
	},
	{
		key: 'client:sfg7sk0dAsiiqU8y',
		value:
			'{"clientId":"sfg7sk0dAsiiqU8y","redirectUris":["http://localhost:3000/callback"],"clientName":"Resource Compat Test Client","grantTypes":["authorization_code","refresh_token"],"responseTypes":["code"],"registrationDate":1794063523,"tokenEndpointAuthMethod":"none","authMethodExplicit":true,"registrationExpiresAt":1801839523}',
	},
	{
		key: 'grant:capture1x-mcp:258nHi_zx9KfjwLc',
		value:
			'{"id":"258nHi_zx9KfjwLc","clientId":"sfg7sk0dAsiiqU8y","userId":"capture1x-mcp","scope":[],"metadata":{"label":"Last.fm MCP Access","lastfmUsername":"capture1x-mcp","authorizedAt":"2026-11-07T14:58:43.634Z"},"encryptedProps":"XQv5pEJ7Tke9yjWEfGAWfL5K64hI8/9kFFUmsnvqaA3CcbNwXELLnv22bquWgevEUBK/Ac5t6oqRg53jSzLdDmbZXI3wx5oB9F739+839BvQGUGri2GDhgAHrVH4kSaT1mMQ9moyeCnXwag2r8Nq+T+5vA==","createdAt":1794063523,"authCodeId":"0aac09d61848050650bc641c86e2d5249c6001dd7d97d64773470be0bcc704b7","resource":"https://lastfm-mcp.com","redirectUri":"http://localhost:3000/callback","refreshTokenId":"747c306e241714a83359dff13c3a07f34e542994be8e5d2fa2dee158fda9c8c5","refreshTokenWrappedKey":"aT0dQsu/eGduPT46c4ae4ZGNerJIEHcNoMrL9EuB/s47BnSlyrv5Ew==","expiresAt":1796655523,"previousRefreshTokenId":"3e41a873296c09fefed72d843a06c0aecb27ba1ccd3a6507970ad69646e70761","previousRefreshTokenWrappedKey":"5AL0myHWuRtVCoFnf47/nWa3QpgHoIzIAcPik/Bs9hhZEiv4/mwbBA=="}',
		metadata: { clientId: 'sfg7sk0dAsiiqU8y', resource: 'https://lastfm-mcp.com', redirectUri: 'http://localhost:3000/callback' },
	},
	{
		key: 'grant:capture1x-none:gHCVo7KgYz6dPPag',
		value:
			'{"id":"gHCVo7KgYz6dPPag","clientId":"deQdeXCj1Sv-0xv7","userId":"capture1x-none","scope":[],"metadata":{"label":"Last.fm MCP Access","lastfmUsername":"capture1x-none","authorizedAt":"2026-11-07T14:58:43.584Z"},"encryptedProps":"dKqo1r3zzFIRDvMeJ3Xm2s/PMNj3s/Dfuq2LXRcY5KkU3RVeyO/Il8I/HW7nry91ERWRKblKaKMxKXPs3fxhryUOxTrG7Pout6OQDf4AwhnZ7iL50rKbGFzGzHnkvpzNFQN5IbGq2Exwz3XzmVBx2DbI8glZBw==","createdAt":1794063523,"authCodeId":"ca8557bdbd5fb92ffece550680a2f6e939f5eab8707454f6a9e3c4537d1d6a66","resource":"https://lastfm-mcp.com","redirectUri":"http://localhost:3000/callback","refreshTokenId":"400b77eac5ac0f2a3b5df0595b15fc6fa390373272618a50362b5928b49563a5","refreshTokenWrappedKey":"iYD9tkQTBXLWdA55IMHIi7vGCcMnXoqKXGZmdRpnCAFkOJozDD5bow==","expiresAt":1796655523,"previousRefreshTokenId":"2f7a5a21006b16e6576e7857f5ad4122e7729efea5ef0db6b79e25a69682fdaf","previousRefreshTokenWrappedKey":"pgMyWXpOeeFKdE+2Vbr1D4K5r4aBZ7D01h0SZRm+Earo2BSRLUYjSg=="}',
		metadata: { clientId: 'deQdeXCj1Sv-0xv7', resource: 'https://lastfm-mcp.com', redirectUri: 'http://localhost:3000/callback' },
	},
	{
		key: 'grant:capture1x-origin-slash:ZOczBAKmegrvkQGt',
		value:
			'{"id":"ZOczBAKmegrvkQGt","clientId":"hZ6MrrD_9H4QGMcu","userId":"capture1x-origin-slash","scope":[],"metadata":{"label":"Last.fm MCP Access","lastfmUsername":"capture1x-origin-slash","authorizedAt":"2026-11-07T14:58:43.625Z"},"encryptedProps":"RmB+JWBKKSreGKlJT90zNaVT1GdVYCgNlGUO6TP3pHB021qrrLTh2mMGdmbaDA2GaeYD0T5wIRI33ckFOkJDOKqaDBbAmbzeyJ02b2lirr3v/hYkTDD9jrdq+38iA917zi0dSaAOOnnhY1U+NcXDsoOmvZx59bRAmCgxm8ntX/4fR9l7PJs0jw2Zs/ORNQ==","createdAt":1794063523,"authCodeId":"1baaa6ab828cc47f65a2dec746881124912d3f1f81a31d5e871238ad66c1ebe1","resource":"https://lastfm-mcp.com","redirectUri":"http://localhost:3000/callback","refreshTokenId":"80805bad57f1ceed780e6748183523da185dac50a501d759168b362b6b9d2ebc","refreshTokenWrappedKey":"5T6uFdsBnOKt5h1SCrXzQegu+5IDz6kQnmUbnsCeA5En5cN0+Wwhog==","expiresAt":1796655523,"previousRefreshTokenId":"1ba480dfc76b5c9742d0e068910549078f629e7d7d0d165d51eeff608fa18c36","previousRefreshTokenWrappedKey":"kOD2XW8jhFRK5yIcmHlnBnHdqrFgatYjsBHIw1WaUViiB3+V7dP/kw=="}',
		metadata: { clientId: 'hZ6MrrD_9H4QGMcu', resource: 'https://lastfm-mcp.com', redirectUri: 'http://localhost:3000/callback' },
	},
	{
		key: 'grant:capture1x-origin:cFLJeoqmMzGRzeXe',
		value:
			'{"id":"cFLJeoqmMzGRzeXe","clientId":"OzRvOmuxvbpL3W6J","userId":"capture1x-origin","scope":[],"metadata":{"label":"Last.fm MCP Access","lastfmUsername":"capture1x-origin","authorizedAt":"2026-11-07T14:58:43.616Z"},"encryptedProps":"mcEZ6BrijYoJTEyEtFyxCJ6ipIgpcMLyXwtZWizOrS1Beb3u7s3ufYH3sArWh+imUf+JO4C9jaQMLRc8opX0yBR3OVkcVWu7ZmiJc9YGweeB9A2LQO8GtLwYM0wrs2eVkeKCUBeNhAKFFXB0hm4mTfKc3r0qqAh/sf4Guw==","createdAt":1794063523,"authCodeId":"879fc3f7c1f7af8da387cdc2a995c30028e39b5a4e53e55153ffce120fec174a","resource":"https://lastfm-mcp.com","redirectUri":"http://localhost:3000/callback","refreshTokenId":"079bd889eef10e1924ffe95b7c8f946ba3fa15ae22ea7d2ae473443e56c877ea","refreshTokenWrappedKey":"yAva9KzMRvu7OS60+aj6y8QVFqQtNpGbLKq0PWzQ47qmS1ff3UNQYA==","expiresAt":1796655523,"previousRefreshTokenId":"31200783128bbc9a90a6ac0e766207a93bfaa37c614ce953d7c4c3c65b9c3d73","previousRefreshTokenWrappedKey":"1yFyQ8821PoiuJL4/56+4StIHzl0JrRvQPFuScM90C9KdZtNs7+I/w=="}',
		metadata: { clientId: 'OzRvOmuxvbpL3W6J', resource: 'https://lastfm-mcp.com', redirectUri: 'http://localhost:3000/callback' },
	},
	{
		key: 'token:capture1x-mcp:258nHi_zx9KfjwLc:a20d1d0efc9e4b865394b667fa36e8f81cfdc2d6856f26116c44823b6ff9d276',
		value:
			'{"id":"a20d1d0efc9e4b865394b667fa36e8f81cfdc2d6856f26116c44823b6ff9d276","grantId":"258nHi_zx9KfjwLc","userId":"capture1x-mcp","createdAt":1794063523,"expiresAt":1794067123,"audience":"https://lastfm-mcp.com","scope":[],"wrappedEncryptionKey":"y1wgQbrEZVfMHORG8f1nZWRQ1p46VW6+VMQ7ZI1hW/iej+T7oILBEg==","grant":{"clientId":"sfg7sk0dAsiiqU8y","scope":[],"encryptedProps":"XQv5pEJ7Tke9yjWEfGAWfL5K64hI8/9kFFUmsnvqaA3CcbNwXELLnv22bquWgevEUBK/Ac5t6oqRg53jSzLdDmbZXI3wx5oB9F739+839BvQGUGri2GDhgAHrVH4kSaT1mMQ9moyeCnXwag2r8Nq+T+5vA=="}}',
	},
	{
		key: 'token:capture1x-mcp:258nHi_zx9KfjwLc:b463fd79203b713de8ee1205470dc7db6699edcabd23593d6461b153787ae918',
		value:
			'{"id":"b463fd79203b713de8ee1205470dc7db6699edcabd23593d6461b153787ae918","grantId":"258nHi_zx9KfjwLc","userId":"capture1x-mcp","createdAt":1794063523,"expiresAt":1794067123,"audience":"https://lastfm-mcp.com","scope":[],"wrappedEncryptionKey":"nzGsXjr9JZSzEtZxfP4H+nTRoJJiiVpcf1x9STZ7pKsixQSyZ1FtbA==","grant":{"clientId":"sfg7sk0dAsiiqU8y","scope":[],"encryptedProps":"XQv5pEJ7Tke9yjWEfGAWfL5K64hI8/9kFFUmsnvqaA3CcbNwXELLnv22bquWgevEUBK/Ac5t6oqRg53jSzLdDmbZXI3wx5oB9F739+839BvQGUGri2GDhgAHrVH4kSaT1mMQ9moyeCnXwag2r8Nq+T+5vA=="}}',
	},
	{
		key: 'token:capture1x-none:gHCVo7KgYz6dPPag:7835f4b946a1be93b2869fe99f8af54ad5f579be973ba48c17cf65ac3b387bde',
		value:
			'{"id":"7835f4b946a1be93b2869fe99f8af54ad5f579be973ba48c17cf65ac3b387bde","grantId":"gHCVo7KgYz6dPPag","userId":"capture1x-none","createdAt":1794063523,"expiresAt":1794067123,"audience":"https://lastfm-mcp.com","scope":[],"wrappedEncryptionKey":"JKetR2suE5mZ/P5hSc1bu5e7gpwCfRTxfk2m26HIiITxgmfAC9HdvQ==","grant":{"clientId":"deQdeXCj1Sv-0xv7","scope":[],"encryptedProps":"dKqo1r3zzFIRDvMeJ3Xm2s/PMNj3s/Dfuq2LXRcY5KkU3RVeyO/Il8I/HW7nry91ERWRKblKaKMxKXPs3fxhryUOxTrG7Pout6OQDf4AwhnZ7iL50rKbGFzGzHnkvpzNFQN5IbGq2Exwz3XzmVBx2DbI8glZBw=="}}',
	},
	{
		key: 'token:capture1x-none:gHCVo7KgYz6dPPag:784f48e07f42c8accf82741d5c585e4ad8134695ca6254af10787f1c0d329b20',
		value:
			'{"id":"784f48e07f42c8accf82741d5c585e4ad8134695ca6254af10787f1c0d329b20","grantId":"gHCVo7KgYz6dPPag","userId":"capture1x-none","createdAt":1794063523,"expiresAt":1794067123,"audience":"https://lastfm-mcp.com","scope":[],"wrappedEncryptionKey":"bdXyE8AxzhvS+RmIVqniq1kZu1mTS14xv91zhk3H5SHGX3g31QT3KQ==","grant":{"clientId":"deQdeXCj1Sv-0xv7","scope":[],"encryptedProps":"dKqo1r3zzFIRDvMeJ3Xm2s/PMNj3s/Dfuq2LXRcY5KkU3RVeyO/Il8I/HW7nry91ERWRKblKaKMxKXPs3fxhryUOxTrG7Pout6OQDf4AwhnZ7iL50rKbGFzGzHnkvpzNFQN5IbGq2Exwz3XzmVBx2DbI8glZBw=="}}',
	},
	{
		key: 'token:capture1x-origin-slash:ZOczBAKmegrvkQGt:003c3a3b796a8eaa4ccf6ceaad187a5bec4ec0561ea45b7f8e9b60d52621a440',
		value:
			'{"id":"003c3a3b796a8eaa4ccf6ceaad187a5bec4ec0561ea45b7f8e9b60d52621a440","grantId":"ZOczBAKmegrvkQGt","userId":"capture1x-origin-slash","createdAt":1794063523,"expiresAt":1794067123,"audience":"https://lastfm-mcp.com","scope":[],"wrappedEncryptionKey":"xdQURHCQHeSsUuX5LUC6sPHuEjwiIXkyAu5hcaexV8558c5ZWRDHMw==","grant":{"clientId":"hZ6MrrD_9H4QGMcu","scope":[],"encryptedProps":"RmB+JWBKKSreGKlJT90zNaVT1GdVYCgNlGUO6TP3pHB021qrrLTh2mMGdmbaDA2GaeYD0T5wIRI33ckFOkJDOKqaDBbAmbzeyJ02b2lirr3v/hYkTDD9jrdq+38iA917zi0dSaAOOnnhY1U+NcXDsoOmvZx59bRAmCgxm8ntX/4fR9l7PJs0jw2Zs/ORNQ=="}}',
	},
	{
		key: 'token:capture1x-origin-slash:ZOczBAKmegrvkQGt:8e803a69d3412cd79e80dd7c3b9a9219cd0f2fb0e9738f1a4f7289f75d87ba38',
		value:
			'{"id":"8e803a69d3412cd79e80dd7c3b9a9219cd0f2fb0e9738f1a4f7289f75d87ba38","grantId":"ZOczBAKmegrvkQGt","userId":"capture1x-origin-slash","createdAt":1794063523,"expiresAt":1794067123,"audience":"https://lastfm-mcp.com","scope":[],"wrappedEncryptionKey":"HByQPp900nCyryzRwQX4tX1lF2AN6JEtZcsxWZvEu6hHgXYZLqiV+w==","grant":{"clientId":"hZ6MrrD_9H4QGMcu","scope":[],"encryptedProps":"RmB+JWBKKSreGKlJT90zNaVT1GdVYCgNlGUO6TP3pHB021qrrLTh2mMGdmbaDA2GaeYD0T5wIRI33ckFOkJDOKqaDBbAmbzeyJ02b2lirr3v/hYkTDD9jrdq+38iA917zi0dSaAOOnnhY1U+NcXDsoOmvZx59bRAmCgxm8ntX/4fR9l7PJs0jw2Zs/ORNQ=="}}',
	},
	{
		key: 'token:capture1x-origin:cFLJeoqmMzGRzeXe:18c0191df0d3db1e9d7f62da9c5603b4c3d24422b9dcc3d29f77234b30475b80',
		value:
			'{"id":"18c0191df0d3db1e9d7f62da9c5603b4c3d24422b9dcc3d29f77234b30475b80","grantId":"cFLJeoqmMzGRzeXe","userId":"capture1x-origin","createdAt":1794063523,"expiresAt":1794067123,"audience":"https://lastfm-mcp.com","scope":[],"wrappedEncryptionKey":"TlcmSFoqvGpnjTyLTm7cRPs5MRsplZZ6ELUiEsJ4uYA7eONpH/yQ8w==","grant":{"clientId":"OzRvOmuxvbpL3W6J","scope":[],"encryptedProps":"mcEZ6BrijYoJTEyEtFyxCJ6ipIgpcMLyXwtZWizOrS1Beb3u7s3ufYH3sArWh+imUf+JO4C9jaQMLRc8opX0yBR3OVkcVWu7ZmiJc9YGweeB9A2LQO8GtLwYM0wrs2eVkeKCUBeNhAKFFXB0hm4mTfKc3r0qqAh/sf4Guw=="}}',
	},
	{
		key: 'token:capture1x-origin:cFLJeoqmMzGRzeXe:ca568cf9616a1bcba49fee9aaa23fe6f9ac14b699ed5e1044454fdebf3160db9',
		value:
			'{"id":"ca568cf9616a1bcba49fee9aaa23fe6f9ac14b699ed5e1044454fdebf3160db9","grantId":"cFLJeoqmMzGRzeXe","userId":"capture1x-origin","createdAt":1794063523,"expiresAt":1794067123,"audience":"https://lastfm-mcp.com","scope":[],"wrappedEncryptionKey":"D1hNw8EQyg6ItX0zhRvPbjjBXIc3h9U5fJT2cblk6A9TVBo5JcQefg==","grant":{"clientId":"OzRvOmuxvbpL3W6J","scope":[],"encryptedProps":"mcEZ6BrijYoJTEyEtFyxCJ6ipIgpcMLyXwtZWizOrS1Beb3u7s3ufYH3sArWh+imUf+JO4C9jaQMLRc8opX0yBR3OVkcVWu7ZmiJc9YGweeB9A2LQO8GtLwYM0wrs2eVkeKCUBeNhAKFFXB0hm4mTfKc3r0qqAh/sf4Guw=="}}',
	},
]

export const OAUTH_1X_GRANTS: CapturedGrant[] = [
	{
		label: 'none',
		origin: 'https://lastfm-mcp.com',
		clientId: 'deQdeXCj1Sv-0xv7',
		refreshToken: 'capture1x-none:gHCVo7KgYz6dPPag:rX7_TRQuNEnlxQKAcgSzlUTDYFadtjJO',
		accessToken: 'capture1x-none:gHCVo7KgYz6dPPag:eJXeFNEkqVcxNJOMdh7ePLyKmVbRIzWA',
	},
	{
		label: 'origin',
		origin: 'https://lastfm-mcp.com',
		clientId: 'OzRvOmuxvbpL3W6J',
		refreshToken: 'capture1x-origin:cFLJeoqmMzGRzeXe:S2PDiYYfC3Fh8tsALTo7v-ZMPxGjFCh1',
		accessToken: 'capture1x-origin:cFLJeoqmMzGRzeXe:cWdkoS5FZPWmchqN-0g4yB6obzQ0bp06',
		requestedResource: 'https://lastfm-mcp.com',
	},
	{
		label: 'origin-slash',
		origin: 'https://lastfm-mcp.com',
		clientId: 'hZ6MrrD_9H4QGMcu',
		refreshToken: 'capture1x-origin-slash:ZOczBAKmegrvkQGt:hWuGGywLCnkdgdxGWSzNbsAbUyhgZjiX',
		accessToken: 'capture1x-origin-slash:ZOczBAKmegrvkQGt:qyawqLJ26B6rROYlfrarFBvsi92Kz858',
		requestedResource: 'https://lastfm-mcp.com/',
	},
	{
		label: 'mcp',
		origin: 'https://lastfm-mcp.com',
		clientId: 'sfg7sk0dAsiiqU8y',
		refreshToken: 'capture1x-mcp:258nHi_zx9KfjwLc:OU3LbbAqmIJAYzQvkhL0TojSE-5TMFsS',
		accessToken: 'capture1x-mcp:258nHi_zx9KfjwLc:P3FiYVKDXRPhyPfAagZrkfFUN2kjEKB_',
		requestedResource: 'https://lastfm-mcp.com/mcp',
	},
]

/** Epoch seconds at which the records above were captured (after the last write; every `createdAt` is at or before it). */
export const OAUTH_1X_CAPTURED_AT = 1794063523

/** Record fields holding epoch-second timestamps in 1.2.4 client, grant and token records. */
const TIMESTAMP_FIELDS = ['createdAt', 'expiresAt', 'registrationDate', 'registrationExpiresAt']

/** Shift the timestamp fields of one JSON record by `offsetSeconds`; everything else is left as captured. */
function rebaseRecord(value: string, offsetSeconds: number): string {
	const record = JSON.parse(value) as Record<string, unknown>
	for (const field of TIMESTAMP_FIELDS) {
		if (typeof record[field] === 'number') record[field] += offsetSeconds
	}
	return JSON.stringify(record)
}

/**
 * Write every captured record, with its KV metadata, into the namespace with no KV expiration.
 *
 * The library checks the in-record `expiresAt`, so records loaded long after capture would be expired. Timestamps are
 * rebased by (now - capture time) so each record is as fresh relative to now as it was when captured, without fake timers.
 * `OAUTH_1X_KV` itself is not modified.
 */
export async function loadOAuth1xFixture(kv: KVNamespace): Promise<void> {
	const offsetSeconds = Math.floor(Date.now() / 1000) - OAUTH_1X_CAPTURED_AT
	for (const entry of OAUTH_1X_KV) {
		const value = rebaseRecord(entry.value, offsetSeconds)
		await kv.put(entry.key, value, entry.metadata === undefined ? undefined : { metadata: entry.metadata })
	}
}
