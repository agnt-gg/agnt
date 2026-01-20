# Electron vs Web: How AGNT Works

AGNT runs in **two modes** with the **same codebase**:

1. **Desktop App** (Electron) - Download and install like any app
2. **Web App** (Docker) - Run in your browser from a server

## Who Is This For?

**AGNT is local-first and designed for:**

- **Single users** - Run on your laptop/desktop
- **Families** - Share one Docker backend across household devices
- **Small teams** - 2-10 people in same organization

**NOT designed for:**

- ❌ Multi-tenant SaaS (hundreds of unrelated users)
- ❌ Public hosting (each org should self-host)
- ❌ Large enterprises (50+ concurrent users)

**Why?** AGNT uses SQLite (local database) and real-time sync broadcasts to all connected clients. This is perfect for trusted groups sharing a workspace, but not for isolating thousands of separate users.

**Think of it like:** Notion for teams, not Notion for the entire internet.

## Quick Comparison

| Feature | Desktop (Electron) | Web (Docker) |
|---------|-------------------|--------------|
| **Install** | Download .exe/.dmg/.AppImage | `docker-compose up` |
| **Access** | Local app on your computer | Browser at http://localhost:3333 |
| **Updates** | Auto-checks agnt.gg | Pull new Docker image |
| **Window** | Custom minimize/maximize/close | Browser controls |
| **Backend** | Built-in (starts automatically) | Docker container |
| **Best For** | Personal desktop use | Servers, multi-device, teams |

Both versions use the **exact same frontend and backend code** - just packaged differently.

---

## How Each Mode Works

### Desktop Mode (Electron)

```
┌─────────────────────┐
│  Electron Window    │  ← You see this
│  (Chromium browser) │
└─────────────────────┘
         ↕ talks to
┌─────────────────────┐
│  Backend Server     │  ← Starts automatically
│  (Node.js process)  │     (port 3333)
└─────────────────────┘
```

**What happens:**
- Double-click AGNT icon
- Electron starts the backend server automatically
- Opens a window showing the UI
- Everything runs locally on your machine

**Key files:**
- `main.js` - Starts Electron and backend
- `preload.js` - Secure bridge between UI and system

### Web Mode (Docker)

```
┌─────────────────────┐
│  Your Browser       │  ← You see this
│  (Chrome/Firefox)   │
└─────────────────────┘
         ↕ talks to
┌─────────────────────┐
│  Docker Container   │  ← You start this manually
│  Backend + Frontend │     (port 3333)
└─────────────────────┘
```

**What happens:**
- Run `docker-compose up -d`
- Docker starts the backend server
- Open browser to http://localhost:3333
- Multiple people can connect

**Key files:**
- `docker-compose.yml` - Container configuration
- `Dockerfile` - How to build the image

---

## Code: How We Detect Which Mode

The frontend uses one simple pattern everywhere:

```javascript
// frontend/src/composables/useElectron.js
import { useElectron } from '@/composables/useElectron';

const { isElectron } = useElectron();
```

This checks: Does `window.electron` exist?
- **Desktop**: Yes → `isElectron = true`
- **Web**: No → `isElectron = false`

### Example: Window Controls

```vue
<template>
  <!-- Only show custom window controls in desktop mode -->
  <WindowControls v-if="isElectron" />

  <!-- This shows in both modes -->
  <div class="main-content">
    ...
  </div>
</template>
```

### Example: Get App Version

```javascript
// Try desktop API first, fallback to web API
if (electron?.getAppVersion) {
  version = await electron.getAppVersion();  // Desktop
} else {
  version = await fetch('/api/version');      // Web
}
```

**Pattern**: Always provide a fallback for web mode.

---

## Features That Differ

### Desktop Only

| Feature | Why Desktop Only |
|---------|-----------------|
| Custom window controls | Electron provides window management |
| Auto-updates | Checks agnt.gg for new versions |
| System notifications | Native OS notifications |
| Deep file system access | Can browse entire file system |

### Both Modes

| Feature | Desktop | Web |
|---------|---------|-----|
| Agents | ✅ | ✅ |
| Workflows | ✅ | ✅ |
| Chat | ✅ | ✅ |
| Speech-to-text | ✅ | ✅ (needs HTTPS) |
| Plugins | ✅ | ✅ |
| API | ✅ | ✅ |

**Everything works in both modes** - the core functionality is identical.

---

## Database & Storage

### Where Data Lives

| Mode | Database Location | Persistent? |
|------|------------------|-------------|
| **Desktop** | `~/Library/Application Support/AGNT/Data/agnt.db` (Mac)<br>`%APPDATA%/AGNT/Data/agnt.db` (Windows)<br>`~/.config/AGNT/Data/agnt.db` (Linux) | ✅ Yes |
| **Web (Docker)** | `/app/data/agnt.db` (inside container)<br>Mounted to Docker volume `agnt-db` | ✅ Yes |
| **Development** | `./data/agnt.db` (project root) | ✅ Yes |

All modes use **SQLite** for storage.

---

## Multi-Client / Multi-Device Setup

### Can I use both a browser AND desktop app at the same time?

**Yes!** Run Docker backend, then connect from:
- Your browser: http://localhost:3333
- Desktop app: Configure to use external backend
- Your phone browser: http://your-ip:3333
- Your laptop browser: http://your-ip:3333

### Real-Time Sync

**foxhop added real-time synchronization** so changes appear instantly:

```
Browser 1: Creates an agent
    ↓
Backend: Saves + broadcasts via Socket.IO
    ↓
Browser 2, Desktop App: Instantly see new agent (no refresh!)
```

#### Setup Multi-Client Mode

**1. Enable WAL mode for better concurrency** (optional but recommended):

```yaml
# docker-compose.yml
environment:
  - SQLITE_WAL_MODE=true
```

**2. Start Docker backend:**

```bash
docker-compose up -d
```

**3. Connect from anywhere:**

- Browser: http://localhost:3333
- Desktop: Point to Docker backend (see hybrid setup below)

#### What Gets Synced

- ✅ Agent create/update/delete
- ✅ Workflow create/update/delete
- ✅ Auto-reconnects if network drops

#### Limitations

- ⚠️ Works great for 2-10 users
- ⚠️ Writes are queued (SQLite limitation)
- ⚠️ Not designed for 100+ concurrent users

### Performance: WAL Mode

**Default (WAL disabled):**
- Best for single user
- Simple, reliable

**WAL enabled:**
- Multiple readers at once
- Writes don't block reads
- Better for 2-10 concurrent users
- Slightly more disk I/O

Set `SQLITE_WAL_MODE=true` if you need multi-client support.

---

## Hybrid Setup: Desktop App + Docker Backend

Want desktop app UI with Docker backend? Easy.

**Step 1:** Start Docker backend

```bash
docker-compose up -d
```

**Step 2:** Configure desktop app

```bash
# Set environment variable before starting
USE_EXTERNAL_BACKEND=true npm start
```

**Step 3:** Done! Desktop app connects to Docker backend on port 3333.

**Why would you do this?**
- Shared backend for team
- Easier backend updates
- One source of truth for data

---

## Development

### Desktop Development

```bash
# Terminal 1: Frontend dev server (hot reload)
cd frontend && npm run dev

# Terminal 2: Desktop app
npm start
```

The desktop app loads from http://localhost:5173 (dev server).

### Docker Development

```bash
# Build frontend
cd frontend && npm run build && cd ..

# Start Docker
docker-compose up -d

# View logs
docker-compose logs -f
```

Docker serves the built frontend from `frontend/dist`.

---

## Building for Distribution

### Desktop Installers

```bash
# Build frontend first (REQUIRED)
cd frontend && npm run build && cd ..

# Build desktop installers
npm run build          # Current platform
npm run build:win      # Windows
npm run build:mac      # macOS (x64 + ARM64)
npm run build:linux    # Linux (AppImage, DEB, RPM)
```

Output: `dist/` folder with installers

### Docker Images

```bash
# Build images
make build-full        # With Chromium (~1.3GB)
make build-lite        # Without Chromium (~600MB)

# Push to DockerHub
docker push agnt/agnt:latest
docker push agnt/agnt:lite
```

---

## Common Patterns

### 1. Check if Desktop Mode

```javascript
import { useElectron } from '@/composables/useElectron';
const { isElectron } = useElectron();

if (isElectron) {
  // Desktop-specific code
}
```

### 2. Conditional Rendering

```vue
<WindowControls v-if="isElectron" />
```

### 3. Graceful Fallbacks

```javascript
// Try desktop API → fallback to web API → default value
const data = await electron?.getData()
  || await fetch('/api/data').then(r => r.json())
  || defaultValue;
```

### 4. Always Use Optional Chaining

```javascript
// ✅ Good - won't crash in web mode
electron?.send('event-name');

// ❌ Bad - crashes in web mode
electron.send('event-name');
```

---

## Troubleshooting

### "window.electron is undefined"

You're in web mode. Add a check:

```javascript
if (window.electron) {
  // Desktop-only code
}
```

### Desktop app shows blank screen

Frontend dev server isn't running:

```bash
cd frontend && npm run dev
```

Or build the frontend:

```bash
cd frontend && npm run build
```

### Docker: Native module errors

Rebuild native modules for Alpine Linux:

```dockerfile
RUN npm rebuild sqlite3 sharp
```

### Multi-client sync not working

Check Docker logs:

```bash
docker-compose logs -f | grep "Socket.IO"
```

Should see: `[Socket.IO] Client connected`

---

## Files You Should Know

### Desktop Mode

| File | Purpose |
|------|---------|
| `main.js` | Electron entry point, starts backend |
| `preload.js` | Security bridge for `window.electron` |
| `backend/server.js` | Backend API server |

### Web Mode

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Container config (full version) |
| `docker-compose.lite.yml` | Container config (lite version) |
| `Dockerfile` | How to build full image |
| `Dockerfile.lite` | How to build lite image |

### Shared Code

| File | Purpose |
|------|---------|
| `frontend/src/**` | Vue.js frontend (works in both) |
| `backend/src/**` | Backend API (works in both) |
| `frontend/src/composables/useElectron.js` | Desktop detection |
| `frontend/src/composables/useRealtimeSync.js` | Real-time sync (both modes) |

---

## Summary

**AGNT = One codebase, two modes:**

1. **Desktop (Electron)**: Download, install, done. Best for personal use.
2. **Web (Docker)**: Self-host, access from anywhere. Best for teams/servers.

**Both modes:**
- Use the same Vue.js frontend
- Use the same Express.js backend
- Use the same SQLite database
- Support all the same features

**The only difference:** How they're packaged and started.

**Real-time sync:** foxhop added Socket.IO so multiple clients stay in sync automatically.

**Real-time synchronization by foxhop** - Solves the multi-device problem.

**What works:**
- ✅ Multiple devices connected to one backend
- ✅ Changes sync instantly (no refresh)
- ✅ Agents and workflows stay in sync
- ✅ 2-10 concurrent users supported
- ✅ Simple to use

**foxhop says sorry for the convenience**

For most people, this is exactly what you need.

**Need help?**
- GitHub: https://github.com/anthropics/agnt
- Discord: https://discord.gg/agnt
