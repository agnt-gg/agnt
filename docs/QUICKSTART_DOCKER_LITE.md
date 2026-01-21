# Docker Lite - Quick Start Guide

Get AGNT running **lightweight** (no browser automation) in under 5 minutes.

## What You Get

- ✅ Complete web application (browser-based UI)
- ✅ All core features (AI agents, workflows, plugins)
- ✅ Multi-device access
- ✅ Supports 2-10 concurrent users
- ❌ No browser automation (Puppeteer/Playwright)
- 📦 Image size: **~715MB** (52% smaller than Full)
- 🌐 Port: **3333**

## Prerequisites

- Docker 20.10+ or Docker Desktop
- 1GB free RAM
- 1GB free disk space

## Installation

### Option 1: Using Makefile (Recommended)

```bash
# Clone repository
git clone https://github.com/agnt-gg/agnt.git
cd agnt

# Start Docker Lite
make run-lite
```

### Option 2: Using Docker Compose

```bash
# Clone repository
git clone https://github.com/agnt-gg/agnt.git
cd agnt

# Start container
docker-compose -f docker-compose.lite.yml up -d
```

### Option 3: Using Docker Run

```bash
# Pull image
docker pull agnt/agnt:lite

# Run container
docker run -d \
  --name agnt-lite \
  -p 3333:3333 \
  -e AGNT_LITE_MODE=true \
  -v ~/.agnt/data:/app/data \
  -v ~/.agnt/plugins/installed:/app/backend/plugins/installed \
  -v ~/.agnt/logs:/app/logs \
  agnt/agnt:lite
```

## Access AGNT

Open your browser to:

```
http://localhost:3333
```

From other devices on your network:

```
http://YOUR_SERVER_IP:3333
```

## Verify Installation

```bash
# Check container status
docker ps | grep agnt-lite

# View logs
docker logs agnt-lite -f
```

Healthy status should show:
```
STATUS: Up X seconds (healthy)
```

## First Steps

1. **Open web UI**: http://localhost:3333
2. **Configure AI provider**: Add your OpenAI/Anthropic/Google API key
3. **Create first agent**: Click "New Agent" and configure
4. **Test chat**: Send a message to your agent
5. **Explore workflows**: Create automated workflows

## Common Commands

```bash
# Stop AGNT
docker stop agnt-lite

# Start AGNT
docker start agnt-lite

# View logs
docker logs agnt-lite -f

# Restart AGNT
docker restart agnt-lite

# Remove AGNT (keeps data)
docker rm agnt-lite

# Update to latest version
docker pull agnt/agnt:lite
docker stop agnt-lite
docker rm agnt-lite
# Re-run docker run command above
```

## Data Location

All data stored in:
- **Database**: `~/.agnt/data/agnt.db`
- **Plugins**: `~/.agnt/plugins/installed/`
- **Logs**: `~/.agnt/logs/`

## Features Available

✅ All AI agents and workflows
✅ All API integrations (OpenAI, Anthropic, Google, etc.)
✅ Plugin system
✅ Image processing (non-browser)
✅ Email automation
✅ MCP server support
✅ PDF reading
✅ Data transformations

## Features NOT Available

❌ Web scraping with Puppeteer
❌ Browser automation with Playwright
❌ Screenshot capture via browser
❌ HTML to PDF via browser

**Need these features?** Use [Docker Full](QUICKSTART_DOCKER_FULL.md) instead.

## Troubleshooting

### Port 3333 already in use

Change port in docker run command:
```bash
-p 3334:3333  # Use port 3334 instead
```

### Container won't start

Check logs:
```bash
docker logs agnt-lite
```

### Browser automation tool fails

This is expected - Lite mode doesn't include browser automation.
Tools requiring Puppeteer/Playwright will show error:
```
Browser automation is not available in AGNT Lite Mode
```

Switch to [Docker Full](QUICKSTART_DOCKER_FULL.md) if you need browser features.

### Can't access from other devices

Ensure firewall allows port 3333:
```bash
# Ubuntu/Debian
sudo ufw allow 3333

# Check if port is open
netstat -tlnp | grep 3333
```

## Upgrading to Full

Want browser automation features later?

```bash
# Stop lite container
docker stop agnt-lite
docker rm agnt-lite

# Start full container (uses same data)
docker-compose up -d

# Access on new port
http://localhost:33333
```

Your data is preserved - just change the Docker image!

## Next Steps

- [User Guide](USER_GUIDE.md) - Learn how to use AGNT
- [Plugin Development](../backend/plugins/README.md) - Create custom plugins
- [API Documentation](_API-DOCUMENTATION.md) - REST API reference
- [Upgrade to Full](QUICKSTART_DOCKER_FULL.md) - Get browser automation

## Support

- **Issues**: [GitHub Issues](https://github.com/agnt-gg/agnt/issues)
- **Discord**: [Join community](https://discord.gg/agnt)
- **Documentation**: [Full docs](SELF_HOSTING.md)
