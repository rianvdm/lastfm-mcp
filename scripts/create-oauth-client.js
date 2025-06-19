#!/usr/bin/env node

/**
 * Script to create an OAuth client for testing Claude integration
 * Usage: node scripts/create-oauth-client.js [environment]
 */

import { createClaudeClient } from '../src/auth/oauth.js'

const environment = process.argv[2] || 'dev'
const baseUrl = environment === 'prod' 
  ? 'https://lastfm-mcp-prod.rian-db8.workers.dev'
  : 'http://localhost:8787'

console.log(`Creating OAuth client for ${environment} environment...`)
console.log(`Base URL: ${baseUrl}`)

// Mock environment for the oauth utilities
const mockEnv = {
  OAUTH_CLIENTS: {
    async put(key, value) {
      console.log(`\n📝 Would store OAuth client:`)
      console.log(`Key: ${key}`)
      console.log(`Value: ${JSON.stringify(JSON.parse(value), null, 2)}`)
      return null
    }
  }
}

try {
  const client = await createClaudeClient(mockEnv)
  
  console.log(`\n✅ OAuth Client Created Successfully!`)
  console.log(`\n🔑 Client Credentials:`)
  console.log(`Client ID: ${client.id}`)
  console.log(`Client Secret: ${client.secret}`)
  console.log(`\n🔗 Authorized Redirect URIs:`)
  client.redirectUris.forEach(uri => console.log(`  - ${uri}`))
  console.log(`\n📋 Allowed Scopes:`)
  client.allowedScopes.forEach(scope => console.log(`  - ${scope}`))
  
  console.log(`\n🚀 Next Steps:`)
  console.log(`1. Deploy to ${environment}: npm run deploy${environment === 'prod' ? ':prod' : ''}`)
  console.log(`2. Manually register this client in the KV store`)
  console.log(`3. Test OAuth flow at: ${baseUrl}/oauth/authorize?client_id=${client.id}&redirect_uri=https://claude.ai/oauth/callback&response_type=code&scope=read:listening-history`)
  
} catch (error) {
  console.error('❌ Error creating OAuth client:', error)
  process.exit(1)
}