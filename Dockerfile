FROM node:18-slim

USER root
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
    && rm -rf /var/lib/apt/lists/*

RUN curl -L \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
      -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

RUN npm install --global puppeteer

WORKDIR /usr/src/app
# Bring your YouTube auth cookies into the container
COPY cookies.txt ./

COPY package.json ./
RUN npm install --production
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
