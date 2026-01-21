# Electron Lite - Quick Start Guide

Get AGNT **lightweight native desktop app** (no browser automation) in under 5 minutes.

## What You Get

- ✅ Native desktop application (Windows/macOS/GNU/Linux)
- ✅ All core features (AI agents, workflows, plugins)
- ✅ Single-device, single-user
- ✅ System tray integration
- ✅ Auto-updates
- ❌ No browser automation (Puppeteer/Playwright)
- 📦 Installer size: **~80-120MB** (50% smaller than Full)
- 💻 Platform: **Windows, macOS, GNU/Linux**

## Prerequisites

- Windows 10+, macOS 10.13+, or GNU/Linux (Ubuntu 18.04+)
- 200MB free disk space
- 1GB free RAM

## Installation

### Option 1: Download Pre-built Installer (Recommended)

**Visit:** [agnt.gg/downloads](https://agnt.gg/downloads)

**Windows:**
1. Download `AGNT-Lite-0.3.7-win-x64.exe`
2. Run installer
3. Follow setup wizard
4. Launch AGNT Lite from Start Menu or Desktop

**macOS:**
1. Download `AGNT-Lite-0.3.7-mac-x64.dmg` (Intel) or `AGNT-Lite-0.3.7-mac-arm64.dmg` (Apple Silicon)
2. Open DMG file
3. Drag AGNT Lite to Applications folder
4. Launch from Applications

**GNU/Linux:**
1. Download `AGNT-Lite-0.3.7-linux-x64.AppImage`
2. Make executable: `chmod +x AGNT-Lite-*.AppImage`
3. Run: `./AGNT-Lite-*.AppImage`

Or install DEB/RPM:
```bash
# Debian/Ubuntu
sudo dpkg -i AGNT-Lite-0.3.7-amd64.deb

# Fedora/RHEL
sudo rpm -i AGNT-Lite-0.3.7.x86_64.rpm
```

### Option 2: Build from Source

```bash
# Clone repository
git clone https://github.com/agnt-gg/agnt.git
cd agnt

# Install dependencies
npm install
cd frontend && npm install && cd ..

# Build frontend
cd frontend && npm run build && cd ..

# Build Electron Lite (current platform)
npm run build:lite

# Find installer in dist/ folder
```

## First Run

1. **Launch AGNT Lite** from your applications menu
2. **Backend starts automatically** (no manual setup needed)
3. **Configure AI provider**: Add your API key
4. **Create first agent**: Click "New Agent"
5. **Start chatting**: Test your agent

## Data Location

All data stored in home directory (unified across all platforms):

**Windows:**
```
C:\Users\YourName\.agnt\data\agnt.db
C:\Users\YourName\.agnt\plugins\installed\
C:\Users\YourName\.agnt\logs\

Or using environment variable: %USERPROFILE%\.agnt\data\
```

**macOS:**
```
~/.agnt/data/agnt.db
~/.agnt/plugins/installed/
~/.agnt/logs/
```

**GNU/Linux:**
```
~/.agnt/data/agnt.db
~/.agnt/plugins/installed/
~/.agnt/logs/
```

**Note:** Unified path across all platforms ensures Hybrid Mode (Docker + Electron) can share the same data.

## Features Available

✅ All AI agents and workflows
✅ All API integrations (OpenAI, Anthropic, Google, etc.)
✅ Plugin system
✅ Image processing (non-browser)
✅ Email automation
✅ MCP server support
✅ System tray integration
✅ Auto-updates
✅ Native notifications
✅ PDF reading
✅ Data transformations

## Features NOT Available

❌ Web scraping with Puppeteer
❌ Browser automation with Playwright
❌ Screenshot capture via browser
❌ HTML to PDF via browser

**Need these features?** Use [Electron Full](QUICKSTART_ELECTRON_FULL.md) instead.

## Common Tasks

### Update AGNT

Updates check automatically on startup. When available:
1. Notification appears
2. Click "Download Update"
3. Restart app to apply

Or download latest installer from [agnt.gg/downloads](https://agnt.gg/downloads).

### Uninstall AGNT

**Windows:**
1. Settings → Apps → AGNT Lite → Uninstall
2. Or run: `%LOCALAPPDATA%\AGNT\Uninstall.exe`

**macOS:**
1. Drag AGNT Lite from Applications to Trash
2. Delete data: `~/Library/Application Support/AGNT`

**GNU/Linux (AppImage):**
1. Delete the AppImage file
2. Delete data: `~/.config/AGNT`

**GNU/Linux (DEB/RPM):**
```bash
# Debian/Ubuntu
sudo apt remove agnt-lite

# Fedora/RHEL
sudo rpm -e agnt-lite
```

### Backup Your Data

```bash
# Windows
copy %APPDATA%\AGNT\Data\agnt.db backup.db

# macOS/GNU/Linux
cp ~/Library/Application\ Support/AGNT/Data/agnt.db backup.db
```

## Troubleshooting

### App won't start

**Check logs:**
- Windows: `%APPDATA%\AGNT\Logs\`
- macOS: `~/Library/Logs/AGNT/`
- GNU/Linux: `~/.config/AGNT/Logs/`

**Common fixes:**
1. Restart your computer
2. Reinstall AGNT Lite
3. Delete data folder (backs up first!)

### Browser automation tool fails

This is expected - Lite mode doesn't include browser automation.
Tools requiring Puppeteer/Playwright will show error:
```
Browser automation is not available in AGNT Lite Mode
```

Upgrade to [Electron Full](QUICKSTART_ELECTRON_FULL.md) if you need browser features.

### macOS: "App is damaged and can't be opened"

macOS Gatekeeper blocking unsigned app:
```bash
xattr -cr /Applications/AGNT\ Lite.app
```

### GNU/Linux: Missing dependencies

Install required libraries:
```bash
# Ubuntu/Debian
sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils

# Fedora
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst xdg-utils
```

## Upgrading to Full

Want browser automation features?

1. Uninstall Electron Lite
2. Download and install [Electron Full](QUICKSTART_ELECTRON_FULL.md)
3. Your data is in the same location - it will be preserved!

## Connecting to Remote Backend (Hybrid Mode)

Want to use native app with shared Docker backend?

1. Start Docker backend on server: [Docker Lite Guide](QUICKSTART_DOCKER_LITE.md)
2. Set environment variable:
   ```bash
   USE_EXTERNAL_BACKEND=true
   BACKEND_URL=http://server-ip:3333
   ```
3. Launch AGNT Lite

See [Hybrid Mode Guide](QUICKSTART_HYBRID.md) for details.

## Next Steps

- [User Guide](USER_GUIDE.md) - Learn how to use AGNT
- [Plugin Development](../backend/plugins/README.md) - Create custom plugins
- [Keyboard Shortcuts](KEYBOARD_SHORTCUTS.md) - Speed up your workflow
- [Electron Full](QUICKSTART_ELECTRON_FULL.md) - Get browser automation

## Support

- **Issues**: [GitHub Issues](https://github.com/agnt-gg/agnt/issues)
- **Discord**: [Join community](https://discord.gg/agnt)
- **Documentation**: [Full docs](SELF_HOSTING.md)
