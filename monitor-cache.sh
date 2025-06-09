#!/bin/bash

# Monitor Discogs MCP Cache Performance
# Usage: ./monitor-cache.sh

echo "🔍 Discogs MCP Cache Monitor"
echo "================================"

# Check total cache entries
TOTAL_KEYS=$(wrangler kv key list --namespace-id a0bc40f523d54a6ab70fa947ac3daeaf | jq length)
echo "📊 Total cache entries: $TOTAL_KEYS"

# Break down by cache type
echo ""
echo "📂 Cache breakdown:"
wrangler kv key list --namespace-id a0bc40f523d54a6ab70fa947ac3daeaf | jq -r '.[] | .name' | while read key; do
  if [[ $key == cache:collections:* ]]; then
    echo "  Collections: +1"
  elif [[ $key == cache:releases:* ]]; then
    echo "  Releases: +1"
  elif [[ $key == cache:searches:* ]]; then
    echo "  Searches: +1"
  elif [[ $key == cache:stats:* ]]; then
    echo "  Stats: +1"
  elif [[ $key == cache:userProfiles:* ]]; then
    echo "  User Profiles: +1"
  fi
done | sort | uniq -c

echo ""
echo "🕒 Recent cache entries (last 5):"
wrangler kv key list --namespace-id a0bc40f523d54a6ab70fa947ac3daeaf | jq -r '.[-5:] | .[] | .name'

echo ""
echo "💡 Tip: Run this script periodically to monitor cache growth"
echo "💡 Use 'wrangler kv key get <key> --namespace-id a0bc40f523d54a6ab70fa947ac3daeaf' to inspect specific entries" 