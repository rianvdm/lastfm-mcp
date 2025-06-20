#!/usr/bin/env node

/**
 * OAuth Flow Testing Script
 * Tests the complete OAuth 2.1 flow with real Claude Desktop integration
 */

const serverUrl = process.env.SERVER_URL || 'http://localhost:8787'

/**
 * Test OAuth Dynamic Client Registration
 */
async function testClientRegistration() {
	console.log('🔐 Testing OAuth Dynamic Client Registration...')

	const response = await fetch(`${serverUrl}/oauth/register`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			client_name: 'Test Claude Desktop',
			client_uri: 'https://claude.ai',
			redirect_uris: ['http://localhost:3000/callback'],
			grant_types: ['authorization_code'],
			response_types: ['code'],
			scope: 'mcp.read mcp.write lastfm.connect offline_access',
		}),
	})

	if (!response.ok) {
		console.log('❌ Client registration failed:', response.status, await response.text())
		return null
	}

	const client = await response.json()
	console.log('✅ Client registered successfully')
	console.log(`   Client ID: ${client.client_id}`)
	console.log(`   Client Secret: ${client.client_secret ? '[HIDDEN]' : 'Not provided'}`)
	
	return client
}

/**
 * Test OAuth Authorization URL Generation
 */
function testAuthorizationUrl(client) {
	console.log('🔗 Testing Authorization URL Generation...')

	const authParams = new URLSearchParams({
		response_type: 'code',
		client_id: client.client_id,
		redirect_uri: 'http://localhost:3000/callback',
		scope: 'mcp.read lastfm.connect',
		state: 'test-state-' + Date.now(),
		code_challenge: 'test-challenge',
		code_challenge_method: 'S256',
	})

	const authUrl = `${serverUrl}/oauth/authorize?${authParams}`
	console.log('✅ Authorization URL generated:')
	console.log(`   ${authUrl}`)
	console.log('   👆 Open this URL in your browser to test the authorization flow')
	
	return { authUrl, state: authParams.get('state') }
}

/**
 * Test MCP endpoint with bearer token
 */
async function testMCPWithBearer(accessToken) {
	console.log('🎵 Testing MCP calls with Bearer token...')

	const mcpRequest = {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/list',
		params: {},
	}

	const response = await fetch(serverUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${accessToken}`,
		},
		body: JSON.stringify(mcpRequest),
	})

	if (!response.ok) {
		console.log('❌ MCP request failed:', response.status, await response.text())
		return false
	}

	const result = await response.json()
	
	if (result.result && result.result.tools) {
		console.log('✅ MCP tools/list successful')
		console.log(`   Found ${result.result.tools.length} tools`)
		return true
	} else if (result.error) {
		console.log('❌ MCP request returned error:', result.error.message)
		return false
	}

	return false
}

/**
 * Test server health and OAuth endpoints
 */
async function testServerHealth() {
	console.log('🏥 Testing server health...')

	// Test health endpoint
	const healthResponse = await fetch(`${serverUrl}/health`)
	if (!healthResponse.ok) {
		console.log('❌ Health endpoint failed')
		return false
	}

	const health = await healthResponse.json()
	console.log('✅ Health endpoint working')
	console.log(`   OAuth: ${health.oauth}`)

	// Test main endpoint info
	const infoResponse = await fetch(serverUrl)
	if (!infoResponse.ok) {
		console.log('❌ Info endpoint failed')
		return false
	}

	const info = await infoResponse.json()
	console.log('✅ Server info endpoint working')
	console.log(`   OAuth endpoints available: ${!!info.oauth}`)

	return true
}

/**
 * Simulate token exchange (requires manual authorization code)
 */
async function testTokenExchange(client, authorizationCode) {
	console.log('🔄 Testing token exchange...')

	const response = await fetch(`${serverUrl}/oauth/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: client.client_id,
			client_secret: client.client_secret || '',
			code: authorizationCode,
			redirect_uri: 'http://localhost:3000/callback',
			code_verifier: 'test-verifier',
		}),
	})

	if (!response.ok) {
		console.log('❌ Token exchange failed:', response.status, await response.text())
		return null
	}

	const tokens = await response.json()
	console.log('✅ Token exchange successful')
	console.log(`   Access token: ${tokens.access_token ? '[RECEIVED]' : 'Missing'}`)
	console.log(`   Token type: ${tokens.token_type}`)
	console.log(`   Expires in: ${tokens.expires_in} seconds`)

	return tokens
}

/**
 * Manual testing instructions
 */
function showManualTestingInstructions(authUrl) {
	console.log('\n🧪 Manual Testing Instructions:')
	console.log('===============================')
	console.log('1. Open the authorization URL above in your browser')
	console.log('2. Complete the Last.fm authentication flow')
	console.log('3. Approve the OAuth consent')
	console.log('4. Copy the authorization code from the callback URL')
	console.log('5. Run this script again with the code:')
	console.log(`   SERVER_URL=${serverUrl} AUTH_CODE=<code> node scripts/test-oauth-flow.js`)
	console.log('\n📋 What to verify manually:')
	console.log('- Last.fm authentication redirect works')
	console.log('- OAuth consent page displays correctly')
	console.log('- Last.fm session is properly bridged')
	console.log('- Authorization code is returned in callback URL')
}

/**
 * Main test runner
 */
async function runOAuthTests() {
	console.log('🚀 Starting OAuth Flow Tests\n')
	console.log(`Server URL: ${serverUrl}\n`)

	// Get authorization code from environment if provided
	const authCode = process.env.AUTH_CODE

	try {
		// Test 1: Server Health
		const healthOk = await testServerHealth()
		if (!healthOk) {
			console.log('❌ Server health check failed. Is the dev server running?')
			process.exit(1)
		}
		console.log()

		// Test 2: Client Registration
		const client = await testClientRegistration()
		if (!client) {
			console.log('❌ Client registration failed')
			process.exit(1)
		}
		console.log()

		// Test 3: Authorization URL
		const { authUrl } = testAuthorizationUrl(client)
		console.log()

		// Test 4: Token Exchange (if auth code provided)
		if (authCode) {
			console.log('🔑 Authorization code provided, testing token exchange...')
			const tokens = await testTokenExchange(client, authCode)
			if (!tokens) {
				console.log('❌ Token exchange failed')
				process.exit(1)
			}
			console.log()

			// Test 5: MCP with Bearer Token
			const mcpOk = await testMCPWithBearer(tokens.access_token)
			if (!mcpOk) {
				console.log('❌ MCP calls with bearer token failed')
				process.exit(1)
			}

			console.log('\n🎉 All OAuth tests passed!')
			console.log('✅ Full OAuth 2.1 flow is working correctly')
		} else {
			showManualTestingInstructions(authUrl)
		}

	} catch (error) {
		console.error('❌ OAuth test failed:', error.message)
		process.exit(1)
	}
}

// Run tests
runOAuthTests()