# ── Stage 1: Build the Vite frontend ─────────────────────────────────────────
FROM node:20-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Production image ────────────────────────────────────────────────
FROM node:20-slim

# Install Chromium dependencies for Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxshmfence1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system-installed Chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy server code, built frontend, and .env file
COPY server/ ./server/
COPY --from=build /app/dist ./dist/
COPY .env ./

EXPOSE ${PORT:-3001}
CMD ["node", "--env-file=.env", "server/index.js"]
