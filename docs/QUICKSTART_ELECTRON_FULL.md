# Electron Full - Quick Start Guide

Get AGNT **native desktop app with browser automation** in under 5 minutes.

## What You Get

- ✅ Native desktop application (Windows/macOS/Linux)
- ✅ Browser automation (Puppeteer/Playwright)
- ✅ Single-device, single-user
- ✅ System tray integration
- ✅ Auto-updates
- 📦 Installer size: **~150-200MB**
- 💻 Platform: **Windows, macOS, Linux**

## Prerequisites

- Windows 10+, macOS 10.13+, or Linux (Ubuntu 18.04+)
- 300MB free disk space
- 2GB free RAM

## Installation

### Option 1: Download Pre-built Installer (Recommended)

**Visit:** [agnt.gg/downloads](https://agnt.gg/downloads)

**Windows:**
1. Download `AGNT-0.3.7-win-x64.exe`
2. Run installer
3. Follow setup wizard
4. Launch AGNT from Start Menu or Desktop

**macOS:**
1. Download `AGNT-0.3.7-mac-x64.dmg` (Intel) or `AGNT-0.3.7-mac-arm64.dmg` (Apple Silicon)
2. Open DMG file
3. Drag AGNT to Applications folder
4. Launch from Applications

**Linux:**
1. Download `AGNT-0.3.7-linux-x64.AppImage`
2. Make executable: `chmod +x AGNT-*.AppImage`
3. Run: `./AGNT-*.AppImage`

Or install DEB/RPM:
```bash
# Debian/Ubuntu
sudo dpkg -i AGNT-0.3.7-amd64.deb

# Fedora/RHEL
sudo rpm -i AGNT-0.3.7.x86_64.rpm
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

# Build Electron (current platform)
npm run build

# Find installer in dist/ folder
```

## First Run

1. **Launch AGNT** from your applications menu
2. **Backend starts automatically** (no manual setup needed)
3. **Configure AI provider**: Add your API key
4. **Create first agent**: Click "New Agent"
5. **Start chatting**: Test your agent

## Data Location

All data stored locally:

**Windows:**
```
%APPDATA%\AGNT\Data\agnt.db
%APPDATA%\AGNT\Plugins\
%APPDATA%\AGNT\Logs\
```

**macOS:**
```
~/Library/Application Support/AGNT/Data/agnt.db
~/Library/Application Support/AGNT/Plugins/
~/Library/Application Support/AGNT/Logs/
```

**Linux:**
```
~/.config/AGNT/Data/agnt.db
~/.config/AGNT/Plugins/
~/.config/AGNT/Logs/
```

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
✅ System tray integration
✅ Auto-updates
✅ Native notifications

## Common Tasks

### Update AGNT

Updates check automatically on startup. When available:
1. Notification appears
2. Click "Download Update"
3. Restart app to apply

Or download latest installer from [agnt.gg/downloads](https://agnt.gg/downloads).

### Uninstall AGNT

**Windows:**
1. Settings → Apps → AGNT → Uninstall
2. Or run: `%LOCALAPPDATA%\AGNT\Uninstall.exe`

**macOS:**
1. Drag AGNT from Applications to Trash
2. Delete data: `~/Library/Application Support/AGNT`

**Linux (AppImage):**
1. Delete the AppImage file
2. Delete data: `~/.config/AGNT`

**Linux (DEB/RPM):**
```bash
# Debian/Ubuntu
sudo apt remove agnt

# Fedora/RHEL
sudo rpm -e agnt
```

### Backup Your Data

```bash
# Windows
copy %APPDATA%\AGNT\Data\agnt.db backup.db

# macOS/Linux
cp ~/Library/Application\ Support/AGNT/Data/agnt.db backup.db
```

## Troubleshooting

### App won't start

**Check logs:**
- Windows: `%APPDATA%\AGNT\Logs\`
- macOS: `~/Library/Logs/AGNT/`
- Linux: `~/.config/AGNT/Logs/`

**Common fixes:**
1. Restart your computer
2. Reinstall AGNT
3. Delete data folder (backs up first!)

### Port 3333 already in use

Another app is using the backend port. Close conflicting app or change AGNT port:
1. Close AGNT
2. Edit config file (in data directory)
3. Change port number
4. Restart AGNT

### macOS: "App is damaged and can't be opened"

macOS Gatekeeper blocking unsigned app:
```bash
xattr -cr /Applications/AGNT.app
```

### Linux: Missing dependencies

Install required libraries:
```bash
# Ubuntu/Debian
sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils

# Fedora
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst xdg-utils
```

## Switching to Lite Mode

Want a smaller install without browser automation?

1. Uninstall Electron Full
2. Download and install [Electron Lite](QUICKSTART_ELECTRON_LITE.md)
3. Your data is separate - backup first if needed

## Connecting to Remote Backend (Hybrid Mode)

Want to use native app with shared Docker backend?

1. Start Docker backend on server: [Docker Full Guide](QUICKSTART_DOCKER_FULL.md)
2. Set environment variable:
   ```bash
   USE_EXTERNAL_BACKEND=true
   BACKEND_URL=http://server-ip:3333
   ```
3. Launch AGNT

See [Hybrid Mode Guide](QUICKSTART_HYBRID.md) for details.

## Next Steps

- [User Guide](USER_GUIDE.md) - Learn how to use AGNT
- [Plugin Development](../backend/plugins/README.md) - Create custom plugins
- [Keyboard Shortcuts](KEYBOARD_SHORTCUTS.md) - Speed up your workflow
- [Electron Lite](QUICKSTART_ELECTRON_LITE.md) - Smaller desktop install

## Support

- **Issues**: [GitHub Issues](https://github.com/agnt-gg/agnt/issues)
- **Discord**: [Join community](https://discord.gg/agnt)
- **Documentation**: [Full docs](SELF_HOSTING.md)
