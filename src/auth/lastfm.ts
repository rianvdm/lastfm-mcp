/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="webworker" />

import { fetchWithRetry, RetryOptions } from '../utils/retry'

interface LastfmSessionResponse {
	session: {
		name: string
		key: string
		subscriber: number
	}
}

interface LastfmError {
	error: number
	message: string
}

// Generate MD5 hash using Web Crypto API
async function md5(message: string): Promise<string> {
	const msgBuffer = new TextEncoder().encode(message)
	const hashBuffer = await crypto.subtle.digest('MD5', msgBuffer)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class LastfmAuth {
	private apiKey: string
	private sharedSecret: string
	private baseUrl = 'https://ws.audioscrobbler.com/2.0/'
	private authUrl = 'https://www.last.fm/api/auth/'
	private lastRequestTime = 0

	// Last.fm specific retry configuration
	private readonly lastfmRetryOptions: RetryOptions = {
		maxRetries: 3,
		initialDelayMs: 1000,
		maxDelayMs: 15000,
		backoffMultiplier: 2,
		jitterFactor: 0.1,
	}

	// Minimum delay between requests to respect rate limits (~5 req/sec)
	private readonly REQUEST_DELAY_MS = 250 // 250ms to stay under 5 req/sec

	/**
	 * Add delay between requests to respect Last.fm rate limits
	 */
	private async throttleRequest(): Promise<void> {
		const timeSinceLastRequest = Date.now() - this.lastRequestTime
		if (timeSinceLastRequest < this.REQUEST_DELAY_MS) {
			const delayNeeded = this.REQUEST_DELAY_MS - timeSinceLastRequest
			await new Promise((resolve) => setTimeout(resolve, delayNeeded))
		}
		this.lastRequestTime = Date.now()
	}

	constructor(apiKey: string, sharedSecret: string) {
		this.apiKey = apiKey
		this.sharedSecret = sharedSecret
	}

	/**
	 * Generate method signature for Last.fm API requests
	 * @param params Parameters to sign (excluding api_sig)
	 * @returns MD5 signature
	 */
	async generateMethodSignature(params: Record<string, string>): Promise<string> {
		// Sort parameters by key
		const sortedKeys = Object.keys(params).sort()

		// Create signature string
		let signatureString = ''
		for (const key of sortedKeys) {
			signatureString += key + params[key]
		}
		signatureString += this.sharedSecret

		return await md5(signatureString)
	}

	/**
	 * Get the authorization URL for Last.fm web authentication
	 * @param callbackUrl The URL to redirect to after authorization
	 * @returns Authorization URL
	 */
	getAuthUrl(callbackUrl?: string): string {
		const params = new URLSearchParams({
			api_key: this.apiKey,
		})

		if (callbackUrl) {
			params.set('cb', callbackUrl)
		}

		return `${this.authUrl}?${params.toString()}`
	}

	/**
	 * Exchange authorization token for session key
	 * @param token Authorization token from callback
	 * @returns Session key and username
	 */
	async getSessionKey(token: string): Promise<{ sessionKey: string; username: string }> {
		const params = {
			method: 'auth.getSession',
			api_key: this.apiKey,
			token: token,
		}

		// Generate signature
		const signature = await this.generateMethodSignature(params)

		// Create form data
		const formData = new URLSearchParams({
			...params,
			api_sig: signature,
			format: 'json',
		})

		try {
			await this.throttleRequest()
			const response = await fetchWithRetry(
				this.baseUrl,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						'User-Agent': 'lastfm-mcp/1.0.0',
					},
					body: formData,
				},
				this.lastfmRetryOptions,
			)

			const data = (await response.json()) as LastfmSessionResponse | LastfmError

			if ('error' in data) {
				throw new Error(`Last.fm API error ${data.error}: ${data.message}`)
			}

			return {
				sessionKey: data.session.key,
				username: data.session.name,
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes('429')) {
				throw new Error('Last.fm API rate limit exceeded during authentication. Please try again later.')
			}
			console.error('Last.fm API error:', error)
			throw new Error(`Failed to get session key: ${error instanceof Error ? error.message : 'Unknown error'}`)
		}
	}

	/**
	 * Create signed parameters for authenticated Last.fm API requests
	 * @param method Last.fm API method
	 * @param sessionKey User session key
	 * @param additionalParams Additional parameters
	 * @returns Signed parameters
	 */
	async createSignedParams(
		method: string,
		sessionKey: string,
		additionalParams: Record<string, string> = {},
	): Promise<Record<string, string>> {
		const params = {
			method,
			api_key: this.apiKey,
			sk: sessionKey,
			...additionalParams,
		}

		const signature = await this.generateMethodSignature(params)

		return {
			...params,
			api_sig: signature,
			format: 'json',
		}
	}

	/**
	 * Validate a session key by making a test API call
	 * @param sessionKey Session key to validate
	 * @returns True if valid, false otherwise
	 */
	async validateSessionKey(sessionKey: string): Promise<boolean> {
		try {
			const params = await this.createSignedParams('user.getInfo', sessionKey)
			const formData = new URLSearchParams(params)

			await this.throttleRequest()
			const response = await fetchWithRetry(
				this.baseUrl,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						'User-Agent': 'lastfm-mcp/1.0.0',
					},
					body: formData,
				},
				this.lastfmRetryOptions,
			)

			const data = await response.json()
			return !('error' in data)
		} catch (error) {
			console.error('Session validation error:', error)
			return false
		}
	}
}
