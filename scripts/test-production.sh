#!/bin/bash

# Production testing script for Last.fm MCP Server
# Usage: ./scripts/test-production.sh https://your-worker-domain.workers.dev

set -e

if [ $# -eq 0 ]; then
    echo "Usage: $0 <worker-url>"
    echo "Example: $0 https://lastfm-mcp-prod.your-subdomain.workers.dev"
    exit 1
fi

WORKER_URL="$1"
echo "🧪 Testing Last.fm MCP Server at: $WORKER_URL"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to run tests
run_test() {
    local test_name="$1"
    local command="$2"
    local expected_pattern="$3"
    
    echo -n "Testing $test_name... "
    
    if output=$(eval "$command" 2>&1); then
        if echo "$output" | grep -q "$expected_pattern"; then
            echo -e "${GREEN}✓ PASS${NC}"
            ((TESTS_PASSED++))
            return 0
        else
            echo -e "${RED}✗ FAIL${NC} (unexpected response)"
            echo "Expected pattern: $expected_pattern"
            echo "Actual output: $output"
            ((TESTS_FAILED++))
            return 1
        fi
    else
        echo -e "${RED}✗ FAIL${NC} (command failed)"
        echo "Error: $output"
        ((TESTS_FAILED++))
        return 1
    fi
}

echo "🔍 Basic Connectivity Tests"
echo "─────────────────────────────"

# Test 1: Health check
run_test "Health endpoint" \
    "curl -s -f '$WORKER_URL/health'" \
    '"status":"ok"'

# Test 2: Root endpoint responds
run_test "Root endpoint" \
    "curl -s -f '$WORKER_URL/'" \
    "Last.fm MCP Server"

echo ""
echo "🔧 MCP Protocol Tests"
echo "─────────────────────────"

# Test 3: MCP Initialize
run_test "MCP Initialize" \
    "curl -s -X POST '$WORKER_URL' -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"1.0\"}}}'" \
    '"protocolVersion":"2024-11-05"'

# Test 4: Tools list
run_test "Tools list" \
    "curl -s -X POST '$WORKER_URL' -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}'" \
    '"name":"get_recent_tracks"'

# Test 5: Resources list
run_test "Resources list" \
    "curl -s -X POST '$WORKER_URL' -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"resources/list\",\"params\":{}}'" \
    '"uri":"lastfm://user"'

# Test 6: Prompts list
run_test "Prompts list" \
    "curl -s -X POST '$WORKER_URL' -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"prompts/list\",\"params\":{}}'" \
    '"name":"listening_insights"'

echo ""
echo "🔐 Authentication Tests"
echo "─────────────────────────"

# Test 7: OAuth discovery advertises dynamic client registration
run_test "OAuth registration endpoint" \
    "curl -s -f '$WORKER_URL/.well-known/oauth-authorization-server'" \
    '"registration_endpoint"'

# Test 8: Unauthenticated tool call (should fail)
run_test "Unauthenticated tool rejection" \
    "curl -s -X POST '$WORKER_URL' -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"get_recent_tracks\",\"arguments\":{\"username\":\"test\"}}}'" \
    '"error"'

echo ""
echo "📊 Error Handling Tests"
echo "─────────────────────────"

# Test 9: Invalid JSON-RPC
run_test "Invalid JSON-RPC handling" \
    "curl -s -X POST '$WORKER_URL' -H 'Content-Type: application/json' -d '{\"invalid\":\"json-rpc\"}'" \
    '"error"'

# Test 10: Unknown method
run_test "Unknown method handling" \
    "curl -s -X POST '$WORKER_URL' -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"unknown/method\",\"params\":{}}'" \
    '"error"'

echo ""
echo "🌐 CORS and Headers Tests"
echo "─────────────────────────────"

# Test 11: CORS headers
run_test "CORS headers" \
    "curl -s -I '$WORKER_URL' | grep -i 'access-control'" \
    "Access-Control-Allow-Origin"

# Test 12: Content-Type header
run_test "Content-Type header" \
    "curl -s -I '$WORKER_URL' | grep -i 'content-type'" \
    "application/json"

echo ""
echo "📈 Summary"
echo "─────────"
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
echo -e "Total tests: $((TESTS_PASSED + TESTS_FAILED))"

if [ $TESTS_FAILED -eq 0 ]; then
    echo ""
    echo -e "${GREEN}🎉 All tests passed! Your Last.fm MCP Server is working correctly.${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Configure Claude Desktop with this server URL"
    echo "2. Test authentication by connecting the server in an MCP client and signing in with Last.fm"
    echo "3. Monitor the server using: wrangler tail --env production"
    exit 0
else
    echo ""
    echo -e "${RED}❌ Some tests failed. Please check the errors above.${NC}"
    echo ""
    echo "Troubleshooting tips:"
    echo "1. Verify the worker deployed successfully"
    echo "2. Check Cloudflare Workers dashboard for errors"
    echo "3. Ensure all secrets are properly configured"
    echo "4. Review the deployment guide: docs/deployment-guide.md"
    exit 1
fi 