#!/bin/bash

# Test MCP session with production server
SERVER="https://discogs-mcp-prod.rian-db8.workers.dev/sse"

echo "1. Testing initialize..."
curl -X POST "$SERVER" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "params": {"protocolVersion": "2024-11-05", "clientInfo": {"name": "test-client", "version": "1.0.0"}}, "id": 1}' \
  | jq .

echo -e "\n2. Sending initialized notification..."
curl -X POST "$SERVER" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "initialized"}' \
  | jq .

echo -e "\n3. Testing tools/list..."
curl -X POST "$SERVER" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 2}' \
  | jq .

echo -e "\n4. Testing ping tool..."
curl -X POST "$SERVER" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "ping", "arguments": {"message": "Hello from test"}}, "id": 3}' \
  | jq .

echo -e "\n5. Testing auth_status tool..."
curl -X POST "$SERVER" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "auth_status", "arguments": {}}, "id": 4}' \
  | jq . 