/**
 * Retry utility with exponential backoff and jitter
 */

export interface RetryOptions {
	maxRetries?: number
	initialDelayMs?: number
	maxDelayMs?: number
	backoffMultiplier?: number
	jitterFactor?: number
	shouldRetry?: (error: unknown, attempt: number) => boolean
}

export interface RetryResult<T> {
	success: boolean
	data?: T
	error?: Error
	attempts: number
}

/**
 * Default function to determine if an error is retryable
 */
function defaultShouldRetry(error: unknown, _attempt: number): boolean {
	// Retry on rate limit errors (429) or network errors
	if (error instanceof Response) {
		return error.status === 429 || error.status >= 500
	}
	
	// Retry on network errors
	if (error instanceof Error) {
		const message = error.message.toLowerCase()
		return (
			message.includes('network') ||
			message.includes('timeout') ||
			message.includes('fetch failed') ||
			message.includes('429') ||
			message.includes('rate limit')
		)
	}
	
	return false
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
	attempt: number,
	initialDelayMs: number,
	maxDelayMs: number,
	backoffMultiplier: number,
	jitterFactor: number,
	retryAfterMs?: number
): number {
	// If we have a Retry-After value, use it as the base
	if (retryAfterMs) {
		// Add some jitter to avoid thundering herd
		const jitter = Math.random() * jitterFactor * retryAfterMs
		return Math.min(retryAfterMs + jitter, maxDelayMs)
	}
	
	// Otherwise, use exponential backoff
	const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1)
	const jitter = Math.random() * jitterFactor * exponentialDelay
	return Math.min(exponentialDelay + jitter, maxDelayMs)
}

/**
 * Parse Retry-After header (can be seconds or HTTP date)
 */
function parseRetryAfter(retryAfterHeader: string | null): number | undefined {
	if (!retryAfterHeader) return undefined
	
	// Check if it's a number (seconds)
	const seconds = parseInt(retryAfterHeader, 10)
	if (!isNaN(seconds)) {
		return seconds * 1000 // Convert to milliseconds
	}
	
	// Try to parse as HTTP date
	const retryDate = new Date(retryAfterHeader)
	if (!isNaN(retryDate.getTime())) {
		const delayMs = retryDate.getTime() - Date.now()
		return delayMs > 0 ? delayMs : undefined
	}
	
	return undefined
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {}
): Promise<RetryResult<T>> {
	const {
		maxRetries = 3,
		initialDelayMs = 1000,
		maxDelayMs = 30000,
		backoffMultiplier = 2,
		jitterFactor = 0.1,
		shouldRetry = defaultShouldRetry,
	} = options
	
	let lastError: Error | undefined
	
	for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
		try {
			const data = await fn()
			return {
				success: true,
				data,
				attempts: attempt,
			}
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error))
			
			// Check if we should retry
			if (attempt > maxRetries || !shouldRetry(error, attempt)) {
				return {
					success: false,
					error: lastError,
					attempts: attempt,
				}
			}
			
			// Calculate delay
			let retryAfterMs: number | undefined
			
			// If error is a Response object, check for Retry-After header
			if (error instanceof Response) {
				const retryAfterHeader = error.headers.get('Retry-After')
				retryAfterMs = parseRetryAfter(retryAfterHeader)
			}
			
			// If error is a ResponseError, check the response for Retry-After header
			if (error instanceof ResponseError) {
				const retryAfterHeader = error.response.headers.get('Retry-After')
				retryAfterMs = parseRetryAfter(retryAfterHeader)
			}
			
			const delayMs = calculateDelay(
				attempt,
				initialDelayMs,
				maxDelayMs,
				backoffMultiplier,
				jitterFactor,
				retryAfterMs
			)
			
			console.log(`Retry attempt ${attempt}/${maxRetries} after ${delayMs}ms delay`)
			
			// Wait before retrying
			await new Promise(resolve => setTimeout(resolve, delayMs))
		}
	}
	
	return {
		success: false,
		error: lastError || new Error('Max retries exceeded'),
		attempts: maxRetries + 1,
	}
}

/**
 * Custom error class to preserve response information
 */
class ResponseError extends Error {
	constructor(public response: Response) {
		super(`HTTP ${response.status}: ${response.statusText}`)
		this.name = 'ResponseError'
	}
}

/**
 * Wrapper for fetch with automatic retry on rate limits
 */
export async function fetchWithRetry(
	url: string,
	init?: RequestInit,
	retryOptions?: RetryOptions
): Promise<Response> {
	const result = await withRetry(
		async () => {
			const response = await fetch(url, init)
			
			// Throw a ResponseError for non-OK responses
			// This allows us to access the response in retry logic
			if (!response.ok) {
				throw new ResponseError(response)
			}
			
			return response
		},
		{
			...retryOptions,
			shouldRetry: (error, _attempt) => {
				// Check if it's a ResponseError
				if (error instanceof ResponseError) {
					const status = error.response.status
					// Always retry 429 and 5xx errors
					return status === 429 || status >= 500
				}
				
				// Check if it's a raw Response (for backward compatibility)
				if (error instanceof Response) {
					return error.status === 429 || error.status >= 500
				}
				
				// Use custom or default logic for other errors
				const customShouldRetry = retryOptions?.shouldRetry || defaultShouldRetry
				return customShouldRetry(error, _attempt)
			},
		}
	)
	
	if (!result.success) {
		throw result.error
	}
	
	return result.data!
} 