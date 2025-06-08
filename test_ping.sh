#!/bin/bash

# Test basic MCP connectivity using direct HTTP requests
echo "=== Testing MCP Initialize ==="
curl -s -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test-client", "version": "1.0.0"}}}' | jq .

echo -e "\n=== Testing Ping Tool ==="
curl -s -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "ping", "arguments": {"message": "Hello from test script!"}}}' | jq . 