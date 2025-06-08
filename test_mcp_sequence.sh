#!/bin/bash

# Test the full MCP handshake sequence
echo "=== Testing MCP Initialize ==="
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "claude-ai", "version": "0.1.0"}}}' | node /Users/rian/Documents/GitHub/discogs-mcp/proxy.cjs

echo -e "\n=== Testing MCP Initialized Notification ==="
echo '{"jsonrpc": "2.0", "method": "initialized"}' | node /Users/rian/Documents/GitHub/discogs-mcp/proxy.cjs

echo -e "\n=== Testing Resources List ==="
echo '{"jsonrpc": "2.0", "id": 2, "method": "resources/list"}' | node /Users/rian/Documents/GitHub/discogs-mcp/proxy.cjs

echo -e "\n=== Testing Tools List ==="
echo '{"jsonrpc": "2.0", "id": 3, "method": "tools/list"}' | node /Users/rian/Documents/GitHub/discogs-mcp/proxy.cjs

echo -e "\n=== Testing Prompts List ==="
echo '{"jsonrpc": "2.0", "id": 4, "method": "prompts/list"}' | node /Users/rian/Documents/GitHub/discogs-mcp/proxy.cjs 