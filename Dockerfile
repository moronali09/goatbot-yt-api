FROM node:20-bullseye-slim

# system deps + ffmpeg + python + yt-dlp
RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg ca-certificates curl && \
    pip3 install --no-cache-dir yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# use a separate npm cache location to avoid permission/corrupt cache issues in container build
ENV NPM_CONFIG_CACHE=/tmp/.npm-cache

COPY package*.json ./

# If package-lock.json exists, prefer npm ci (reproducible). Otherwise npm install.
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

COPY . .

EXPOSE 3000
ENV PORT=3000 NODE_ENV=production
CMD ["node", "server.js"]
