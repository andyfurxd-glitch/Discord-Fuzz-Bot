# ── FuzzBot ────────────────────────────────────────────────
# 100% Node.js – no Python required.
# Runtime deps: ffmpeg (audio) + yt-dlp (stream URLs, binary only)
# ────────────────────────────────────────────────────────────
FROM node:22-slim

# Install system dependencies (No Python, no build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp as a standalone binary (no Python needed)
RUN curl -L https://github.com \
    -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Set working directory
WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install only production Node dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY . .

# Start the bot
CMD ["npm", "start"]
