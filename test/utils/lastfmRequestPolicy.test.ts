// ABOUTME: Tests for the per-call Last.fm request policy: request budget, wall-clock deadline, concurrency cap and retry overrides.
// ABOUTME: Also covers isRateLimited and that requests made outside a policy stay unrestricted.
import { describe, it, expect, vi, afterEach } from 'vitest'

import {
	RECOMMENDATION_POLICY,
	RequestBudgetExceeded,
	isRateLimited,
	runWithRequestPolicy,
	withPolicy,
	type RequestPolicy,
} from '../../src/utils/lastfmRequestPolicy'
import { fetchWithRetry, type RetryOptions } from '../../src/utils/retry'

const POLICY: RequestPolicy = { maxRequests: 40, deadlineMs: 60_000, maxConcurrent: 4, maxRetries: 1, maxRetryDelayMs: 1 }

/** A promise plus the function that resolves it, so a test decides when a send finishes. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void
	const promise = new Promise<void>((r) => (resolve = r))
	return { promise, resolve }
}

/** Lets queued microtasks and zero-delay timers run, so sends waiting on a freed slot get to start. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A send that makes one charged attempt and resolves straight away, the way fetchWithRetry does on a 200. */
function oneAttempt(retry: Partial<RetryOptions>): Promise<string> {
	retry.onAttempt?.(1)
	return Promise.resolve('ok')
}

/** Resolves to 'hung' if `promise` hasn't settled after a short real-time wait, so a leaked slot fails fast. */
function settledOrHung<T>(promise: Promise<T>): Promise<T | 'hung'> {
	return Promise.race([promise, new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 50))])
}

describe('lastfmRequestPolicy', () => {
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('RECOMMENDATION_POLICY', () => {
		it('should hold the recommendations tool limits', () => {
			expect(RECOMMENDATION_POLICY).toEqual({ maxRequests: 40, timeoutMs: 8000, maxConcurrent: 4, maxRetries: 1, maxRetryDelayMs: 2000 })
		})
	})

	describe('concurrency', () => {
		it('should never run more than maxConcurrent requests at once', async () => {
			let inFlight = 0
			let peak = 0
			const gates = Array.from({ length: 10 }, () => deferred())
			let started = 0

			const done = runWithRequestPolicy(POLICY, () =>
				Promise.all(
					gates.map(() =>
						withPolicy(async (retry) => {
							const gate = gates[started++]
							retry.onAttempt?.(1)
							inFlight++
							peak = Math.max(peak, inFlight)
							await gate.promise
							inFlight--
						}),
					),
				),
			)

			await flush()
			expect(started).toBe(4)
			for (const gate of gates) {
				gate.resolve()
				await flush()
			}
			await done

			expect(started).toBe(10)
			expect(peak).toBe(4)
		})

		it('should release the slot of a rejected send', async () => {
			const policy = { ...POLICY, maxConcurrent: 1 }

			const result = await runWithRequestPolicy(policy, async () => {
				await expect(withPolicy(() => Promise.reject(new Error('HTTP 500: Internal Server Error')))).rejects.toThrow('HTTP 500')
				return settledOrHung(Promise.all([withPolicy(oneAttempt), withPolicy(oneAttempt), withPolicy(oneAttempt)]))
			})

			expect(result).toEqual(['ok', 'ok', 'ok'])
		})

		it('should hand the slot on when the budget refuses a retry', async () => {
			const policy = { ...POLICY, maxConcurrent: 1, maxRequests: 1 }

			const [holder, queued] = await runWithRequestPolicy(policy, () => {
				const refused = withPolicy((retry) => {
					retry.onAttempt?.(1)
					retry.onAttempt?.(2)
					return Promise.resolve('unreachable')
				}).catch((e: unknown) => e)
				// Queued behind the holder; it must wake and settle rather than wait on a leaked slot
				const waiting = settledOrHung(withPolicy(oneAttempt).catch((e: unknown) => e))
				return Promise.all([refused, waiting])
			})

			expect(holder).toBeInstanceOf(RequestBudgetExceeded)
			expect(queued).toBeInstanceOf(RequestBudgetExceeded)
			expect((queued as RequestBudgetExceeded).reason).toBe('budget')
		})
	})

	describe('budget', () => {
		it('should throw RequestBudgetExceeded with reason budget once maxRequests attempts are spent', async () => {
			const send = vi.fn(oneAttempt)

			const error = await runWithRequestPolicy({ ...POLICY, maxRequests: 3 }, async () => {
				await withPolicy(send)
				await withPolicy(send)
				await withPolicy(send)
				return withPolicy(send).catch((e: unknown) => e)
			})

			expect(error).toBeInstanceOf(RequestBudgetExceeded)
			expect((error as RequestBudgetExceeded).reason).toBe('budget')
			expect(send).toHaveBeenCalledTimes(3)
		})

		it('should count a retry against the budget', async () => {
			vi.spyOn(console, 'log').mockImplementation(() => {})
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
				.mockResolvedValueOnce(new Response('{}'))
			const send = (retry: Partial<RetryOptions>) => fetchWithRetry('https://ws.audioscrobbler.com/2.0/', undefined, retry)

			const error = await runWithRequestPolicy({ ...POLICY, maxRequests: 2 }, async () => {
				const response = await withPolicy(send)
				expect(response.status).toBe(200)
				return withPolicy(send).catch((e: unknown) => e)
			})

			expect(fetchSpy).toHaveBeenCalledTimes(2)
			expect(error).toBeInstanceOf(RequestBudgetExceeded)
			expect((error as RequestBudgetExceeded).reason).toBe('budget')
		})

		it('should pass the policy retry limits to the send', async () => {
			let received: Partial<RetryOptions> | undefined

			await runWithRequestPolicy({ ...POLICY, maxRetries: 1, maxRetryDelayMs: 2000 }, () =>
				withPolicy((retry) => {
					received = retry
					return Promise.resolve()
				}),
			)

			expect(received).toMatchObject({ maxRetries: 1, maxDelayMs: 2000 })
			expect(received?.onAttempt).toBeTypeOf('function')
		})
	})

	describe('deadline', () => {
		it('should throw with reason deadline after deadlineMs', async () => {
			vi.useFakeTimers()
			const send = vi.fn(oneAttempt)

			const error = await runWithRequestPolicy({ ...POLICY, deadlineMs: 1000 }, async () => {
				await withPolicy(send)
				vi.advanceTimersByTime(1000)
				return withPolicy(send).catch((e: unknown) => e)
			})

			expect(error).toBeInstanceOf(RequestBudgetExceeded)
			expect((error as RequestBudgetExceeded).reason).toBe('deadline')
			expect(send).toHaveBeenCalledTimes(1)
		})
	})

	describe('hard deadline', () => {
		it('should cancel an in-flight request at the deadline and release its slot', async () => {
			vi.useFakeTimers()
			let received: AbortSignal | undefined

			const promise = runWithRequestPolicy({ ...POLICY, deadlineMs: 1000 }, () =>
				withPolicy((retry, signal) => {
					retry.onAttempt?.(1)
					received = signal
					return new Promise<never>(() => {})
				}),
			).catch((e: unknown) => e)
			await vi.advanceTimersByTimeAsync(1000)
			const error = await promise

			expect(error).toBeInstanceOf(RequestBudgetExceeded)
			expect((error as RequestBudgetExceeded).reason).toBe('deadline')
			expect(received?.aborted).toBe(true)
			expect(vi.getTimerCount()).toBe(0)
		})

		it('should reject a queued send at the deadline without any slot freeing', async () => {
			vi.useFakeTimers()
			const queuedSend = vi.fn(oneAttempt)
			const neverResolves = (retry: Partial<RetryOptions>) => {
				retry.onAttempt?.(1)
				return new Promise<never>(() => {})
			}

			const promise = runWithRequestPolicy({ ...POLICY, deadlineMs: 1000, maxConcurrent: 4 }, () =>
				Promise.all([
					...Array.from({ length: 4 }, () => withPolicy(neverResolves).catch((e: unknown) => e)),
					withPolicy(queuedSend).catch((e: unknown) => e),
				]),
			)
			await vi.advanceTimersByTimeAsync(1000)
			const errors = await promise

			expect(queuedSend).not.toHaveBeenCalled()
			for (const error of errors) {
				expect(error).toBeInstanceOf(RequestBudgetExceeded)
				expect((error as RequestBudgetExceeded).reason).toBe('deadline')
			}
			expect(vi.getTimerCount()).toBe(0)
		})

		it('should keep the deadline timer until a request the call left in flight releases its slot', async () => {
			vi.useFakeTimers()
			const gate = deferred()
			let orphan: Promise<unknown> | undefined

			await runWithRequestPolicy({ ...POLICY, deadlineMs: 1000 }, async () => {
				orphan = withPolicy(async (retry) => {
					retry.onAttempt?.(1)
					await gate.promise
				})
			})

			expect(vi.getTimerCount()).toBe(1)
			gate.resolve()
			await orphan
			expect(vi.getTimerCount()).toBe(0)
		})

		it('should clear the deadline timer when the call finishes early', async () => {
			vi.useFakeTimers()

			await runWithRequestPolicy({ ...POLICY, deadlineMs: 1000 }, () => withPolicy(oneAttempt))

			expect(vi.getTimerCount()).toBe(0)
		})

		it('should give a send no signal outside a policy', async () => {
			let received: AbortSignal | undefined = new AbortController().signal

			await withPolicy((_retry, signal) => {
				received = signal
				return Promise.resolve()
			})

			expect(received).toBeUndefined()
		})
	})

	describe('outside a policy', () => {
		it('should leave requests outside a policy unrestricted', async () => {
			const gates = Array.from({ length: 10 }, () => deferred())
			const received: Partial<RetryOptions>[] = []

			const done = Promise.all(
				gates.map((gate) =>
					withPolicy(async (retry) => {
						received.push(retry)
						retry.onAttempt?.(1)
						await gate.promise
					}),
				),
			)

			await flush()
			expect(received).toHaveLength(10)
			expect(received.every((retry) => Object.keys(retry).length === 0)).toBe(true)
			gates.forEach((gate) => gate.resolve())
			await done
		})

		it('should keep concurrent policies separate', async () => {
			const twoSends = () =>
				runWithRequestPolicy({ ...POLICY, maxRequests: 2 }, () => Promise.all([withPolicy(oneAttempt), withPolicy(oneAttempt)]))

			await expect(Promise.all([twoSends(), twoSends()])).resolves.toEqual([
				['ok', 'ok'],
				['ok', 'ok'],
			])
		})
	})

	describe('isRateLimited', () => {
		it('should recognise an HTTP 429 and Last.fm error 29', () => {
			expect(isRateLimited(new Error('HTTP 429: Too Many Requests'))).toBe(true)
			expect(isRateLimited(new Error('Last.fm API error 29: Rate limit exceeded'))).toBe(true)
		})

		it('should not flag other errors', () => {
			expect(isRateLimited(new Error('Last.fm API error 6: The artist you supplied could not be found'))).toBe(false)
			expect(isRateLimited(new Error('HTTP 500: Internal Server Error'))).toBe(false)
			expect(isRateLimited('HTTP 429')).toBe(false)
			expect(isRateLimited(undefined)).toBe(false)
		})
	})
})
