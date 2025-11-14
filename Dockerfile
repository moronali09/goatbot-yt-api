FROM node:20-bullseye-slim
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg ca-certificates curl && pip3 install --no-cache-dir yt-dlp && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
EXPOSE 3000
ENV PORT=3000 NODE_ENV=production
CMD ["node", "server.js"]
