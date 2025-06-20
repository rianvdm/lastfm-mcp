#!/usr/bin/env node

/**
 * Real Last.fm Integration Test
 * Tests actual Last.fm API calls with real credentials
 */

const serverUrl = process.env.SERVER_URL || 'http://localhost:8787'

/**
 * Test Last.fm tools with real bearer token
 */
async function testLastfmTools(accessToken) {
	console.log('🎵 Testing Last.fm MCP Tools...')

	const tests = [
		{
			name: 'get_recent_tracks',
			params: { limit: 5 },
			description: 'Get user\'s recent listening history'
		},
		{
			name: 'get_user_info', 
			params: {},
			description: 'Get authenticated user information'
		},
		{
			name: 'get_top_artists',
			params: { period: 'overall', limit: 5 },
			description: 'Get user\'s top artists'
		},
		{
			name: 'get_top_tracks',
			params: { period: '7day', limit: 3 },
			description: 'Get user\'s top tracks from last week'
		},
		{
			name: 'get_loved_tracks',
			params: { limit: 3 },
			description: 'Get user\'s loved tracks'
		}
	]

	const results = []

	for (const test of tests) {
		console.log(`\n  Testing ${test.name}: ${test.description}`)
		
		const mcpRequest = {
			jsonrpc: '2.0',
			id: Math.floor(Math.random() * 1000),
			method: 'tools/call',
			params: {
				name: test.name,
				arguments: test.params
			}
		}

		try {
			const response = await fetch(serverUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${accessToken}`,
				},
				body: JSON.stringify(mcpRequest),
			})

			if (!response.ok) {
				console.log(`    ❌ HTTP ${response.status}`)
				results.push({ name: test.name, success: false, error: `HTTP ${response.status}` })
				continue
			}

			const result = await response.json()
			
			if (result.result && result.result.content) {
				const content = result.result.content[0].text
				console.log(`    ✅ Success - ${content.split('\n')[0]}`)
				results.push({ name: test.name, success: true })
			} else if (result.error) {
				console.log(`    ❌ MCP Error: ${result.error.message}`)
				results.push({ name: test.name, success: false, error: result.error.message })
			} else {
				console.log(`    ❌ Unexpected response format`)
				results.push({ name: test.name, success: false, error: 'Unexpected response' })
			}

		} catch (error) {
			console.log(`    ❌ Request failed: ${error.message}`)
			results.push({ name: test.name, success: false, error: error.message })
		}

		// Add delay between requests to respect rate limits
		await new Promise(resolve => setTimeout(resolve, 500))
	}

	return results
}

/**
 * Test public Last.fm tools (no auth required)
 */
async function testPublicTools() {
	console.log('🌐 Testing Public Last.fm Tools...')

	const tests = [
		{
			name: 'search_artists',
			params: { query: 'Radiohead', limit: 3 },
			description: 'Search for artists'
		},
		{
			name: 'search_tracks',
			params: { query: 'Paranoid Android', limit: 2 },
			description: 'Search for tracks'
		},
		{
			name: 'get_artist_info',
			params: { artist: 'Radiohead' },
			description: 'Get artist information'
		},
		{
			name: 'get_track_info',
			params: { artist: 'Radiohead', track: 'Creep' },
			description: 'Get track information'
		}
	]

	const results = []

	for (const test of tests) {
		console.log(`\n  Testing ${test.name}: ${test.description}`)
		
		const mcpRequest = {
			jsonrpc: '2.0',
			id: Math.floor(Math.random() * 1000),
			method: 'tools/call',
			params: {
				name: test.name,
				arguments: test.params
			}
		}

		try {
			// Test without authorization first
			const response = await fetch(serverUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(mcpRequest),
			})

			if (!response.ok) {
				console.log(`    ❌ HTTP ${response.status}`)
				results.push({ name: test.name, success: false, error: `HTTP ${response.status}` })
				continue
			}

			const result = await response.json()
			
			if (result.result && result.result.content) {
				const content = result.result.content[0].text
				console.log(`    ✅ Success - ${content.split('\n')[0]}`)
				results.push({ name: test.name, success: true })
			} else if (result.error) {
				console.log(`    ❌ MCP Error: ${result.error.message}`)
				results.push({ name: test.name, success: false, error: result.error.message })
			} else {
				console.log(`    ❌ Unexpected response format`)
				results.push({ name: test.name, success: false, error: 'Unexpected response' })
			}

		} catch (error) {
			console.log(`    ❌ Request failed: ${error.message}`)
			results.push({ name: test.name, success: false, error: error.message })
		}

		// Add delay between requests
		await new Promise(resolve => setTimeout(resolve, 500))
	}

	return results
}

/**
 * Test rate limiting behavior
 */
async function testRateLimiting(accessToken) {
	console.log('⏱️  Testing Rate Limiting...')

	const requests = []
	
	// Send 10 rapid requests
	for (let i = 0; i < 10; i++) {
		const mcpRequest = {
			jsonrpc: '2.0',
			id: i,
			method: 'tools/call',
			params: {
				name: 'ping',
				arguments: { message: `Test ${i}` }
			}
		}

		const promise = fetch(serverUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${accessToken}`,
			},
			body: JSON.stringify(mcpRequest),
		})

		requests.push(promise)
	}

	try {
		const responses = await Promise.all(requests)
		const statuses = responses.map(r => r.status)
		
		const successful = statuses.filter(s => s === 200).length
		const rateLimited = statuses.filter(s => s === 429).length
		
		console.log(`  ✅ Sent 10 rapid requests`)
		console.log(`  📊 Results: ${successful} successful, ${rateLimited} rate limited`)
		
		if (rateLimited > 0) {
			console.log(`  ✅ Rate limiting is working`)
		} else {
			console.log(`  ⚠️  No rate limiting detected (might be ok for development)`)
		}

		return true
	} catch (error) {
		console.log(`  ❌ Rate limiting test failed: ${error.message}`)
		return false
	}
}

/**
 * Main test runner
 */
async function runRealWorldTests() {
	console.log('🌍 Starting Real-World Last.fm Integration Tests\n')
	console.log(`Server URL: ${serverUrl}\n`)

	const accessToken = process.env.ACCESS_TOKEN

	if (!accessToken) {
		console.log('⚠️  No ACCESS_TOKEN provided. Testing public endpoints only.\n')
		console.log('To test authenticated endpoints:')
		console.log('1. Run the OAuth flow test first: node scripts/test-oauth-flow.js')
		console.log('2. Get an access token from the OAuth flow')
		console.log('3. Run: ACCESS_TOKEN=<token> node scripts/test-real-lastfm.js\n')
	}

	try {
		// Test 1: Public tools
		console.log('='.repeat(50))
		const publicResults = await testPublicTools()
		console.log()

		// Test 2: Authenticated tools (if token provided)
		let authResults = []
		if (accessToken) {
			console.log('='.repeat(50))
			authResults = await testLastfmTools(accessToken)
			console.log()

			// Test 3: Rate limiting
			console.log('='.repeat(50))
			await testRateLimiting(accessToken)
			console.log()
		}

		// Summary
		console.log('='.repeat(50))
		console.log('📊 Test Results Summary:')
		console.log('========================')

		const publicPassed = publicResults.filter(r => r.success).length
		console.log(`🌐 Public tools: ${publicPassed}/${publicResults.length} passed`)

		if (authResults.length > 0) {
			const authPassed = authResults.filter(r => r.success).length
			console.log(`🔐 Authenticated tools: ${authPassed}/${authResults.length} passed`)
		}

		// Show failures
		const allResults = [...publicResults, ...authResults]
		const failures = allResults.filter(r => !r.success)
		
		if (failures.length > 0) {
			console.log('\n❌ Failed tests:')
			failures.forEach(f => {
				console.log(`   ${f.name}: ${f.error}`)
			})
		} else {
			console.log('\n🎉 All tests passed!')
		}

		// Real-world readiness assessment
		console.log('\n🚀 Deployment Readiness:')
		const totalTests = allResults.length
		const totalPassed = allResults.filter(r => r.success).length
		const successRate = totalPassed / totalTests

		if (successRate >= 0.9) {
			console.log('✅ READY - High success rate, good for production')
		} else if (successRate >= 0.7) {
			console.log('⚠️  CAUTION - Some issues detected, review failures')
		} else {
			console.log('❌ NOT READY - Multiple failures, needs investigation')
		}

		console.log(`   Success rate: ${Math.round(successRate * 100)}% (${totalPassed}/${totalTests})`)

	} catch (error) {
		console.error('❌ Real-world test failed:', error.message)
		process.exit(1)
	}
}

// Run tests
runRealWorldTests()