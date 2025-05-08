# Start with Node.js 18 slim base image
FROM node:18-slim

# Use root for installations
USER root

# --- Step 1: Set up Chromium profile for Puppeteer ---
# Where Chromium stores its user data (cookies, cache, etc.)
ENV CHROME_USER_DATA_DIR=/home/node/chromium-profile

# Install system dependencies, Chromium, ffmpeg, curl, etc.
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    curl \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    lsb-release \
    xdg-utils \
  && mkdir -p "$CHROME_USER_DATA_DIR" \
  && chown -R node:node /home/node "$CHROME_USER_DATA_DIR" \
  && rm -rf /var/lib/apt/lists/*

# Install yt-dlp binary for media downloads
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

# Install Puppeteer globally so login.js can drive Chromium
RUN npm install --global puppeteer

# Switch to unprivileged user for app runtime
USER node

# Set work directory inside container
WORKDIR /usr/src/app

# Copy package manifests and install dependencies
COPY --chown=node:node package.json package-lock.json* ./
RUN npm install --production

# Copy application source code and entrypoint manager script
COPY --chown=node:node . .

# Make entrypoint script executable
RUN chmod +x ./entrypoint.sh

# Define entrypoint to run the manager first
ENTRYPOINT ["./entrypoint.sh"]

# Expose application port
EXPOSE 3000

# Default command passed to entrypoint (starts server)
CMD ["npm", "start"]
