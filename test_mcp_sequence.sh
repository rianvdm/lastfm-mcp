#!/bin/bash

# Test the full MCP handshake sequence using direct HTTP requests
echo "=== Testing MCP Initialize ==="
curl -s -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "claude-ai", "version": "0.1.0"}}}' | jq .

echo -e "\n=== Testing Resources List ==="
curl -s -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "resources/list"}' | jq .

echo -e "\n=== Testing Tools List ==="
curl -s -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 3, "method": "tools/list"}' | jq .

echo -e "\n=== Testing Prompts List ==="
curl -s -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 4, "method": "prompts/list"}' | jq . 