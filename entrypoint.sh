#!/usr/bin/env bash
set -e

echo "🔑 Manager Script: Running login.js once…"
node /usr/src/app/login.js

echo "🚀 Manager Script: Launching the API server…"
exec "$@"
