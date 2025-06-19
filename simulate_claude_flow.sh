#!/bin/bash

DEV_URL="https://lastfm-mcp.rian-db8.workers.dev"

echo "🔍 Simulating Exact Claude Desktop OAuth Flow"
echo ""

# Step 1: Claude Desktop fetches integration manifest
echo "1. Claude Desktop fetches integration manifest..."
MANIFEST=$(curl -s "$DEV_URL/.well-known/integration-manifest")
AUTH_URL=$(echo "$MANIFEST" | jq -r '.oauth.authorization_url')
TOKEN_URL=$(echo "$MANIFEST" | jq -r '.oauth.token_url')
REGISTER_URL=$(echo "$MANIFEST" | jq -r '.oauth.client_registration_url')

echo "   Discovered endpoints:"
echo "   - Authorization: $AUTH_URL"
echo "   - Token: $TOKEN_URL"
echo "   - Registration: $REGISTER_URL"
echo ""

# Step 2: Claude Desktop registers as OAuth client
echo "2. Claude Desktop registers as OAuth client..."
# Simulating what Claude might actually send
REGISTER_RESPONSE=$(curl -s -X POST "$REGISTER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Claude Desktop",
    "redirect_uris": ["https://claude.ai/oauth/callback"],
    "scope": "read:listening_history read:recommendations read:profile"
  }')

CLIENT_ID=$(echo "$REGISTER_RESPONSE" | jq -r '.client_id')
CLIENT_SECRET=$(echo "$REGISTER_RESPONSE" | jq -r '.client_secret')

if [ -n "$CLIENT_ID" ]; then
    echo "✅ Client registration successful"
    echo "   Client ID: $CLIENT_ID"
    echo "   Registered scopes: $(echo "$REGISTER_RESPONSE" | jq -r '.scope')"
else
    echo "❌ Client registration failed"
    echo "   Response: $REGISTER_RESPONSE"
    exit 1
fi
echo ""

# Step 3: Claude Desktop initiates authorization 
echo "3. Claude Desktop initiates authorization flow..."

# Test different scope combinations that Claude might send
SCOPE_TESTS=(
    "read:listening_history"
    "read:recommendations" 
    "read:profile"
    "read:listening_history read:recommendations"
    "read:listening_history read:recommendations read:profile"
    ""  # No scope parameter
)

for TEST_SCOPE in "${SCOPE_TESTS[@]}"; do
    echo ""
    echo "   Testing scope: '$TEST_SCOPE'"
    
    # Build authorization URL
    AUTH_REQUEST="$AUTH_URL?client_id=$CLIENT_ID&redirect_uri=https://claude.ai/oauth/callback&response_type=code&state=test123"
    if [ -n "$TEST_SCOPE" ]; then
        AUTH_REQUEST="$AUTH_REQUEST&scope=$(echo "$TEST_SCOPE" | sed 's/ /%20/g')"
    fi
    
    echo "   URL: $AUTH_REQUEST"
    
    # Test authorization request
    AUTH_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" "$AUTH_REQUEST")
    HTTP_CODE=$(echo "$AUTH_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
    CONTENT=$(echo "$AUTH_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')
    
    if [ "$HTTP_CODE" = "200" ]; then
        if echo "$CONTENT" | grep -q "<!DOCTYPE html>"; then
            echo "   ✅ Authorization shows consent page (HTTP $HTTP_CODE)"
        else
            echo "   ⚠️  Unexpected response format (HTTP $HTTP_CODE)"
        fi
    else
        echo "   ❌ Authorization failed (HTTP $HTTP_CODE)"
        if echo "$CONTENT" | grep -q "invalid_scope"; then
            echo "      Error: Invalid scope - this is the issue!"
        fi
        echo "      Response: $(echo "$CONTENT" | head -1)"
    fi
done

echo ""
echo "🎯 Summary:"
echo "If any of the scope tests failed with 'invalid_scope', that's the issue."
echo "Check the server logs for detailed debugging information."