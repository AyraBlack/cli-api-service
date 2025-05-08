#!/usr/bin/env bash
set -e

# Only run login.js if you’ve actually provided credentials
if [ -n "$YOUTUBE_EMAIL" ] && [ -n "$YOUTUBE_PASSWORD" ]; then
  echo "🔑 Manager Script: Running login.js once…"
  node /usr/src/app/login.js
else
  echo "⚠️  Skipping login.js (no YOUTUBE_EMAIL/YOUTUBE_PASSWORD set)"
fi

echo "🚀 Manager Script: Launching the API server…"
exec npm start
