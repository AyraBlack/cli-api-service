# Start with the same Node.js version
FROM node:18-slim

# We'll do things as root initially for installations
USER root

# --- Step 1: Prepare Your Docker "House" for a Smart Browser ---

# Tell Chromium where to keep its memories (profile)
ENV CHROME_USER_DATA_DIR /home/node/chromium-profile

# Install system dependencies + Chromium
RUN apt-get update && apt-get install -y \
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
    chromium \
    # Now, create the memory box room for Chromium and give keys to the 'node' user
    && mkdir -p $CHROME_USER_DATA_DIR \
    && chown -R node:node /home/node \
    && chown -R node:node $CHROME_USER_DATA_DIR \
    # Clean up apt lists to keep the image small
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN curl -L \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

# Install Puppeteer globally
RUN npm install --global puppeteer

# --- From now on, we'll work as the 'node' user for better security ---
USER node

# Set the main folder for our app inside the Docker house
WORKDIR /usr/src/app

# We are NOT using the old cookies.txt file anymore
# COMMENTED OUT: COPY cookies.txt ./

# Copy package.json and package-lock.json first
COPY --chown=node:node package.json package-lock.json* ./

# Install only the necessary app dependencies
RUN npm install --production # This will use your package.json

# Copy the rest of your application code
COPY --chown=node:node . .

# Copy our new "manager" script (entrypoint.sh)
COPY --chown=node:node entrypoint.sh .
# Give the manager script permission to run
RUN chmod +x ./entrypoint.sh
# Tell Docker that our manager script is the first thing to run
ENTRYPOINT ["./entrypoint.sh"]

# Your app will listen on port 3000
EXPOSE 3000

# This command will be given to our entrypoint.sh manager
CMD ["npm", "start"]
