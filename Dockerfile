FROM node:18-slim

USER root
RUN apt-get update && apt-get install -y \
    python3-pip ffmpeg \
    ca-certificates fonts-liberation libappindicator3-1 libasound2 \
    libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 libdrm2 \
    libgbm1 libgtk-3-0 libnspr4 libnss3 lsb-release xdg-utils wget \
  && pip3 install yt-dlp \
  && npm install --global puppeteer \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package.json ./
RUN npm install --production
COPY . .

EXPOSE 3000
CMD ["npm", "start"]

