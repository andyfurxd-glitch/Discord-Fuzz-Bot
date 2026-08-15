# Use Node.js 20
FROM node:20-slim

# Install system dependencies: ffmpeg and yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3-minimal \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN apt-get update && apt-get install -y \
    python3-pip \
    && pip3 install --no-cache-dir yt-dlp \
    && apt-get remove -y python3-pip \
    && rm -rf /var/lib/apt/lists/*

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
