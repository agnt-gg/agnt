# Multi-stage build for AGNT - AI Agent Framework (FULL VERSION)
# Using Node 20 LTS with Chromium for complete features
# ~1.3GB image size - includes Puppeteer/Playwright browser automation
# For lighter version without Chromium (~600MB), use Dockerfile.lite
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install frontend dependencies (including devDependencies for build)
RUN npm install

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN npm run build

# Stage 2: Build backend dependencies
FROM node:20-alpine AS backend-builder

WORKDIR /app

# Install Python and build dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev

# Copy root package files
COPY package*.json ./

# Install backend dependencies
# Skip puppeteer, playwright, and electron-builder dependencies
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV npm_config_optional=false

# Install dependencies and ignore postinstall scripts (electron-builder not needed in Docker)
RUN npm install --production --ignore-scripts

# Rebuild native bindings for the Docker environment
RUN npm rebuild sqlite3 sharp

# Manually install onnxruntime packages (needed by @xenova/transformers)
# Use npm install without --no-save to ensure they're properly added to node_modules
RUN npm install onnxruntime-node onnxruntime-web

# Patch transformers.js to use dynamic imports (fixes ESM resolution in Docker)
COPY scripts/patch-transformers-onnx.js ./scripts/
RUN node scripts/patch-transformers-onnx.js || echo "Transformers patch failed, continuing anyway"

# Run onnxruntime patch script (for web backend compatibility)
COPY scripts/patch-onnxruntime.js ./scripts/
RUN node scripts/patch-onnxruntime.js || echo "ONNX patch failed, continuing anyway"

# Stage 3: Final runtime image
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    cairo \
    jpeg \
    pango \
    giflib \
    pixman \
    python3 \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Create necessary directories with correct ownership
RUN mkdir -p /app/backend/plugins/installed \
    /app/backend/plugins/plugin-builds \
    /app/logs \
    /app/data \
    && chown -R node:node /app

# Switch to non-root user BEFORE copying files
USER node

# Copy built frontend from frontend-builder with correct ownership
COPY --from=frontend-builder --chown=node:node /app/frontend/dist /app/frontend/dist

# Copy dependencies from backend-builder with correct ownership
COPY --from=backend-builder --chown=node:node /app/node_modules /app/node_modules

# Copy application code with correct ownership
COPY --chown=node:node backend/ /app/backend/
COPY --chown=node:node scripts/ /app/scripts/
COPY --chown=node:node main.js /app/
COPY --chown=node:node preload.js /app/
COPY --chown=node:node package*.json /app/
COPY --chown=node:node assets/ /app/assets/

# Expose backend port
EXPOSE 3333

# Health check
HEALTHCHECK --interval=33s --timeout=9s --start-period=33s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3333/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Start the backend server
CMD ["node", "backend/server.js"]
