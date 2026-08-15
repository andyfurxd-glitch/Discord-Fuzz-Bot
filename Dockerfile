# Use Node.js 20 with Python support
FROM node:20-slim

# Install system dependencies: ffmpeg, yt-dlp, and Python
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN pip3 install --no-cache-dir yt-dlp spotify-scraper

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm install --omit=dev

# Copy application code
COPY . .

# Start the bot
CMD ["npm", "start"]
