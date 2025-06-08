#!/bin/bash

# Test the ping tool with proper MCP initialization
echo "=== Initializing ==="
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0.0"}}}' | node /Users/rian/Documents/GitHub/discogs-mcp/proxy.cjs

echo -e "\n=== Sending initialized notification ==="
echo '{"jsonrpc": "2.0", "method": "initialized"}' | node /Users/rian/Documents/GitHub/discogs-mcp/proxy.cjs

echo -e "\n=== Testing ping tool ==="
echo '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "ping", "arguments": {"message": "Hello from test!"}}}' | node /Users/rian/Documents/GitHub/discogs-mcp/proxy.cjs 