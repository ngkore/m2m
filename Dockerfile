# ── Stage 1: Build the Vite frontend ─────────────────────────────────────────
FROM node:20-alpine AS build

# Skip Puppeteer download in build stage
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Production image ────────────────────────────────────────────────
FROM node:20-alpine

# Install Chromium for Puppeteer on Alpine
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Tell Puppeteer to use the system-installed Chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

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
