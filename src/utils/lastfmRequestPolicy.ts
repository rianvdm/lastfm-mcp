// ABOUTME: Per-call Last.fm request policy (request budget, wall-clock deadline, concurrency cap, short retries) in AsyncLocalStorage.
// ABOUTME: A tool call opts in with runWithRequestPolicy; LastfmClient sends every request through withPolicy, a no-op outside one.
import { AsyncLocalStorage } from 'node:async_hooks'

import type { RetryOptions } from './retry'

/** Limits on the Last.fm requests one tool call makes, retries included. */
export interface RequestPolicy {
	/** HTTP attempts allowed across the whole call, each retry counting as one. */
	maxRequests: number
	/** Wall-clock milliseconds from runWithRequestPolicy after which no new attempt starts. */
	deadlineMs: number
	/** Requests allowed in flight at once; the rest wait in arrival order. */
	maxConcurrent: number
	/** Retries per request, replacing the client's default. */
	maxRetries: number
	/** Cap on any one retry delay, Retry-After included, replacing the client's default. */
	maxRetryDelayMs: number
}

/** The get_music_recommendations limits. `timeoutMs` becomes the policy's `deadlineMs`. */
export const RECOMMENDATION_POLICY: Omit<RequestPolicy, 'deadlineMs'> & { timeoutMs: number } = {
	maxRequests: 40,
	timeoutMs: 8000,
	maxConcurrent: 4,
	maxRetries: 1,
	maxRetryDelayMs: 2000,
}

/**
 * Thrown in place of a Last.fm request the current policy refuses. The message avoids the words fetchWithRetry treats as
 * transient ("timeout", "rate limit", "429", "network"), so a refused attempt is never retried.
 */
export class RequestBudgetExceeded extends Error {
	constructor(public readonly reason: 'budget' | 'deadline') {
		super(reason === 'budget' ? 'Last.fm request budget spent for this call' : 'Last.fm request deadline passed for this call')
		this.name = 'RequestBudgetExceeded'
	}
}

/** True for a Last.fm rate-limit failure: an HTTP 429 from fetchWithRetry or Last.fm's own error 29. */
export function isRateLimited(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	return /^HTTP 429\b/.test(error.message) || /^Last\.fm API error 29\b/.test(error.message)
}

interface PolicyState {
	policy: RequestPolicy
	/** Date.now() value at which the deadline passes. */
	deadline: number
	/** HTTP attempts charged so far. */
	used: number
	inFlight: number
	/** Sends waiting for a slot, oldest first. Calling one hands it a slot already counted in `inFlight`. */
	waiters: Array<() => void>
}

const currentPolicy = new AsyncLocalStorage<PolicyState>()

/**
 * Runs `fn` with `policy` governing every Last.fm request it makes, including after awaits. The deadline starts now.
 * Concurrent calls each get their own budget, deadline and slots.
 */
export function runWithRequestPolicy<T>(policy: RequestPolicy, fn: () => Promise<T>): Promise<T> {
	const state: PolicyState = { policy, deadline: Date.now() + policy.deadlineMs, used: 0, inFlight: 0, waiters: [] }
	return currentPolicy.run(state, fn)
}

/** Throws if the call has passed its deadline or spent its budget, without charging anything. */
function assertWithinLimits(state: PolicyState): void {
	if (Date.now() >= state.deadline) throw new RequestBudgetExceeded('deadline')
	if (state.used >= state.policy.maxRequests) throw new RequestBudgetExceeded('budget')
}

async function acquireSlot(state: PolicyState): Promise<void> {
	if (state.inFlight < state.policy.maxConcurrent) {
		state.inFlight++
		return
	}
	await new Promise<void>((resolve) => state.waiters.push(resolve))
}

function releaseSlot(state: PolicyState): void {
	const next = state.waiters.shift()
	if (next) next()
	else state.inFlight--
}

/**
 * Sends one Last.fm request under the current policy; for LastfmClient only. Outside a policy it calls `send({})`, so the
 * client's own retry options apply unchanged. Inside one it waits for a concurrency slot, refuses with
 * RequestBudgetExceeded once the budget or deadline is spent, and hands `send` retry overrides whose `onAttempt` charges
 * every attempt, retries included, against the budget.
 */
export async function withPolicy<T>(send: (retry: Partial<RetryOptions>) => Promise<T>): Promise<T> {
	const state = currentPolicy.getStore()
	if (!state) return send({})

	assertWithinLimits(state)
	await acquireSlot(state)
	try {
		// A send that waited for its slot may wake after the deadline
		assertWithinLimits(state)
		return await send({
			maxRetries: state.policy.maxRetries,
			maxDelayMs: state.policy.maxRetryDelayMs,
			onAttempt: () => {
				assertWithinLimits(state)
				state.used++
			},
		})
	} finally {
		releaseSlot(state)
	}
}
