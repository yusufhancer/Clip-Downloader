FROM node:22-bookworm-slim

# Install system dependencies: python3, ffmpeg, curl, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces runs as user 1000
RUN useradd -m -u 1000 user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PORT=7860 \
    HOSTNAME="0.0.0.0"

WORKDIR /app

# Copy package manifests and install dependencies
COPY --chown=user:user package*.json ./
RUN npm ci

# Copy project files
COPY --chown=user:user . .

# Setup yt-dlp binary for Linux
RUN npm run setup:media

# Build Next.js application
RUN npm run build

# Ensure runtime temp folder exists and has right permissions
RUN mkdir -p .clips && chown -R user:user /app

USER user

EXPOSE 7860

CMD ["npx", "next", "start", "-p", "7860", "-H", "0.0.0.0"]
