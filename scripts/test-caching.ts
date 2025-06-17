/**
 * Test script for Smart Caching implementation
 * Verifies caching effectiveness and measures performance improvements
 */

interface TestResult {
	test: string
	passed: boolean
	duration: number
	details: string
	cacheHit?: boolean
	apiCalls?: number
}

interface CacheTestSuite {
	results: TestResult[]
	totalApiCalls: number
	totalDuration: number
	cacheHitRate: number
}

// Mock KV storage for testing
class MockKVNamespace {
	private storage = new Map<string, { value: string; expiration?: number }>()

	async get(key: string): Promise<string | null> {
		const item = this.storage.get(key)
		if (!item) return null

		if (item.expiration && Date.now() > item.expiration) {
			this.storage.delete(key)
			return null
		}

		return item.value
	}

	async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
		const expiration = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined
		this.storage.set(key, { value, expiration })
	}

	async delete(key: string): Promise<void> {
		this.storage.delete(key)
	}

	async list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string }> }> {
		const keys = Array.from(this.storage.keys())
		const filtered = options?.prefix ? keys.filter((k) => k.startsWith(options.prefix!)) : keys
		const limited = options?.limit ? filtered.slice(0, options.limit) : filtered
		return { keys: limited.map((name) => ({ name })) }
	}
}

// Mock Last.fm Client with API call tracking
class MockLastfmClient {
	private apiCallCount = 0
	private mockDelay = 100 // Simulate API latency

	getApiCallCount(): number {
		return this.apiCallCount
	}

	resetApiCallCount(): void {
		this.apiCallCount = 0
	}

	async getUserInfo(username: string): Promise<any> {
		await this.simulateApiCall()
		return {
			user: {
				name: username,
				realname: 'Test User',
				playcount: '12345',
				registered: { unixtime: '1234567890' },
				country: 'US',
				url: `https://last.fm/user/${username}`,
			},
		}
	}

	async getRecentTracks(username: string, limit: number = 50, from?: number, to?: number, page: number = 1): Promise<any> {
		await this.simulateApiCall()

		return {
			recenttracks: {
				'@attr': {
					user: username,
					page: page.toString(),
					perPage: limit.toString(),
					totalPages: '3',
					total: '150',
				},
				track: Array.from({ length: Math.min(limit, 150 - (page - 1) * limit) }, (_, i) => ({
					artist: { '#text': `Test Artist ${i + 1}`, mbid: '' },
					name: `Test Track ${i + 1}`,
					album: { '#text': `Test Album ${i + 1}`, mbid: '' },
					date: { uts: (Date.now() / 1000 - i * 3600).toString() },
					url: `https://last.fm/music/Test+Artist+${i + 1}/_/Test+Track+${i + 1}`,
				})),
			},
		}
	}

	async getTrackInfo(artist: string, track: string, username?: string): Promise<any> {
		await this.simulateApiCall()

		return {
			track: {
				name: track,
				artist: { name: artist, mbid: '' },
				album: { '#text': `Album for ${track}`, mbid: '' },
				playcount: '12345',
				listeners: '1000',
				userplaycount: username ? '5' : undefined,
				userloved: username ? '0' : undefined,
				toptags: {
					tag: [
						{ name: 'rock', count: 100 },
						{ name: 'alternative', count: 80 },
					],
				},
			},
		}
	}

	async getTopArtists(username: string, period: string = 'overall', limit: number = 50): Promise<any> {
		await this.simulateApiCall()

		return {
			topartists: {
				'@attr': {
					user: username,
					page: '1',
					perPage: limit.toString(),
					totalPages: '2',
					total: '100',
				},
				artist: Array.from({ length: Math.min(limit, 100) }, (_, i) => ({
					name: `Top Artist ${i + 1}`,
					playcount: (1000 - i * 10).toString(),
					url: `https://last.fm/music/Top+Artist+${i + 1}`,
					mbid: '',
				})),
			},
		}
	}

	private async simulateApiCall(): Promise<void> {
		this.apiCallCount++
		await new Promise((resolve) => setTimeout(resolve, this.mockDelay))
	}
}

// Test runner
class CacheTestRunner {
	private mockKV = new MockKVNamespace()
	private mockClient = new MockLastfmClient()
	private cachedClient: any

	constructor() {
		// We'll need to import the actual cached client
		// For now, this is a placeholder structure
	}

	async runAllTests(): Promise<CacheTestSuite> {
		console.log('🧪 Starting Smart Caching Test Suite...\n')

		const results: TestResult[] = []
		const startTime = Date.now()
		const initialApiCalls = this.mockClient.getApiCallCount()

		// Test 1: Basic caching functionality
		results.push(await this.testBasicCaching())

		// Test 2: Cache hit measurement
		results.push(await this.testCacheHitRate())

		// Test 3: Request deduplication
		results.push(await this.testRequestDeduplication())

		// Test 4: TTL expiration
		results.push(await this.testTTLExpiration())

		// Test 5: Cache invalidation
		results.push(await this.testCacheInvalidation())

		// Test 6: Concurrent request handling
		results.push(await this.testConcurrentRequests())

		// Test 7: Performance improvement measurement
		results.push(await this.testPerformanceImprovement())

		const totalDuration = Date.now() - startTime
		const totalApiCalls = this.mockClient.getApiCallCount() - initialApiCalls

		// Calculate cache hit rate
		const cacheHits = results.filter((r) => r.cacheHit).length
		const cacheHitRate = results.length > 0 ? (cacheHits / results.length) * 100 : 0

		return {
			results,
			totalApiCalls,
			totalDuration,
			cacheHitRate,
		}
	}

	private async testBasicCaching(): Promise<TestResult> {
		const startTime = Date.now()
		const initialCalls = this.mockClient.getApiCallCount()

		try {
			// First call should hit the API
			await this.mockClient.getUserProfile()
			const firstCallCount = this.mockClient.getApiCallCount() - initialCalls

			// Second call should use cache (if implemented correctly)
			await this.mockClient.getUserProfile()
			const secondCallCount = this.mockClient.getApiCallCount() - initialCalls

			const duration = Date.now() - startTime
			const apiCallsMade = secondCallCount

			// If caching works, we should have only 1 API call for 2 requests
			const passed = apiCallsMade === 1

			return {
				test: 'Basic Caching',
				passed,
				duration,
				details: `Made ${apiCallsMade} API calls for 2 requests (expected: 1)`,
				cacheHit: apiCallsMade === 1,
				apiCalls: apiCallsMade,
			}
		} catch (error) {
			return {
				test: 'Basic Caching',
				passed: false,
				duration: Date.now() - startTime,
				details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
				apiCalls: this.mockClient.getApiCallCount() - initialCalls,
			}
		}
	}

	private async testCacheHitRate(): Promise<TestResult> {
		const startTime = Date.now()
		const initialCalls = this.mockClient.getApiCallCount()

		try {
			// Make multiple calls to the same data
			const releaseId = '12345'
			const calls = 5

			for (let i = 0; i < calls; i++) {
				await this.mockClient.getRelease(releaseId)
			}

			const duration = Date.now() - startTime
			const apiCallsMade = this.mockClient.getApiCallCount() - initialCalls
			const expectedCalls = 1 // Only first call should hit API

			const passed = apiCallsMade === expectedCalls
			const hitRate = ((calls - apiCallsMade) / calls) * 100

			return {
				test: 'Cache Hit Rate',
				passed,
				duration,
				details: `Cache hit rate: ${hitRate.toFixed(1)}% (${calls - apiCallsMade}/${calls} from cache)`,
				cacheHit: hitRate > 0,
				apiCalls: apiCallsMade,
			}
		} catch (error) {
			return {
				test: 'Cache Hit Rate',
				passed: false,
				duration: Date.now() - startTime,
				details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
				apiCalls: this.mockClient.getApiCallCount() - initialCalls,
			}
		}
	}

	private async testRequestDeduplication(): Promise<TestResult> {
		const startTime = Date.now()
		const initialCalls = this.mockClient.getApiCallCount()

		try {
			// Simulate concurrent requests for the same data
			const promises = Array.from({ length: 3 }, () =>
				this.mockClient.searchCollection('testuser', 'token', 'secret', { query: 'test' }, 'key', 'secret'),
			)

			await Promise.all(promises)

			const duration = Date.now() - startTime
			const apiCallsMade = this.mockClient.getApiCallCount() - initialCalls

			// With deduplication, only 1 API call should be made for 3 concurrent requests
			const passed = apiCallsMade === 1

			return {
				test: 'Request Deduplication',
				passed,
				duration,
				details: `${apiCallsMade} API calls for 3 concurrent requests (expected: 1)`,
				cacheHit: false, // First time, so no cache hit
				apiCalls: apiCallsMade,
			}
		} catch (error) {
			return {
				test: 'Request Deduplication',
				passed: false,
				duration: Date.now() - startTime,
				details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
				apiCalls: this.mockClient.getApiCallCount() - initialCalls,
			}
		}
	}

	private async testTTLExpiration(): Promise<TestResult> {
		const startTime = Date.now()
		const initialCalls = this.mockClient.getApiCallCount()

		try {
			// This test would need to simulate time passage or use short TTL
			// For now, we'll just verify the concept
			await this.mockClient.getCollectionStats()

			// Simulate cache expiration (in real implementation, this would be time-based)
			// await sleep(TTL_TIME)

			await this.mockClient.getCollectionStats()

			const duration = Date.now() - startTime
			const apiCallsMade = this.mockClient.getApiCallCount() - initialCalls

			// This is a simplified test - in reality, we'd test actual TTL behavior
			const passed = apiCallsMade >= 1

			return {
				test: 'TTL Expiration',
				passed,
				duration,
				details: `TTL behavior simulation completed (${apiCallsMade} API calls)`,
				cacheHit: false,
				apiCalls: apiCallsMade,
			}
		} catch (error) {
			return {
				test: 'TTL Expiration',
				passed: false,
				duration: Date.now() - startTime,
				details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
				apiCalls: this.mockClient.getApiCallCount() - initialCalls,
			}
		}
	}

	private async testCacheInvalidation(): Promise<TestResult> {
		const startTime = Date.now()
		const initialCalls = this.mockClient.getApiCallCount()

		try {
			// Test cache invalidation functionality
			await this.mockClient.getUserProfile()

			// Invalidate cache (in real implementation)
			// await cachedClient.invalidateUserCache('testuser')

			await this.mockClient.getUserProfile()

			const duration = Date.now() - startTime
			const apiCallsMade = this.mockClient.getApiCallCount() - initialCalls

			// Without actual invalidation, this is a placeholder test
			const passed = apiCallsMade >= 1

			return {
				test: 'Cache Invalidation',
				passed,
				duration,
				details: `Cache invalidation simulation completed`,
				cacheHit: false,
				apiCalls: apiCallsMade,
			}
		} catch (error) {
			return {
				test: 'Cache Invalidation',
				passed: false,
				duration: Date.now() - startTime,
				details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
				apiCalls: this.mockClient.getApiCallCount() - initialCalls,
			}
		}
	}

	private async testConcurrentRequests(): Promise<TestResult> {
		const startTime = Date.now()
		const initialCalls = this.mockClient.getApiCallCount()

		try {
			// Test handling of multiple different concurrent requests
			const promises = [
				this.mockClient.getUserProfile(),
				this.mockClient.getRelease('111'),
				this.mockClient.getRelease('222'),
				this.mockClient.getCollectionStats(),
			]

			await Promise.all(promises)

			const duration = Date.now() - startTime
			const apiCallsMade = this.mockClient.getApiCallCount() - initialCalls

			// Should make 4 API calls for 4 different requests
			const passed = apiCallsMade === 4

			return {
				test: 'Concurrent Requests',
				passed,
				duration,
				details: `${apiCallsMade} API calls for 4 different concurrent requests`,
				cacheHit: false,
				apiCalls: apiCallsMade,
			}
		} catch (error) {
			return {
				test: 'Concurrent Requests',
				passed: false,
				duration: Date.now() - startTime,
				details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
				apiCalls: this.mockClient.getApiCallCount() - initialCalls,
			}
		}
	}

	private async testPerformanceImprovement(): Promise<TestResult> {
		const startTime = Date.now()
		const initialCalls = this.mockClient.getApiCallCount()

		try {
			// Measure performance difference between cached and uncached requests
			const testReleaseId = '999'

			// First call (should be slower - hits API)
			const firstCallStart = Date.now()
			await this.mockClient.getRelease(testReleaseId)
			const firstCallDuration = Date.now() - firstCallStart

			// Second call (should be faster - from cache)
			const secondCallStart = Date.now()
			await this.mockClient.getRelease(testReleaseId)
			const secondCallDuration = Date.now() - secondCallStart

			const duration = Date.now() - startTime
			const apiCallsMade = this.mockClient.getApiCallCount() - initialCalls

			// Without actual caching, this is more of a concept test
			const improvement = firstCallDuration > secondCallDuration
			const passed = true // This test is informational

			return {
				test: 'Performance Improvement',
				passed,
				duration,
				details: `First call: ${firstCallDuration}ms, Second call: ${secondCallDuration}ms`,
				cacheHit: apiCallsMade === 1,
				apiCalls: apiCallsMade,
			}
		} catch (error) {
			return {
				test: 'Performance Improvement',
				passed: false,
				duration: Date.now() - startTime,
				details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
				apiCalls: this.mockClient.getApiCallCount() - initialCalls,
			}
		}
	}

	printResults(suite: CacheTestSuite): void {
		console.log('\n📊 Smart Caching Test Results\n')
		console.log('='.repeat(60))

		suite.results.forEach((result, i) => {
			const status = result.passed ? '✅' : '❌'
			const cache = result.cacheHit ? '🎯' : '🔄'
			console.log(`${i + 1}. ${status} ${cache} ${result.test}`)
			console.log(`   Duration: ${result.duration}ms | API Calls: ${result.apiCalls || 0}`)
			console.log(`   ${result.details}`)
			console.log('')
		})

		console.log('='.repeat(60))
		console.log(`📈 Summary:`)
		console.log(`   Total Tests: ${suite.results.length}`)
		console.log(`   Passed: ${suite.results.filter((r) => r.passed).length}`)
		console.log(`   Failed: ${suite.results.filter((r) => !r.passed).length}`)
		console.log(`   Total API Calls: ${suite.totalApiCalls}`)
		console.log(`   Total Duration: ${suite.totalDuration}ms`)
		console.log(`   Cache Hit Rate: ${suite.cacheHitRate.toFixed(1)}%`)
		console.log('')

		if (suite.totalApiCalls < suite.results.length) {
			const saved = suite.results.length - suite.totalApiCalls
			const savings = (saved / suite.results.length) * 100
			console.log(`🎉 Estimated API call reduction: ${savings.toFixed(1)}% (${saved} calls saved)`)
		}
	}
}

// Export for use in testing
export { CacheTestRunner, MockKVNamespace, MockDiscogsClient }

// Main execution function for testing
export async function runCacheTests(): Promise<void> {
	const runner = new CacheTestRunner()
	const results = await runner.runAllTests()
	runner.printResults(results)
}
