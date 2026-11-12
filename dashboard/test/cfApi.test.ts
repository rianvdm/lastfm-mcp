// ABOUTME: Tests the dashboard's read-only Cloudflare API client: KV list and get, the Analytics SQL API and Analytics Engine SQL.
// ABOUTME: Mocks fetch to check URLs, auth, pagination, URL-encoding, retry backoff with fake timers, and error handling.
import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'

import { analyticsSql, analyticsSqlApi, CfApiError, getKvJson, listKvKeys } from '../src/cfApi'
import type { DashEnv } from '../src/env'

const TOKEN = 'test-api-token'
const apiEnv: DashEnv = { ...env, CF_API_TOKEN: TOKEN }
const API = 'https://api.cloudflare.com/client/v4'
const KV_BASE = `${API}/accounts/${env.ACCOUNT_ID}/storage/kv/namespaces/${env.OAUTH_KV_NAMESPACE_ID}`

let fetchMock: MockInstance<typeof fetch>

/** Queues one response factory per call; a fresh Response each time, since a body can only be read once */
function respondWith(...factories: Array<() => Response>): void {
	for (const factory of factories) fetchMock.mockImplementationOnce(async () => factory())
}

function callUrl(index: number): URL {
	return new URL(String(fetchMock.mock.calls[index][0]))
}

function callInit(index: number): RequestInit {
	return fetchMock.mock.calls[index][1] ?? {}
}

function v4Error(status: number, message: string): Response {
	return Response.json({ success: false, errors: [{ code: 10000, message }], messages: [], result: null }, { status })
}

beforeEach(() => {
	fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('Unexpected fetch in test', { status: 500 }))
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('listKvKeys', () => {
	it('should follow the cursor across pages and return every key', async () => {
		respondWith(
			() =>
				Response.json({
					success: true,
					errors: [],
					result: [{ name: 'grant:u1:a', expiration: 1800000000, metadata: { x: 1 } }, { name: 'grant:u1:b' }],
					result_info: { count: 2, cursor: 'cursor-2' },
				}),
			() => Response.json({ success: true, errors: [], result: [{ name: 'grant:u2:c' }], result_info: { count: 1, cursor: '' } }),
		)

		const keys = await listKvKeys(apiEnv, 'grant:')

		expect(keys).toEqual([{ name: 'grant:u1:a', expiration: 1800000000 }, { name: 'grant:u1:b' }, { name: 'grant:u2:c' }])
		expect(fetchMock).toHaveBeenCalledTimes(2)

		const first = callUrl(0)
		expect(`${first.origin}${first.pathname}`).toBe(`${KV_BASE}/keys`)
		expect(first.searchParams.get('prefix')).toBe('grant:')
		expect(first.searchParams.get('limit')).toBe('1000')
		expect(first.searchParams.has('cursor')).toBe(false)

		const second = callUrl(1)
		expect(second.searchParams.get('cursor')).toBe('cursor-2')
		expect(second.searchParams.get('prefix')).toBe('grant:')
	})

	it('should stop when result_info has no cursor', async () => {
		respondWith(() => Response.json({ success: true, errors: [], result: [{ name: 'client:abc' }], result_info: { count: 1 } }))

		expect(await listKvKeys(apiEnv, 'client:')).toEqual([{ name: 'client:abc' }])
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('should send the API token as a bearer token and use GET', async () => {
		respondWith(() => Response.json({ success: true, errors: [], result: [], result_info: { cursor: '' } }))

		await listKvKeys(apiEnv, 'grant:')

		const init = callInit(0)
		expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`)
		expect(init.method ?? 'GET').toBe('GET')
	})
})

describe('getKvJson', () => {
	it('should URL-encode a key that contains a URL', async () => {
		respondWith(() => Response.json({ clientName: 'ChatGPT' }))

		const value = await getKvJson<{ clientName: string }>(apiEnv, 'client:https://chatgpt.com/oauth/client.json')

		expect(value).toEqual({ clientName: 'ChatGPT' })
		const requested = String(fetchMock.mock.calls[0][0])
		expect(requested).toBe(`${KV_BASE}/values/${encodeURIComponent('client:https://chatgpt.com/oauth/client.json')}`)
		expect(requested).toContain('client%3Ahttps%3A%2F%2Fchatgpt.com%2Foauth%2Fclient.json')
		expect(new Headers(callInit(0).headers).get('Authorization')).toBe(`Bearer ${TOKEN}`)
	})

	it('should return null for a missing key', async () => {
		respondWith(() => v4Error(404, 'key not found'))

		expect(await getKvJson(apiEnv, 'grant:u1:gone')).toBeNull()
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('should throw a CfApiError when the value is not JSON', async () => {
		respondWith(() => new Response('not json'))

		const error = await getKvJson(apiEnv, 'grant:u1:a').catch((e: unknown) => e)
		expect(error).toBeInstanceOf(CfApiError)
	})
})

describe('retries', () => {
	it('should retry 429s after 1 s and then 3 s, and resolve on the third attempt', async () => {
		vi.useFakeTimers()
		respondWith(
			() => v4Error(429, 'rate limited'),
			() => v4Error(429, 'rate limited'),
			() => Response.json({ ok: true }),
		)

		const pending = getKvJson(apiEnv, 'grant:u1:a')

		await vi.advanceTimersByTimeAsync(0)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(999)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(fetchMock).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(2999)
		expect(fetchMock).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(1)
		expect(fetchMock).toHaveBeenCalledTimes(3)

		await expect(pending).resolves.toEqual({ ok: true })
	})

	it('should throw a CfApiError with the status after three 5xx responses', async () => {
		vi.useFakeTimers()
		fetchMock.mockImplementation(async () => v4Error(503, 'upstream unavailable'))

		const pending = listKvKeys(apiEnv, 'grant:').catch((e: unknown) => e)
		await vi.advanceTimersByTimeAsync(4000)
		const error = await pending

		expect(error).toBeInstanceOf(CfApiError)
		expect((error as CfApiError).status).toBe(503)
		expect(fetchMock).toHaveBeenCalledTimes(3)
	})

	it('should throw a CfApiError with status 403 without retrying an auth failure', async () => {
		fetchMock.mockImplementation(async () => v4Error(403, 'Authentication error'))

		const error = await listKvKeys(apiEnv, 'grant:').catch((e: unknown) => e)

		expect(error).toBeInstanceOf(CfApiError)
		expect((error as CfApiError).status).toBe(403)
		expect((error as CfApiError).message).toContain('403')
		expect((error as CfApiError).message).toContain('Authentication error')
		expect((error as CfApiError).message).not.toContain(TOKEN)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('should keep a long error body out of the message', async () => {
		respondWith(() => new Response('x'.repeat(5000), { status: 400 }))

		const error = (await getKvJson(apiEnv, 'grant:u1:a').catch((e: unknown) => e)) as CfApiError

		expect(error.status).toBe(400)
		expect(error.message.length).toBeLessThan(300)
	})
})

describe('analyticsSql', () => {
	it('should POST the raw SQL with FORMAT JSON and return data', async () => {
		const rows = [{ tool: 'get_recent_tracks', calls: '12' }]
		respondWith(() => Response.json({ meta: [{ name: 'tool', type: 'String' }], data: rows, rows: 1 }))

		const result = await analyticsSql<{ tool: string; calls: string }>(
			apiEnv,
			'SELECT blob1 AS tool, SUM(_sample_interval) AS calls FROM t',
		)

		expect(result).toEqual(rows)
		expect(String(fetchMock.mock.calls[0][0])).toBe(`${API}/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`)
		const init = callInit(0)
		expect(init.method).toBe('POST')
		expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`)
		expect(init.body).toBe('SELECT blob1 AS tool, SUM(_sample_interval) AS calls FROM t FORMAT JSON')
	})

	it('should not add a second FORMAT JSON or keep a trailing semicolon', async () => {
		respondWith(() => Response.json({ meta: [], data: [], rows: 0 }))

		expect(await analyticsSql(apiEnv, 'SELECT 1 FORMAT JSON;\n')).toEqual([])
		expect(callInit(0).body).toBe('SELECT 1 FORMAT JSON')
	})

	it('should throw a CfApiError carrying the SQL API error text', async () => {
		respondWith(() => new Response('error in query: unknown function quantileWeighted', { status: 422 }))

		const error = (await analyticsSql(apiEnv, 'SELECT quantileWeighted(0.5)(double1, _sample_interval) FROM t').catch(
			(e: unknown) => e,
		)) as CfApiError

		expect(error).toBeInstanceOf(CfApiError)
		expect(error.status).toBe(422)
		expect(error.message).toContain('unknown function quantileWeighted')
	})
})

describe('analyticsSqlApi', () => {
	const SQL = "SELECT count() AS requests FROM events.workersInvocations WHERE timestamp >= '2026-11-11T00:00:00Z'"

	it('should POST the query with the account scope as JSON and return the top-level data rows', async () => {
		const rows = [{ date: '2026-11-05', status: 'success', requests: '38837' }]
		respondWith(() => Response.json({ data: rows, rows: 1, statistics: { elapsed_ms: 42, rows_read: 250000, bytes_read: 18000000 } }))

		const result = await analyticsSqlApi<{ date: string; status: string; requests: string }>(apiEnv, SQL)

		expect(result).toEqual(rows)
		expect(String(fetchMock.mock.calls[0][0])).toBe(`${API}/analytics/sql`)
		const init = callInit(0)
		expect(init.method).toBe('POST')
		const headers = new Headers(init.headers)
		expect(headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
		expect(headers.get('Content-Type')).toBe('application/json')
		expect(JSON.parse(String(init.body))).toEqual({ query: SQL, scope: { accountTag: env.ACCOUNT_ID } })
	})

	it('should also read data rows wrapped in a v4 result envelope', async () => {
		const rows = [{ requests: 7 }]
		respondWith(() => Response.json({ success: true, errors: [], messages: [], result: { data: rows, rows: 1 } }))

		expect(await analyticsSqlApi(apiEnv, SQL)).toEqual(rows)
	})

	it('should return an empty list for a query that matched nothing', async () => {
		respondWith(() => Response.json({ data: [], rows: 0, statistics: { elapsed_ms: 3, rows_read: 0, bytes_read: 0 } }))

		expect(await analyticsSqlApi(apiEnv, SQL)).toEqual([])
	})

	it('should throw a CfApiError carrying the plain-text error the SQL service returns', async () => {
		respondWith(() => new Response('MIN is not supported for adaptively sampled datasets; use APPROX_MIN', { status: 422 }))

		const error = (await analyticsSqlApi(apiEnv, SQL).catch((e: unknown) => e)) as CfApiError

		expect(error).toBeInstanceOf(CfApiError)
		expect(error.status).toBe(422)
		expect(error.message).toMatch(/^Analytics SQL API failed \(422\)/)
		expect(error.message).toContain('use APPROX_MIN')
	})

	it('should throw on a 200 whose v4 envelope reports failure', async () => {
		respondWith(() => Response.json({ success: false, errors: [{ code: 1000, message: 'dataset not found' }], result: null }))

		const error = (await analyticsSqlApi(apiEnv, SQL).catch((e: unknown) => e)) as CfApiError

		expect(error).toBeInstanceOf(CfApiError)
		expect(error.status).toBe(200)
		expect(error.message).toContain('dataset not found')
	})

	it('should throw on a 200 with no data rows in either place', async () => {
		respondWith(() => Response.json({ rows: 0 }))

		const error = (await analyticsSqlApi(apiEnv, SQL).catch((e: unknown) => e)) as CfApiError

		expect(error).toBeInstanceOf(CfApiError)
		expect(error.status).toBe(200)
		expect(error.message).toBe('Analytics SQL API returned no data')
	})

	it('should retry a 503 and resolve on the next attempt', async () => {
		vi.useFakeTimers()
		respondWith(
			() => new Response('service unavailable', { status: 503 }),
			() => Response.json({ data: [{ requests: 1 }], rows: 1 }),
		)

		const pending = analyticsSqlApi(apiEnv, SQL)
		await vi.advanceTimersByTimeAsync(1000)

		await expect(pending).resolves.toEqual([{ requests: 1 }])
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})
})
