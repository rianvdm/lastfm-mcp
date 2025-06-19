#!/bin/bash

echo "🔍 Debugging OAuth Client Registration"
echo ""

DEV_URL="https://lastfm-mcp.rian-db8.workers.dev"

echo "1. Testing what Claude Desktop should send for client registration..."
echo ""

# Simulate what Claude Desktop might send
echo "Simulating Claude Desktop client registration request:"
curl -v -X POST "$DEV_URL/oauth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Claude Desktop",
    "redirect_uris": ["https://claude.ai/oauth/callback"],
    "scope": "read:listening_history read:recommendations",
    "token_endpoint_auth_method": "client_secret_basic"
  }' 2>&1

echo ""
echo ""
echo "2. Testing with individual scopes..."

# Test each scope individually
for scope in "read:listening_history" "read:recommendations" "read:profile" "read:library"; do
    echo "Testing scope: $scope"
    
    RESPONSE=$(curl -s -X POST "$DEV_URL/oauth/register" \
      -H "Content-Type: application/json" \
      -d "{
        \"client_name\": \"Test Client - $scope\",
        \"redirect_uris\": [\"https://example.com\"],
        \"scope\": \"$scope\"
      }")
    
    if echo "$RESPONSE" | grep -q "client_id"; then
        echo "✅ $scope - Registration successful"
        CLIENT_ID=$(echo "$RESPONSE" | grep -o '"client_id":"[^"]*"' | cut -d'"' -f4)
        echo "   Client ID: $CLIENT_ID"
    else
        echo "❌ $scope - Registration failed"
        echo "   Response: $RESPONSE"
    fi
    echo ""
done

echo "3. Testing authorization with read:recommendations scope..."
echo ""

# Register client with read:recommendations
CLIENT_DATA=$(curl -s -X POST "$DEV_URL/oauth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Recommendations Test",
    "redirect_uris": ["https://claude.ai/oauth/callback"],
    "scope": "read:recommendations"
  }')

CLIENT_ID=$(echo "$CLIENT_DATA" | grep -o '"client_id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$CLIENT_ID" ]; then
    echo "Client registered with read:recommendations scope"
    echo "Client ID: $CLIENT_ID"
    echo ""
    
    # Test authorization with this scope
    echo "Testing authorization endpoint with read:recommendations..."
    AUTH_URL="$DEV_URL/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=https://claude.ai/oauth/callback&response_type=code&scope=read:recommendations&state=test"
    
    AUTH_RESPONSE=$(curl -s "$AUTH_URL")
    if echo "$AUTH_RESPONSE" | grep -q "<!DOCTYPE html>"; then
        echo "✅ Authorization endpoint works with read:recommendations"
    else
        echo "❌ Authorization endpoint failed"
        echo "Response: $(echo "$AUTH_RESPONSE" | head -2)"
    fi
else
    echo "❌ Failed to register client with read:recommendations"
fi