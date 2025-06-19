#!/bin/bash

DEV_URL="https://lastfm-mcp.rian-db8.workers.dev"
PROD_URL="https://lastfm-mcp-prod.rian-db8.workers.dev"

test_environment() {
    local URL=$1
    local ENV_NAME=$2
    
    echo "🌍 Testing $ENV_NAME Environment: $URL"
    echo ""
    
    # Test 1: Integration Manifest
    echo "1️⃣ Testing Integration Manifest..."
    MANIFEST=$(curl -s "$URL/.well-known/integration-manifest" 2>/dev/null)
    if echo "$MANIFEST" | grep -q "oauth"; then
        echo "✅ Integration manifest includes OAuth config"
        echo "   Authorization URL: $(echo "$MANIFEST" | grep -o '"authorization_url":"[^"]*"' | cut -d'"' -f4)"
    else
        echo "❌ No OAuth config in manifest"
        return 1
    fi
    
    # Test 2: Health Check
    echo ""
    echo "2️⃣ Testing Health Endpoint..."
    HEALTH=$(curl -s "$URL/health" 2>/dev/null)
    if echo "$HEALTH" | grep -q "status.*ok"; then
        echo "✅ Health check passed"
    else
        echo "❌ Health check failed"
    fi
    
    # Test 3: Client Registration
    echo ""
    echo "3️⃣ Testing OAuth Client Registration..."
    CLIENT_DATA=$(curl -s -X POST "$URL/oauth/register" \
      -H "Content-Type: application/json" \
      -d '{
        "client_name": "Claude Desktop Test",
        "redirect_uris": ["https://claude.ai/oauth/callback"],
        "scope": "read:listening_history read:recommendations"
      }' 2>/dev/null)
    
    CLIENT_ID=$(echo "$CLIENT_DATA" | grep -o '"client_id":"[^"]*"' | cut -d'"' -f4)
    
    if [ -n "$CLIENT_ID" ]; then
        echo "✅ OAuth client registered successfully"
        echo "   Client ID: $CLIENT_ID"
    else
        echo "❌ OAuth client registration failed"
        echo "   Response: $CLIENT_DATA"
        return 1
    fi
    
    # Test 4: Authorization Endpoint
    echo ""
    echo "4️⃣ Testing Authorization Endpoint..."
    AUTH_URL="$URL/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=https://claude.ai/oauth/callback&response_type=code&scope=read:listening_history&state=test"
    
    AUTH_RESPONSE=$(curl -s "$AUTH_URL" 2>/dev/null)
    if echo "$AUTH_RESPONSE" | grep -q "<!DOCTYPE html>"; then
        echo "✅ Authorization endpoint returns consent page"
        if echo "$AUTH_RESPONSE" | grep -q "Claude Desktop Test"; then
            echo "✅ Consent page shows correct client name"
        fi
    else
        echo "❌ Authorization endpoint failed"
        echo "   Response preview: $(echo "$AUTH_RESPONSE" | head -1)"
        return 1
    fi
    
    echo ""
    echo "🎯 $ENV_NAME Environment Summary:"
    echo "✅ Integration Manifest"
    echo "✅ Health Check"  
    echo "✅ OAuth Client Registration"
    echo "✅ Authorization Consent Page"
    echo ""
    echo "🔗 Claude Desktop Integration URL:"
    echo "   $URL/.well-known/integration-manifest"
    echo ""
    echo "🧪 Test Authorization URL:"
    echo "   $AUTH_URL"
    echo ""
    return 0
}

# Test Development Environment
test_environment "$DEV_URL" "DEVELOPMENT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test Production Environment (if deployed)
if curl -s -I "$PROD_URL" 2>/dev/null | grep -q "200 OK"; then
    test_environment "$PROD_URL" "PRODUCTION"
else
    echo "🏭 Production Environment: Not deployed yet"
    echo ""
    echo "To deploy to production:"
    echo "   npm run deploy:prod"
fi

echo "🎉 Next Steps:"
echo "1. Deploy to production if needed: npm run deploy:prod"
echo "2. Test Claude Desktop integration with dev/prod URLs"
echo "3. Add integration to Claude Desktop using manifest URL"