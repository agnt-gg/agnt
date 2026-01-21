# Docker Full - Quick Start Guide

Get AGNT running with **full browser automation** in under 5 minutes.

## What You Get

- ✅ Complete web application (browser-based UI)
- ✅ Browser automation (Puppeteer/Playwright)
- ✅ Multi-device access
- ✅ Supports 2-10 concurrent users
- 📦 Image size: **~1.5GB**
- 🌐 Port: **33333**

## Prerequisites

- Docker 20.10+ or Docker Desktop (any OS: Windows, macOS, GNU/Linux, FreeBSD, etc.)
- 2GB free RAM
- 2GB free disk space

## Installation

### Option 1: Using Makefile (Recommended)

```bash
# Clone repository
git clone https://github.com/agnt-gg/agnt.git
cd agnt

# Start Docker Full
make run-full
```

### Option 2: Using Docker Compose

```bash
# Clone repository
git clone https://github.com/agnt-gg/agnt.git
cd agnt

# Start container
docker-compose up -d
```

### Option 3: Using Docker Run

```bash
# Pull image
docker pull ghcr.io/agnt-gg/agnt:latest

# Run container
docker run -d \
  --name agnt \
  -p 33333:3333 \
  -v ~/.agnt/data:/app/data \
  -v ~/.agnt/plugins/installed:/app/backend/plugins/installed \
  -v ~/.agnt/logs:/app/logs \
  agnt/agnt:latest
```

## Access AGNT

Open your browser to:

```
http://localhost:33333
```

From other devices on your network:

```
http://YOUR_SERVER_IP:33333
```

## Verify Installation

```bash
# Check container status
docker ps | grep agnt

# View logs
docker logs agnt -f
```

Healthy status should show:
```
STATUS: Up X seconds (healthy)
```

## First Steps

1. **Open web UI**: http://localhost:33333
2. **Configure AI provider**: Add your OpenAI/Anthropic/Google API key
3. **Create first agent**: Click "New Agent" and configure
4. **Test chat**: Send a message to your agent
5. **Explore workflows**: Create automated workflows

## Common Commands

```bash
# Stop AGNT
docker stop agnt

# Start AGNT
docker start agnt

# View logs
docker logs agnt -f

# Restart AGNT
docker restart agnt

# Remove AGNT (keeps data)
docker rm agnt

# Update to latest version
docker pull ghcr.io/agnt-gg/agnt:latest
docker stop agnt
docker rm agnt
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
✅ Web scraping with Puppeteer
✅ Browser automation with Playwright
✅ Screenshot capture
✅ Image processing
✅ Email automation
✅ MCP server support

## Troubleshooting

### Port 33333 already in use

Change port in docker run command:
```bash
-p 3334:3333  # Use port 3334 instead
```

### Container won't start

Check logs:
```bash
docker logs agnt
```

### Can't access from other devices

Ensure firewall allows port 33333:
```bash
# Ubuntu/Debian
sudo ufw allow 33333

# Check if port is open
netstat -tlnp | grep 33333
```

## Next Steps

- [User Guide](USER_GUIDE.md) - Learn how to use AGNT
- [Plugin Development](../backend/plugins/README.md) - Create custom plugins
- [API Documentation](_API-DOCUMENTATION.md) - REST API reference
- [Switch to Lite Mode](QUICKSTART_DOCKER_LITE.md) - Smaller image without browser

## Support

- **Issues**: [GitHub Issues](https://github.com/agnt-gg/agnt/issues)
- **Discord**: [Join community](https://discord.gg/agnt)
- **Documentation**: [Full docs](SELF_HOSTING.md)
