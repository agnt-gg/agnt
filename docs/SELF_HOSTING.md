# Self-Hosting AGNT with Docker

This guide will help you self-host AGNT using Docker for a production-ready deployment.

## Who Is This For?

**AGNT is local-first and designed for:**

- ✅ **Single users** - Personal deployment on your server
- ✅ **Families** - Share across household devices
- ✅ **Small teams** - 2-10 people in your organization

**NOT designed for:**

- ❌ Multi-tenant SaaS (hundreds of separate organizations)
- ❌ Public hosting for unrelated users
- ❌ Large enterprises (50+ concurrent users)

**Why?** AGNT uses SQLite (local database) and broadcasts real-time updates to all connected clients. This architecture is perfect for trusted groups sharing a workspace, but not for isolating thousands of separate users or organizations.

**Each organization should self-host their own AGNT instance.**

## What You Get

Docker containerization provides:

- ✅ **Isolated Environment** - AGNT runs in a sandbox, can't mess up your host system
- ✅ **Web UI Accessible** - Full frontend accessible on port 3333
- ✅ **Cloud API Access** - Connect to OpenAI, Anthropic, Google, and all cloud AI providers
- ✅ **Localhost Access** - Optional support for local services on your host machine
- ✅ **Cross-Platform** - Works on Windows, macOS, and Linux (including ARM64)
- ✅ **Easy Updates** - Rebuild and restart without affecting your data
- ✅ **Persistent Data** - All workflows, agents, and plugins saved in Docker volumes

## Prerequisites

- Docker Engine 20.10+ or Docker Desktop
- Docker Compose (optional, but recommended)
- At least 2GB of available RAM
- 10GB of free disk space (for full version) or 6GB (for lite version)

## Image Variants

AGNT offers two Docker image variants to suit different needs:

### 🔋 Full Version (Default) - `agnt:latest`
**Size:** ~1.5GB | **Dockerfile:** `Dockerfile`

**Includes:**
- ✅ Chromium browser (Puppeteer/Playwright support)
- ✅ Full browser automation capabilities
- ✅ Web scraping tools
- ✅ Screenshot generation
- ✅ PDF rendering from HTML

**Best for:**
- Self-hosted/local deployments
- When you need browser automation features
- Development environments
- Servers with sufficient disk space

**Quick start:**
```bash
docker-compose up -d
# or
docker build -t agnt:latest .
```

---

### 🪶 Lite Version - `agnt:lite`
**Size:** ~715MB (52% smaller) | **Dockerfile:** `Dockerfile.lite`

**Includes:**
- ✅ All core AGNT features
- ✅ AI agent workflows
- ✅ Plugin system
- ✅ Image processing (without browser)
- ❌ No Chromium (saves ~900MB)
- ❌ No Puppeteer/Playwright browser automation

**Best for:**
- Cloud deployments (AWS, GCP, Azure)
- Resource-constrained environments
- When you don't need browser features
- Faster deployments and image pulls

**Quick start:**
```bash
docker-compose -f docker-compose.lite.yml up -d
# or
docker build -f Dockerfile.lite -t agnt:lite .
```

---

**Comparison Table:**

| Feature | Full | Lite |
|---------|------|------|
| Image Size | ~1.5GB | ~715MB (52% smaller) |
| Browser Automation | ✅ | ❌ |
| Web Scraping | ✅ | ❌ |
| AI Agents & Workflows | ✅ | ✅ |
| Plugin System | ✅ | ✅ |
| API Integrations | ✅ | ✅ |
| Image Processing | ✅ | ✅ |
| Memory Usage | ~1.2GB | ~700MB |

**💡 Recommendation:** Start with **Lite** unless you specifically need browser automation. You can always switch to Full later if needed.

## Quick Start with Docker

### Option 1: Docker Run (Simple)

```bash
# Build the Docker image
docker build -t agnt:latest .

# Run the container
docker run -d \
  --name agnt \
  -p 3333:3333 \
  -v agnt-data:/app/data \
  -v agnt-plugins:/app/backend/plugins/installed \
  -e NODE_ENV=production \
  -e BASE_URL=http://localhost:3333 \
  --restart unless-stopped \
  agnt:latest
```

Access AGNT at `http://localhost:3333`

### Option 2: Docker Compose (Recommended)

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  agnt:
    build: .
    container_name: agnt
    ports:
      - "3333:3333"
    environment:
      - NODE_ENV=production
      - BASE_URL=http://localhost:3333
      - REMOTE_URL=https://api.agnt.gg
      - JWT_SECRET=${JWT_SECRET:-your-random-jwt-secret-here}
      - SESSION_SECRET=${SESSION_SECRET:-your-random-session-secret-here}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY:-your-random-encryption-key-here}
    volumes:
      - agnt-data:/app/data
      - agnt-plugins:/app/backend/plugins/installed
      - agnt-plugin-builds:/app/backend/plugins/plugin-builds
      - agnt-logs:/app/logs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3333/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 33s
      timeout: 9s
      retries: 3
      start_period: 33s

volumes:
  agnt-data:
  agnt-plugins:
  agnt-plugin-builds:
  agnt-logs:
```

Start the service:

```bash
# Start AGNT
docker-compose up -d

# View logs
docker-compose logs -f

# Stop AGNT
docker-compose down
```

## Environment Variables

Configure AGNT by setting these environment variables:

### Required Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `NODE_ENV` | Application environment | `development` | `production` |
| `BASE_URL` | Base URL for the application | `http://localhost:3333` | `https://agnt.yourdomain.com` |
| `JWT_SECRET` | Secret for JWT token generation | (auto-generated) | Random 32+ char string |
| `SESSION_SECRET` | Secret for session management | (auto-generated) | Random 64+ char string |
| `ENCRYPTION_KEY` | Key for data encryption | (auto-generated) | Random 32+ char string |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3333` |
| `REMOTE_URL` | Remote API URL for sharing/webhooks | `https://api.agnt.gg` |
| `WEBHOOK_URL` | Webhook endpoint URL | `http://localhost:3001` |
| `FRONTEND_URL` | Frontend URL | `http://localhost:5173` |
| `AGNT_LITE_MODE` | Disable browser automation features (Lite version) | `false` |

### Lite Mode Configuration

**`AGNT_LITE_MODE`** is automatically set to `true` in the Lite Docker image and disables browser automation features:

- **When `true`**: Puppeteer/Playwright tools will return graceful error messages
- **When `false`** (default): All features including browser automation are available
- **Lite image**: Automatically sets this to `true` (Dockerfile.lite)
- **Full image**: Defaults to `false` (Dockerfile)

**What gets disabled in Lite Mode:**
- ❌ Web scraping with Puppeteer/Playwright
- ❌ Screenshot capture via browser
- ❌ HTML to PDF conversion via browser
- ❌ Browser-based form automation

**What still works in Lite Mode:**
- ✅ AI agents and workflows
- ✅ All API integrations
- ✅ Plugin system
- ✅ Image processing (non-browser)
- ✅ PDF reading
- ✅ Email automation

See [Lite Mode Developer Guide](LITE_MODE.md) for implementation details.

### Generating Secure Secrets

Generate secure random secrets for your production deployment:

```bash
# JWT Secret (32+ characters)
openssl rand -base64 32

# Session Secret (64+ characters)
openssl rand -hex 64

# Encryption Key (32+ characters)
openssl rand -hex 32
```

## Volume Mounts

Persistent data volumes are essential for self-hosting:

| Volume Path | Purpose | Important? |
|-------------|---------|------------|
| `/app/data` | User data, workflows, agents, configurations | ✅ Critical |
| `/app/backend/plugins/installed` | Installed plugin packages | ✅ Recommended |
| `/app/backend/plugins/plugin-builds` | Built plugin files | ⚠️ Optional |
| `/app/logs` | Application logs | ℹ️ Optional |

## Networking

### Port Mapping

- **3333**: Main application port (HTTP)
  - Web UI/Frontend accessible at `http://localhost:3333`
  - Backend API accessible at `http://localhost:3333/api/*`
- Map to host: `-p 3333:3333` or use a reverse proxy

### Network Connectivity

**✅ Web App Access**
The AGNT web interface is fully accessible through port 3333. The backend serves both the Vue.js frontend and the API endpoints on the same port.

**✅ Outbound Connections (Cloud AI Providers)**
Docker containers can make outbound connections by default. AGNT can connect to:
- OpenAI API (api.openai.com)
- Anthropic API (api.anthropic.com)
- Google Gemini API
- Groq, Cerebras, DeepSeek, and other cloud providers
- External webhooks and APIs

No special configuration needed for internet egress.

**⚠️ Connecting to Host Localhost Services**
If you need AGNT to connect to services running on your host machine (e.g., local AI providers, MCP servers, or databases), use `host.docker.internal`:

**docker-compose.yml** (included by default):
```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

**Docker run command**:
```bash
docker run --add-host=host.docker.internal:host-gateway agnt:latest
```

Then configure AGNT to use `host.docker.internal` instead of `localhost`:
- Example: `http://host.docker.internal:8080` instead of `http://localhost:8080`
- Works for AI provider endpoints, MCP servers, databases, etc.

**Alternative: Host Network Mode (Linux only)**
For direct host network access on Linux:
```yaml
network_mode: "host"
```

Note: This removes network isolation but provides native localhost access.

### Reverse Proxy Configuration

#### Nginx Example

```nginx
server {
    listen 80;
    server_name agnt.yourdomain.com;

    location / {
        proxy_pass http://localhost:3333;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:3333;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

#### Traefik Example

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.agnt.rule=Host(`agnt.yourdomain.com`)"
  - "traefik.http.routers.agnt.entrypoints=websecure"
  - "traefik.http.routers.agnt.tls.certresolver=letsencrypt"
  - "traefik.http.services.agnt.loadbalancer.server.port=3333"
```

## Building from Source

### Image Specifications

**Full Version (`Dockerfile`):**
- **Base**: Alpine Linux (minimal footprint)
- **Runtime**: Node.js 20 LTS
- **Browser**: Chromium (for Puppeteer/Playwright features)
- **Image Size**: ~1.5GB
- **Architecture**: linux/amd64, linux/arm64

**Size breakdown:**
- ~650MB: Chromium browser + graphics libraries (cairo, pango, fonts)
- ~494MB: Node.js dependencies (AI SDKs, puppeteer-extra, image processing)
- ~180MB: Node.js 20 runtime
- ~100MB: Backend source code and plugins
- ~80MB: Built Vue.js frontend
- ~40MB: Alpine Linux base

**Lite Version (`Dockerfile.lite`):**
- **Base**: Alpine Linux (minimal footprint)
- **Runtime**: Node.js 20 LTS
- **Browser**: None (no Chromium)
- **Image Size**: ~715MB (52% smaller)
- **Architecture**: linux/amd64, linux/arm64

**Size breakdown:**
- ~315MB: Node.js dependencies (AI SDKs, image processing, no puppeteer)
- ~180MB: Node.js 20 runtime
- ~100MB: Backend source code and plugins
- ~80MB: Built Vue.js frontend
- ~40MB: Alpine Linux base
- ~20MB: Graphics libraries (minimal, no browser)

### Build Commands

**Full Version (with Chromium):**
```bash
# Build for your current platform
docker build -t agnt:latest .

# Build for specific platform
docker build --platform linux/amd64 -t agnt:amd64 .
docker build --platform linux/arm64 -t agnt:arm64 .

# Multi-platform build (requires buildx)
docker buildx build --platform linux/amd64,linux/arm64 -t agnt:latest .
```

**Lite Version (without Chromium):**
```bash
# Build for your current platform
docker build -f Dockerfile.lite -t agnt:lite .

# Build for specific platform
docker build -f Dockerfile.lite --platform linux/amd64 -t agnt:lite-amd64 .
docker build -f Dockerfile.lite --platform linux/arm64 -t agnt:lite-arm64 .

# Multi-platform build (requires buildx)
docker buildx build -f Dockerfile.lite --platform linux/amd64,linux/arm64 -t agnt:lite .
```

### Custom Build

If you need to customize the build process:

```dockerfile
# Example: Using a different Node version
FROM node:20-alpine AS frontend-builder
# ... rest of Dockerfile
```

## Upgrading

To upgrade to a new version:

```bash
# Pull latest code
git pull origin main

# Rebuild the image
docker-compose build

# Restart with new image
docker-compose up -d

# Verify upgrade
docker-compose logs -f
```

Your data persists in Docker volumes and won't be lost during upgrades.

## Backup and Restore

### Backup

```bash
# Backup all volumes
docker run --rm \
  -v agnt-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/agnt-backup-$(date +%Y%m%d).tar.gz /data

# Backup specific volume
docker run --rm \
  -v agnt-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/agnt-data-$(date +%Y%m%d).tar.gz /data
```

### Restore

```bash
# Restore from backup
docker run --rm \
  -v agnt-data:/data \
  -v $(pwd):/backup \
  alpine sh -c "cd / && tar xzf /backup/agnt-backup-20240101.tar.gz"
```

## Troubleshooting

### Container Won't Start

Check logs:
```bash
docker-compose logs agnt
```

Common issues:
- Port 3333 already in use: Change port mapping `-p 3334:3333`
- Insufficient memory: Allocate at least 2GB to Docker
- Permission errors: Check volume mount permissions

### High Memory Usage

AGNT includes AI models and plugins that may consume memory. Adjust Docker's memory limits:

```yaml
services:
  agnt:
    # ... other config
    mem_limit: 4g
    mem_reservation: 2g
```

### Browser/Chromium Issues

If Puppeteer/Playwright features fail:

```bash
# Check if Chromium is installed in container
docker exec -it agnt chromium-browser --version
```

The Dockerfile includes Chromium by default, but you may need to add additional fonts:

```dockerfile
RUN apk add --no-cache \
    font-noto \
    font-noto-emoji
```

### Plugin Installation Fails

Ensure the plugins volume has proper permissions:

```bash
# Check volume
docker volume inspect agnt-plugins

# Reset permissions (if needed)
docker exec -it agnt chown -R node:node /app/backend/plugins/installed
```

### Database Locked

If using SQLite and seeing "database is locked" errors:

```yaml
services:
  agnt:
    # ... other config
    volumes:
      - agnt-data:/app/data:rw  # Ensure read-write access
```

## Security Considerations

### Production Checklist

- ✅ Use strong, randomly generated secrets
- ✅ Enable HTTPS with a reverse proxy
- ✅ Keep Docker and images updated
- ✅ Limit container resources (CPU, memory)
- ✅ Use Docker secrets for sensitive data
- ✅ Run containers as non-root (default in our Dockerfile)
- ✅ Regular backups of data volumes
- ✅ Monitor logs for suspicious activity

### Using Docker Secrets

For enhanced security in Docker Swarm:

```yaml
version: '3.8'

services:
  agnt:
    # ... other config
    secrets:
      - jwt_secret
      - session_secret
    environment:
      - JWT_SECRET_FILE=/run/secrets/jwt_secret
      - SESSION_SECRET_FILE=/run/secrets/session_secret

secrets:
  jwt_secret:
    external: true
  session_secret:
    external: true
```

## Advanced Configuration

### Running Behind a Firewall

If running on a server without direct internet access:

```bash
# Use HTTP proxy
docker run -d \
  -e HTTP_PROXY=http://proxy.example.com:8080 \
  -e HTTPS_PROXY=http://proxy.example.com:8080 \
  agnt:latest
```

### Custom Plugin Directory

Mount a custom plugin directory:

```yaml
volumes:
  - ./my-plugins:/app/backend/plugins/dev
```

### Using External Database

While AGNT uses SQLite by default, you can configure external databases by mounting a custom configuration.

## Performance Tuning

### Node.js Memory Limits

Increase Node.js memory if needed:

```yaml
services:
  agnt:
    environment:
      - NODE_OPTIONS=--max-old-space-size=4096
```

### Build Cache

Speed up builds with BuildKit cache:

```bash
DOCKER_BUILDKIT=1 docker build --cache-from agnt:latest -t agnt:latest .
```

## Support

- **Documentation**: [docs/](./docs/)
- **Issues**: [GitHub Issues](https://github.com/agnt-gg/agnt/issues)
- **Discord**: [Join our community](https://discord.gg/agnt)
- **Website**: [https://agnt.gg](https://agnt.gg)

## License

This project is licensed under a Custom License. See [LICENSE](./LICENSE) for details.
