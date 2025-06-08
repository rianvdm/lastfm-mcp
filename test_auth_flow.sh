#!/bin/bash

echo "Testing Discogs MCP Authentication Flow"
echo "======================================="
echo

echo "1. Checking server status..."
curl -s -o /dev/null -w "Server status: %{http_code}\n" http://localhost:8787/

echo
echo "2. Checking authentication status..."
curl -s http://localhost:8787/mcp-auth | jq .

echo
echo "3. Testing MCP proxy with initialize..."
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' | node proxy.cjs | jq .

echo
echo "4. Testing search_collection tool..."
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search_collection","arguments":{"query":"Beatles"}},"id":2}' | node proxy.cjs | jq .

echo
echo "If you see authentication errors above:"
echo "  1. Visit http://localhost:8787/login in your browser"
echo "  2. Complete the Discogs OAuth flow"
echo "  3. Run this script again"
echo
echo "The proxy will automatically detect your authentication and use it for tool calls." 