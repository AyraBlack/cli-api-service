#!/usr/bin/env bash
set -e

# No need to check for login.js when using proxy

echo "🚀 Manager Script: Launching the API server (using proxy)..."
# This line starts your server.js via the package.json "start" script
exec npm start

