#!/bin/bash

# Monitor Last.fm MCP Cache Performance
# Usage: ./monitor-cache.sh

echo "🔍 Last.fm MCP Cache Monitor"
echo "================================"

# Check total cache entries
TOTAL_KEYS=$(wrangler kv key list --namespace-id a0bc40f523d54a6ab70fa947ac3daeaf | jq length)
echo "📊 Total cache entries: $TOTAL_KEYS"

# Break down by cache type
echo ""
echo "📂 Cache breakdown:"
wrangler kv key list --namespace-id a0bc40f523d54a6ab70fa947ac3daeaf | jq -r '.[] | .name' | while read key; do
  if [[ $key == cache:recentTracks:* ]]; then
    echo "  Recent Tracks: +1"
  elif [[ $key == cache:topArtists:* ]]; then
    echo "  Top Artists: +1"
  elif [[ $key == cache:topAlbums:* ]]; then
    echo "  Top Albums: +1"
  elif [[ $key == cache:trackInfo:* ]]; then
    echo "  Track Info: +1"
  elif [[ $key == cache:artistInfo:* ]]; then
    echo "  Artist Info: +1"
  elif [[ $key == cache:albumInfo:* ]]; then
    echo "  Album Info: +1"
  elif [[ $key == cache:userInfo:* ]]; then
    echo "  User Info: +1"
  elif [[ $key == cache:similarArtists:* ]]; then
    echo "  Similar Artists: +1"
  elif [[ $key == cache:similarTracks:* ]]; then
    echo "  Similar Tracks: +1"
  fi
done | sort | uniq -c

echo ""
echo "🕒 Recent cache entries (last 5):"
wrangler kv key list --namespace-id a0bc40f523d54a6ab70fa947ac3daeaf | jq -r '.[-5:] | .[] | .name'

echo ""
echo "💡 Tip: Run this script periodically to monitor cache growth"
echo "💡 Use 'wrangler kv key get <key> --namespace-id a0bc40f523d54a6ab70fa947ac3daeaf' to inspect specific entries" 