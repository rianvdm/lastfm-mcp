#!/usr/bin/env node

/**
 * Script to register an OAuth client for Claude testing
 * This directly stores a client in the development KV store
 */

// Development environment configuration
const DEV_BASE_URL = 'https://lastfm-mcp.rian-db8.workers.dev'

console.log('🔧 Creating OAuth client for Claude integration testing...')
console.log(`📍 Environment: Development`)
console.log(`🌐 Base URL: ${DEV_BASE_URL}`)

// Create a test OAuth client with Claude-specific configuration
const testClient = {
	id: 'claude-test-client-12345678901234567890123456789012', // 32 chars
	secret: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // 64 chars
	name: 'Claude AI Integration Test Client',
	redirectUris: [
		'https://claude.ai/oauth/callback',
		'https://app.claude.ai/oauth/callback',
		'http://localhost:3000/oauth/callback', // For development testing
		'https://example.com/callback', // Generic test URI
	],
	allowedScopes: ['read:listening-history', 'read:recommendations', 'read:profile', 'read:library'],
	createdAt: Date.now(),
	active: true,
}

console.log(`\n✅ Test OAuth Client Configuration:`)
console.log(`🔑 Client ID: ${testClient.id}`)
console.log(`🔐 Client Secret: ${testClient.secret}`)
console.log(`📛 Name: ${testClient.name}`)
console.log(`\n🔗 Authorized Redirect URIs:`)
testClient.redirectUris.forEach((uri) => console.log(`  - ${uri}`))
console.log(`\n📋 Allowed Scopes:`)
testClient.allowedScopes.forEach((scope) => console.log(`  - ${scope}`))

console.log(`\n🚀 OAuth Flow URLs for Testing:`)
console.log(`\n1️⃣ Authorization URL (initiate OAuth flow):`)
const authUrl = `${DEV_BASE_URL}/oauth/authorize?client_id=${testClient.id}&redirect_uri=https://example.com/callback&response_type=code&scope=read:listening-history&state=test-123`
console.log(`${authUrl}`)

console.log(`\n2️⃣ Token Exchange (after getting auth code):`)
console.log(`POST ${DEV_BASE_URL}/oauth/token`)
console.log(`Content-Type: application/x-www-form-urlencoded`)
console.log(
	`Body: grant_type=authorization_code&code={AUTH_CODE}&client_id=${testClient.id}&client_secret=${testClient.secret}&redirect_uri=https://example.com/callback`,
)

console.log(`\n3️⃣ MCP Request with Bearer Token:`)
console.log(`POST ${DEV_BASE_URL}/`)
console.log(`Authorization: Bearer {ACCESS_TOKEN}`)
console.log(`Content-Type: application/json`)
console.log(`Body: {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"lastfm_auth_status","arguments":{}}}`)

console.log(`\n📝 Manual Registration Required:`)
console.log(`To use this client, you need to manually store it in the OAUTH_CLIENTS KV namespace.`)
console.log(`You can do this via the Cloudflare dashboard or wrangler CLI.`)

console.log(`\n🔧 Wrangler CLI Command:`)
console.log(`wrangler kv:key put --binding=OAUTH_CLIENTS "${testClient.id}" '${JSON.stringify(testClient)}'`)

console.log(`\n✨ Next Steps:`)
console.log(`1. Register the client using the wrangler command above`)
console.log(`2. Test the authorization URL in your browser`)
console.log(`3. Use the returned auth code to exchange for a Bearer token`)
console.log(`4. Test MCP requests with the Bearer token`)

console.log(`\n🎯 Ready for Claude Integration Testing!`)
