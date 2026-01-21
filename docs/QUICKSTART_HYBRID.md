# Hybrid Mode - Quick Start Guide

Run Docker backend with **web browser + native desktop apps** sharing the same data.

## What You Get

- ✅ Docker backend on server (local or remote)
- ✅ Web browser access (any device)
- ✅ Native desktop app access (optional)
- ✅ Mix and match: some use browser, some use native app
- ✅ Shared data for family/team (2-10 users)
- ✅ Maximum flexibility
- 📦 Size: Docker (~1.5GB or 715MB) + optional Electron per user
- 🌐 Ports: **3333** (Lite) or **33333** (Full)

## Prerequisites

**Server (Docker backend):**
- Docker 20.10+ or Docker Desktop (any OS: Windows, macOS, GNU/Linux, FreeBSD, etc.)
- 2GB RAM (Full) or 1GB RAM (Lite)
- 2GB disk (Full) or 1GB disk (Lite)

**Clients (optional Electron apps):**
- Windows 10+, macOS 10.13+, or GNU/Linux
- 200-300MB disk space per client
- Network access to server

## Installation

### Step 1: Choose Docker Backend

**Option A: Full (with browser automation)**
- Image size: ~1.5GB
- Port: 33333
- See: [Docker Full Guide](QUICKSTART_DOCKER_FULL.md)

**Option B: Lite (without browser automation)**
- Image size: ~715MB
- Port: 3333
- See: [Docker Lite Guide](QUICKSTART_DOCKER_LITE.md)

### Step 2: Start Docker Backend

```bash
# Clone repository (on server)
git clone https://github.com/agnt-gg/agnt.git
cd agnt

# Option A: Start Docker Full (port 33333)
make run-full

# Option B: Start Docker Lite (port 3333)
make run-lite
```

### Step 3: Access From Clients

Users can now access AGNT in **three ways**:

#### Access Method 1: Web Browser (Any Device)

**From same network:**
```
http://SERVER_IP:3333    (Lite)
http://SERVER_IP:33333   (Full)
```

**From internet (with port forwarding):**
```
http://your-domain.com:3333
```

#### Access Method 2: Native Desktop App (Optional)

**Option A: Use Electron Full** (~150-200MB)
1. Download from [agnt.gg/downloads](https://agnt.gg/downloads)
2. Install on user's desktop
3. Configure to use external backend:
   ```bash
   USE_EXTERNAL_BACKEND=true
   BACKEND_URL=http://SERVER_IP:3333
   ```
4. Launch AGNT

**Option B: Use Electron Lite** (~80-120MB)
1. Download Lite version
2. Install on user's desktop
3. Configure external backend (same as above)
4. Launch AGNT Lite

#### Access Method 3: Mobile Browser

Any device with a browser:
- Phones
- Tablets
- Chromebooks
- Smart TVs with browser

Just open: `http://SERVER_IP:3333`

## Example Configurations

### Family Setup (3 users)

**Server:** Raspberry Pi / NAS running Docker Lite (715MB)
- Port: 3333
- Always on

**User Access:**
- Dad: Electron Full on Windows desktop (native app)
- Mom: Web browser on MacBook (no install)
- Kid: Web browser on iPad (mobile access)

### Small Team Setup (5 users)

**Server:** Cloud VPS running Docker Full (1.5GB)
- Port: 33333 (or behind reverse proxy)
- Domain: agnt.yourcompany.com

**User Access:**
- 2 developers: Electron Full (native apps, need browser automation)
- 2 designers: Web browser (Chrome/Firefox, no install needed)
- 1 manager: Web browser on phone (mobile access)

### Remote Work Setup (10 users)

**Server:** Local server with Docker Full
- Port: 33333
- VPN access for remote users

**User Access:**
- Office workers: Web browser
- Remote workers: Electron apps (better offline support)
- All share same workflows and agents

## Data Location

**Server (Docker):**
```
~/.agnt/data/agnt.db          # Shared database
~/.agnt/plugins/installed/    # Shared plugins
~/.agnt/logs/                 # Server logs
```

**Clients (Electron):**
- No local data stored
- All data on server
- Client just displays UI

## Real-Time Sync

All users see changes instantly:
- ✅ Create agent → Everyone sees it immediately
- ✅ Update workflow → Syncs to all clients
- ✅ Add plugin → Available to all users
- ✅ No refresh needed (WebSocket sync)

## Common Tasks

### Add New User

**Web browser users:**
1. Give them URL: `http://SERVER_IP:3333`
2. They open in browser
3. Done!

**Native app users:**
1. Send them Electron installer
2. Configure `BACKEND_URL=http://SERVER_IP:3333`
3. Launch app

### Update Backend

```bash
# Stop containers
docker stop agnt

# Pull latest image
docker pull agnt/agnt:latest

# Start with new version
docker start agnt
```

Client apps reconnect automatically!

### Update Client Apps

Electron apps update independently:
1. User gets update notification
2. Downloads new version
3. Restarts app
4. Reconnects to same backend

### Backup Data

```bash
# Backup database (on server)
cp ~/.agnt/data/agnt.db agnt-backup-$(date +%Y%m%d).db

# Or use Docker volume backup
docker run --rm \
  -v ~/.agnt/data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/agnt-backup.tar.gz /data
```

## Troubleshooting

### Can't connect from clients

**Check server is running:**
```bash
docker ps | grep agnt
```

**Check firewall:**
```bash
# Allow port on server
sudo ufw allow 3333
```

**Test connection:**
```bash
# From client machine
curl http://SERVER_IP:3333/api/health
```

Should return: `{"status":"ok"}`

### Slow performance with multiple users

**Enable WAL mode for better concurrency:**

Edit `docker-compose.yml`:
```yaml
environment:
  - SQLITE_WAL_MODE=true
```

Restart:
```bash
docker-compose restart
```

### Electron app won't connect

**Check backend URL:**
```bash
# Should point to server, not localhost
BACKEND_URL=http://SERVER_IP:3333  # Good
BACKEND_URL=http://localhost:3333  # Bad (points to client)
```

### Different users see different data

This shouldn't happen - all users share same database.

**Possible causes:**
1. Users pointing to different backends
2. Multiple backend instances running
3. Database not properly mounted

**Check:**
```bash
# On server, verify one backend running
docker ps | grep agnt

# Verify all users use same URL
```

## Security Considerations

### Exposing to Internet

**Use reverse proxy (recommended):**
```nginx
# Nginx example
server {
    listen 443 ssl;
    server_name agnt.yourdomain.com;

    location / {
        proxy_pass http://localhost:3333;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
```

**Or use VPN:**
- Run Docker backend on private network
- Users connect via VPN (WireGuard, OpenVPN)
- More secure than exposing ports

### User Authentication

AGNT currently doesn't have built-in multi-user auth.

**For trusted groups (family/small team):**
- Share URL with trusted users only
- Use network-level security (VPN, firewall)

**For teams needing auth:**
- Use reverse proxy with authentication (Authelia, nginx auth)
- Or VPN with user credentials

## Performance Tips

### Multiple users (2-10)
- ✅ Use Docker on decent server (4GB+ RAM)
- ✅ Enable WAL mode (better concurrency)
- ✅ SSD storage preferred
- ✅ Good network connection

### Large teams (5-10)
- ✅ Use Docker Full for all features
- ✅ 8GB+ RAM on server
- ✅ Consider dedicated server
- ✅ Monitor CPU/RAM usage

### Remote access
- ✅ Use Electron apps for better offline support
- ✅ Web browser for occasional access
- ✅ VPN for security
- ✅ Good internet connection

## Next Steps

- [Docker Full Guide](QUICKSTART_DOCKER_FULL.md) - Setup backend
- [Electron Full Guide](QUICKSTART_ELECTRON_FULL.md) - Install native apps
- [Electron Lite Guide](QUICKSTART_ELECTRON_LITE.md) - Smaller client apps
- [Self-Hosting Guide](SELF_HOSTING.md) - Advanced configuration

## Support

- **Issues**: [GitHub Issues](https://github.com/agnt-gg/agnt/issues)
- **Discord**: [Join community](https://discord.gg/agnt)
- **Documentation**: [Full docs](SELF_HOSTING.md)
