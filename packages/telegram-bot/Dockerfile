FROM node:20-slim

WORKDIR /app

# Install system dependencies for core (like git, ripgrep etc)
RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  ripgrep \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Copy workspace configuration
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/telegram-bot/package.json ./packages/telegram-bot/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the project
RUN npm run build --workspaces

# Set default environment variables
ENV NODE_ENV=production
ENV GEMINI_WORKSPACE_DIR=/app

# Start the bot
CMD ["npm", "start", "--workspace", "@google/gemini-cli-telegram-bot"]
