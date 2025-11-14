
FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg ca-certificates curl && \
    pip3 install --no-cache-dir yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
