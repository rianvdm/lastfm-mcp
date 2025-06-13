#!/bin/bash

# Setup script for production deployment
# This script creates the necessary KV namespaces and sets up secrets for production

set -e

echo "🚀 Setting up Last.fm MCP Server for production deployment..."

# Create production KV namespaces
echo "📦 Creating production KV namespaces..."

# Create MCP_LOGS namespace for production
LOGS_ID=$(wrangler kv:namespace create "MCP_LOGS" --env production --preview false | grep -o 'id = "[^"]*"' | cut -d'"' -f2)
echo "Created MCP_LOGS namespace: $LOGS_ID"

# Create MCP_RL namespace for production  
RL_ID=$(wrangler kv:namespace create "MCP_RL" --env production --preview false | grep -o 'id = "[^"]*"' | cut -d'"' -f2)
echo "Created MCP_RL namespace: $RL_ID"

# Create MCP_SESSIONS namespace for production
SESSIONS_ID=$(wrangler kv:namespace create "MCP_SESSIONS" --env production --preview false | grep -o 'id = "[^"]*"' | cut -d'"' -f2)
echo "Created MCP_SESSIONS namespace: $SESSIONS_ID"

echo ""
echo "📝 Please update wrangler.toml with the following KV namespace IDs:"
echo ""
echo "[[env.production.kv_namespaces]]"
echo "binding = \"MCP_LOGS\""
echo "id = \"$LOGS_ID\""
echo ""
echo "[[env.production.kv_namespaces]]"
echo "binding = \"MCP_RL\""
echo "id = \"$RL_ID\""
echo ""
echo "[[env.production.kv_namespaces]]"
echo "binding = \"MCP_SESSIONS\""
echo "id = \"$SESSIONS_ID\""
echo ""

echo "🔐 Setting up secrets (you'll be prompted for each)..."
echo "Please have your Last.fm app credentials ready."
echo ""

# Set production secrets
echo "Setting LASTFM_API_KEY..."
wrangler secret put LASTFM_API_KEY --env production

echo "Setting LASTFM_SHARED_SECRET..."
wrangler secret put LASTFM_SHARED_SECRET --env production

echo "Setting JWT_SECRET (use a strong random string)..."
wrangler secret put JWT_SECRET --env production

echo ""
echo "✅ Production setup complete!"
echo "You can now deploy to production with: npm run deploy:prod" 