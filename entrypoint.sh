#!/bin/sh
# entrypoint.sh - Our little "manager" script. It runs first.

# 'set -e' means: if any command below fails (exits with a non-zero status), 
# the manager script will stop immediately. This is usually good for finding errors quickly.
set -e 

echo "Manager Script: Hello! I'm in charge of starting things up."
echo "Manager Script: First, I'll ask the Login Robot (login.js) to do its job..."

# This command tells Node.js to run our login.js script.
# We assume login.js is in /usr/src/app because that's the WORKDIR in your Dockerfile.
node /usr/src/app/login.js

# If login.js had a big error and stopped itself (e.g., with process.exit(1)), 
# and 'set -e' is active, this script would have stopped there.
# If login.js just printed warnings but finished, we continue.

echo "Manager Script: The Login Robot has finished its attempt to check/login to YouTube."
echo "Manager Script: Now, I'll start your main application (servers.js)..."

# This line is special: 'exec "$@"'
# Docker will pass your CMD (from the Dockerfile, e.g., "npm start") to this script as "$@".
# 'exec' replaces the manager script with your main app's command, so your app becomes
# the main process. This is good practice.
exec "$@"
