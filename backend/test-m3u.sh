#!/bin/bash

echo "Testing M3U playlist endpoints..."
echo "================================"

# Test M3U endpoint
echo -e "\n1. Testing M3U playlist:"
curl -s http://localhost:4001/playlist.m3u | head -10

# Test M3U8 endpoint
echo -e "\n\n2. Testing M3U8 playlist:"
curl -s http://localhost:4001/playlist.m3u8 | head -10

# Test JSON endpoint
echo -e "\n\n3. Testing JSON playlist:"
curl -s http://localhost:4001/playlist.json | jq '.items[0]' 2>/dev/null || curl -s http://localhost:4001/playlist.json | head -20

echo -e "\n\nDone!"