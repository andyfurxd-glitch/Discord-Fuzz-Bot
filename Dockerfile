# ── FuzzBot ────────────────────────────────────────────────
# 100% Node.js – no Python required.
# Runtime deps: ffmpeg (audio) + yt-dlp (stream URLs, binary only)
# ────────────────────────────────────────────────────────────
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp as a standalone binary (no Python needed)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
        -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Set working directory
WORKDIR /app

# Copy package files first (caches the npm install layer)
COPY package*.json ./

# Install only production Node dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY . .

# Start the bot
CMD ["npm", "start"]
