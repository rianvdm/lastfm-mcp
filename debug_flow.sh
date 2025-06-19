#!/bin/bash

DEV_URL="https://lastfm-mcp.rian-db8.workers.dev"

echo "🔍 Manual OAuth Flow Debug"
echo ""

# Step 1: Register client
echo "1. Registering OAuth client..."
CLIENT_DATA=$(curl -s -X POST "$DEV_URL/oauth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Debug Test Client",
    "redirect_uris": ["https://claude.ai/oauth/callback"],
    "scope": "read:listening_history read:profile"
  }')

CLIENT_ID=$(echo "$CLIENT_DATA" | jq -r '.client_id')
echo "✅ Client registered: $CLIENT_ID"
echo ""

# Step 2: Get authorization URL
echo "2. Building authorization URL..."
AUTH_URL="$DEV_URL/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=https://claude.ai/oauth/callback&response_type=code&scope=read:listening_history&state=debug123"

echo "🌐 Visit this URL in your browser to start the flow:"
echo "$AUTH_URL"
echo ""

echo "3. Click 'Authorize' on the consent page"
echo "4. This should redirect you to Last.fm login"
echo "5. After Last.fm login, you should be redirected back to Claude with a code parameter"
echo ""

echo "🔗 Expected flow:"
echo "1. Browser → Consent Page (our server)"
echo "2. User clicks 'Authorize'"  
echo "3. Browser → Last.fm auth (last.fm)"
echo "4. User logs into Last.fm"
echo "5. Last.fm → Our callback (our server)"
echo "6. Our server → Claude callback with authorization code"
echo ""

echo "❓ Questions to check:"
echo "- Does the consent page load correctly?"
echo "- Does clicking 'Authorize' redirect to Last.fm?"
echo "- Does Last.fm redirect back to our callback with a token?"
echo "- Does our callback generate and return an authorization code?"
echo ""

echo "📊 You can check logs in Cloudflare Workers dashboard or wrangler tail"