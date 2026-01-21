# AGNT Makefile Guide

Complete reference for building, deploying, and managing AGNT Docker images using the Makefile.

## Quick Start

```bash
# Show all available commands
make help

# Build from scratch (full version with Chromium)
make build-full

# Build from scratch (lite version without Chromium)
make build-lite

# Pull from DockerHub (full version)
make pull-full

# Pull from DockerHub (lite version)
make pull-lite

# Run locally built image
make run-full-local

# Run image from DockerHub
make run-full-remote
```

## Image Variants

AGNT provides two Docker image variants:

| Variant | Size    | Browser Support | Use Case                                      |
| ------- | ------- | --------------- | --------------------------------------------- |
| **Full** | ~1.5GB  | ✅ Yes (Chromium)| Full-featured deployments, web scraping       |
| **Lite** | ~715MB  | ❌ No           | Cloud deployments, 52% smaller footprint      |

## Configuration

Set your DockerHub username (default: `agnt`):

```bash
# Option 1: Set environment variable
export DOCKERHUB_USER=yourname
make build-full

# Option 2: Inline with make command
make DOCKERHUB_USER=yourname build-full
```

## Core Commands

### Building Images Locally

```bash
# Build full image (with Chromium)
make build-full
# Creates tags:
#   yourname/agnt:latest
#   yourname/agnt:0.3.7

# Build lite image (without Chromium)
make build-lite
# Creates tags:
#   yourname/agnt:lite
#   yourname/agnt:0.3.7-lite

# Build both variants
make build-all
```

### Multi-Architecture Builds

Build for both `amd64` (Intel/AMD) and `arm64` (Apple Silicon/ARM):

```bash
# Full image for multiple architectures
make build-full-multiarch

# Lite image for multiple architectures
make build-lite-multiarch

# Note: Requires Docker Buildx and pushes directly to DockerHub
```

### Pulling from DockerHub

```bash
# Pull latest full image
make pull-full

# Pull latest lite image
make pull-lite

# Pull both images
make pull-all

# Pull specific version
make pull-version-full    # Pulls version from package.json
make pull-version-lite
```

### Running Containers

```bash
# Build and run full image locally (port 33333)
make run-full-local

# Build and run lite image locally (port 3333)
make run-lite-local

# Pull and run full image from DockerHub
make run-full-remote

# Pull and run lite image from DockerHub
make run-lite-remote

# Run both versions simultaneously
make run-both              # Uses existing images
make run-both-local        # Build and run both
make run-both-remote       # Pull and run both

# Just start containers (assumes images exist)
make run-full              # Full only on port 33333
make run-lite              # Lite only on port 3333
```

After running:
- **Full**: http://localhost:33333
- **Lite**: http://localhost:3333

### Managing Running Containers

```bash
# Stop containers
make stop           # Stop all AGNT containers
make stop-both      # Stop both containers specifically

# Restart containers
make restart-full   # Restart full image
make restart-lite   # Restart lite image
make restart-both   # Restart both images

# View logs
make logs-full      # Full image logs
make logs-lite      # Lite image logs
make logs-both      # Both images logs

# Check container status
make status

# Open shell in running container
make shell-full     # Full image
make shell-lite     # Lite image
```

### Pushing to DockerHub

```bash
# Push full image
make push-full

# Push lite image
make push-lite

# Push both images
make push-all

# Note: You must be logged in: docker login
```

## Common Workflows

### Development Workflow

```bash
# 1. Setup development environment
make dev-setup

# 2. Build frontend
make build-frontend

# 3. Build and test Docker image
make build-full
make test-full

# 4. Run locally
make run-full-local

# 5. View logs
make logs-full

# 6. Stop when done
make stop
```

### Deployment Workflow (DockerHub)

```bash
# 1. Build images locally
make build-all

# 2. Test images
make test-full
make test-lite

# 3. Push to DockerHub
docker login
make push-all

# 4. Verify on DockerHub
# Visit: https://hub.docker.com/r/yourname/agnt
```

### Production Server Workflow

```bash
# 1. Pull latest image
make pull-full

# 2. Start AGNT
make run-full

# 3. Check status
make status

# 4. View logs
make logs-full
```

### Update to New Version

```bash
# 1. Stop running containers
make stop

# 2. Pull latest image
make pull-full

# 3. Start with new version
make run-full

# 4. Verify health
make status
```

## Cleanup & Maintenance

```bash
# Stop and remove images
make clean

# Remove ALL data (WARNING: destructive!)
make clean-volumes

# Clean up unused Docker resources
make prune
```

⚠️ **Warning**: `make clean-volumes` will delete all AGNT data, plugins, and logs!

## Utility Commands

```bash
# Show build information
make info

# Show current version
make version

# Inspect full image details
make inspect-full

# Inspect lite image details
make inspect-lite

# Test image health
make test-full
make test-lite
```

## Environment Variables

| Variable          | Default | Description                        |
| ----------------- | ------- | ---------------------------------- |
| `DOCKERHUB_USER`  | `agnt`  | DockerHub username/organization    |
| `VERSION`         | Auto    | Extracted from package.json        |

## Examples

### Build for Personal DockerHub

```bash
make DOCKERHUB_USER=johndoe build-full
# Creates: johndoe/agnt:latest
```

### Quick Test & Deploy

```bash
# Build, test, and push in one go
make build-full && make test-full && make push-full
```

### Switch Between Variants

```bash
# Run full version
make run-full

# Stop it
make stop

# Run lite version instead
make run-lite
```

### Development with Live Reload

For development with hot reload, use npm directly:

```bash
# Terminal 1: Frontend dev server
cd frontend && npm run dev

# Terminal 2: Electron app
npm start
```

For production Docker testing:

```bash
make build-full
make run-full-local
```

## Troubleshooting

### "docker: command not found"

Install Docker:
- **Ubuntu/Debian**: `sudo apt install docker.io docker-compose`
- **macOS**: Install [Docker Desktop](https://www.docker.com/products/docker-desktop)
- **Windows**: Install [Docker Desktop](https://www.docker.com/products/docker-desktop)

### "permission denied" errors

Add user to docker group:
```bash
sudo usermod -aG docker $USER
newgrp docker
```

### Multi-arch build fails

Ensure Docker Buildx is set up:
```bash
docker buildx create --use
docker buildx inspect --bootstrap
```

### Image won't start

Check logs:
```bash
make logs-full    # or logs-lite
```

Verify health:
```bash
make status
docker ps -a
```

### Port 3333 already in use

Change port in docker-compose.yml:
```yaml
ports:
  - "3334:3333"  # Use 3334 instead
```

### Can't push to DockerHub

Login first:
```bash
docker login
# Enter username and access token (not password!)
```

## Docker Compose Direct Usage

If you prefer docker-compose directly:

```bash
# Full version (port 33333)
docker-compose up -d
docker-compose down
docker-compose logs -f

# Lite version (port 3333)
docker-compose -f docker-compose.lite.yml up -d
docker-compose -f docker-compose.lite.yml down
docker-compose -f docker-compose.lite.yml logs -f

# Both versions simultaneously
docker-compose -f docker-compose.both.yml up -d
docker-compose -f docker-compose.both.yml down
docker-compose -f docker-compose.both.yml logs -f
```

### Available Docker Compose Files

| File | Description | Port(s) |
|------|-------------|---------|
| `docker-compose.yml` | Full version with Chromium | 33333 |
| `docker-compose.lite.yml` | Lite version without Chromium | 3333 |
| `docker-compose.both.yml` | Both versions simultaneously | 33333 & 3333 |

## Electron Desktop Builds

AGNT also supports building desktop installers with Full and Lite variants.

### Desktop Build Variants

| Variant | Size | Browser Automation | Use Case |
|---------|------|-------------------|----------|
| **Full** | ~150-200MB | ✅ Yes (Puppeteer/Playwright) | Full-featured desktop app |
| **Lite** | ~80-120MB | ❌ No | Smaller downloads, faster installs |

**Size reduction**: ~50% smaller Lite builds across all platforms.

### Building Desktop Installers

```bash
# Show Electron build information
make electron-info

# Build frontend first (required)
make build-frontend

# Build for current platform
make electron-build-full      # Full version
make electron-build-lite      # Lite version
make electron-build-both      # Both variants

# Build for specific platforms
make electron-build-win-full         # Windows Full
make electron-build-win-lite         # Windows Lite
make electron-build-win-both         # Windows both variants

make electron-build-mac-full         # macOS Full (x64 + ARM64)
make electron-build-mac-lite         # macOS Lite (x64 + ARM64)
make electron-build-mac-both         # macOS both variants

make electron-build-linux-full       # Linux Full (AppImage, DEB, RPM)
make electron-build-linux-lite       # Linux Lite (AppImage, DEB, RPM)
make electron-build-linux-both       # Linux both variants

# Build for all platforms (takes a while!)
make electron-build-all-full         # All platforms Full
make electron-build-all-lite         # All platforms Lite
make electron-build-all-both         # All platforms both variants
```

### Build Outputs

Installers are saved to `dist/` directory:

**Full Version:**
- `dist/AGNT-0.3.7-win-x64.exe` (~150MB)
- `dist/AGNT-0.3.7-mac-x64.dmg` (~200MB)
- `dist/AGNT-0.3.7-mac-arm64.dmg` (~200MB)
- `dist/AGNT-0.3.7-linux-x64.AppImage` (~180MB)
- Plus `.deb` and `.rpm` packages for Linux

**Lite Version:**
- `dist/AGNT-Lite-0.3.7-win-x64.exe` (~80MB)
- `dist/AGNT-Lite-0.3.7-mac-x64.dmg` (~120MB)
- `dist/AGNT-Lite-0.3.7-mac-arm64.dmg` (~120MB)
- `dist/AGNT-Lite-0.3.7-linux-x64.AppImage` (~100MB)
- Plus `.deb` and `.rpm` packages for Linux

### Desktop Build Workflow

**For Testing:**
```bash
# 1. Build frontend
make build-frontend

# 2. Build for current platform
make electron-build-both

# 3. Test the installers
# Install from dist/ and verify functionality
```

**For Release:**
```bash
# 1. Ensure clean state
git status

# 2. Build frontend
make build-frontend

# 3. Build all platforms (takes 15-30 minutes)
make electron-build-all-both

# 4. Verify outputs
ls -lh dist/

# 5. Test installers on each platform
# Windows: Run .exe
# macOS: Open .dmg
# Linux: Run .AppImage

# 6. Upload to release server/GitHub Releases
```

### What's Different in Lite Mode?

**Lite Mode removes:**
- ❌ Puppeteer/Playwright packages (~80-100MB)
- ❌ Browser automation capabilities
- ❌ Web scraping tools
- ❌ Screenshot capture via browser
- ❌ HTML to PDF conversion via browser

**Everything else works:**
- ✅ AI agents and workflows
- ✅ All API integrations (OpenAI, Anthropic, Google, etc.)
- ✅ Plugin system
- ✅ Image processing (Sharp, non-browser)
- ✅ Email automation
- ✅ MCP server support
- ✅ All other built-in tools

See [Electron Lite Mode Guide](ELECTRON_LITE_MODE.md) for complete details.

## Advanced Usage

### Custom Build Args

Edit Makefile to add custom build arguments:

```makefile
docker build \
    --build-arg NODE_ENV=production \
    --build-arg CUSTOM_VAR=value \
    -t $(FULL_TAG_LATEST) \
    .
```

### Network Configuration

To connect AGNT to other services:

```bash
# Create custom network
docker network create agnt-network

# Update docker-compose.yml
networks:
  default:
    external:
      name: agnt-network
```

### Volume Backups

Backup your AGNT data:

```bash
# Backup volumes
docker run --rm \
  -v agnt-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/agnt-backup.tar.gz /data

# Restore volumes
docker run --rm \
  -v agnt-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/agnt-backup.tar.gz -C /
```

## Integration with CI/CD

### GitHub Actions

The Makefile integrates with GitHub Actions (see `.github/workflows/docker-publish.yml`):

```yaml
- name: Build images
  run: |
    make build-all
    make test-full
    make test-lite

- name: Push to DockerHub
  run: make push-all
```

### GitLab CI

```yaml
build:
  script:
    - make build-full
    - make test-full
    - make push-full
```

## Best Practices

1. **Use Lite for Cloud**: Smaller images = faster deployments and lower costs
2. **Use Full for Self-Hosted**: Get all features including browser automation
3. **Tag Versions**: Always tag production builds with version numbers
4. **Test Before Push**: Run `make test-full` before pushing to DockerHub
5. **Clean Regularly**: Run `make prune` periodically to free disk space
6. **Backup Volumes**: Backup `agnt-data` volume before major updates

## Resources

- [Dockerfile](../Dockerfile) - Full image build
- [Dockerfile.lite](../Dockerfile.lite) - Lite image build
- [docker-compose.yml](../docker-compose.yml) - Full compose config
- [docker-compose.lite.yml](../docker-compose.lite.yml) - Lite compose config
- [Self-Hosting Guide](SELF_HOSTING.md) - Complete deployment guide
- [DockerHub Setup](DOCKERHUB_SETUP.md) - CI/CD configuration

## Support

For issues or questions:
- [GitHub Issues](https://github.com/nathanw/agnt/issues)
- [Discord](https://discord.gg/agnt)
- [Documentation](https://agnt.gg/docs)

---

**Last Updated**: 2026-01-20
**AGNT Version**: 0.3.7
