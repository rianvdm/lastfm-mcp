#!/bin/bash
# Test script for MCP HTTP transport

BASE_URL="http://localhost:8787"

echo "=== Testing MCP HTTP Transport ==="
echo ""

echo "1. Test initialize:"
curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}}}' | jq .
echo ""

echo "2. Test tools/list:"
curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | jq '.result.tools[] | {name: .name, description: .description}' | head -20
echo ""

echo "3. Test ping tool:"
curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ping","arguments":{"message":"Hello from test script"}}}' | jq .
echo ""

echo "4. Test get_track_info (public):"
curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_track_info","arguments":{"artist":"Radiohead","track":"Paranoid Android"}}}' | jq .result.content[0].text
echo ""

echo "5. Test authenticated tool (should fail):"
curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_recent_tracks","arguments":{"username":"test"}}}' | jq .
echo ""

echo "=== Tests Complete ==="
