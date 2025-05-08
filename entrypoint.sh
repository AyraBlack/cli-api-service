#!/usr/bin/env bash
set -e

# --- Section to comment out ---
# Only run login.js if you’ve actually provided credentials
# if [ -n "$YOUTUBE_EMAIL" ] && [ -n "$YOUTUBE_PASSWORD" ]; then
#  echo "🔑 Manager Script: Running login.js once…"
#  node /usr/src/app/login.js
# else
#  echo "⚠️  Skipping login.js (Manual cookie method selected)"
# fi
# --- End of section to comment out ---

# Always log that we are skipping login.js when using manual cookies
echo "🍪 Using manually provided cookies.txt. Skipping login.js."

echo "🚀 Manager Script: Launching the API server…"
# This line starts your server.js via the package.json "start" script
exec npm start
