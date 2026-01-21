# AGNT Desktop - Build & Installation Guide

## Prerequisites

### All Platforms

- **Node.js** 18.x or higher
- **npm** 9.x or higher
- **Git** (for cloning the repository)

### Windows

- Windows 10 or higher
- No additional requirements

### macOS

- macOS 10.13 (High Sierra) or higher
- Xcode Command Line Tools: `xcode-select --install`
- For code signing (optional): Apple Developer account

### Linux

- Ubuntu 18.04+ / Debian 10+ / Fedora 30+ or equivalent
- Additional dependencies:

  ```bash
  # Debian/Ubuntu
  sudo apt-get install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libdrm2 libgbm1 libxcb-dri3-0

  # Fedora/RHEL
  sudo dnf install -y gtk3 libnotify nss libXScrnSaver libXtst xdg-utils at-spi2-atk libdrm mesa-libgbm libxcb
  ```

## Installation Steps

### 1. Clone the Repository

```bash
git clone <repository-url>
cd AGNT/product/desktop
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required dependencies including:

- Electron
- Backend dependencies
- Frontend dependencies (via postinstall)

### 3. Build the Frontend

```bash
cd frontend
npm run build
cd ..
```

This creates the production frontend in `frontend/dist/`.

### 4. Configure Environment Variables

```bash
cd backend
cp .env.example .env
```

Edit `.env` and configure:

- Generate new secrets for `JWT_SECRET`, `SESSION_SECRET`, and `ENCRYPTION_KEY`
- Add any API keys you need (OpenAI, Anthropic, etc.)

**Generate secrets:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Building Installers

### Build for Current Platform

```bash
npm run build
```

### Build for Specific Platforms

#### Windows

```bash
npm run build:win
```

Creates:

- `dist/AGNT-0.3.1-win-x64.exe` (NSIS installer)
- `dist/AGNT-0.3.1-win-ia32.exe` (32-bit installer)
- `dist/AGNT-0.3.1-win-x64-portable.exe` (Portable version)

#### macOS

```bash
npm run build:mac
```

Creates:

- `dist/AGNT-0.3.1-mac-x64.dmg` (Intel Macs)
- `dist/AGNT-0.3.1-mac-arm64.dmg` (Apple Silicon)
- `dist/AGNT-0.3.1-mac-x64.zip` (Intel Macs - zip)
- `dist/AGNT-0.3.1-mac-arm64.zip` (Apple Silicon - zip)

**Note:** Building for macOS requires a Mac. For code signing, set these environment variables:

```bash
export CSC_LINK=/path/to/certificate.p12
export CSC_KEY_PASSWORD=your_certificate_password
export APPLE_ID=your@apple.id
export APPLE_ID_PASSWORD=app-specific-password
```

#### Linux

```bash
npm run build:linux
```

Creates:

- `dist/AGNT-0.3.1-linux-x64.AppImage` (Universal Linux)
- `dist/AGNT-0.3.1-linux-x64.deb` (Debian/Ubuntu)
- `dist/AGNT-0.3.1-linux-x64.rpm` (Fedora/RHEL)

### Build for All Platforms

```bash
npm run build:all
```

**Note:** Cross-platform building has limitations:

- Windows → Can build for Windows only
- macOS → Can build for macOS and Linux
- Linux → Can build for Linux and Windows (with Wine)

### Build Lite Mode (Smaller Installers)

AGNT supports building **Lite variants** that exclude browser automation packages for ~50% smaller installers.

**What's removed in Lite:**
- ❌ Puppeteer/Playwright (~80-100MB)
- ❌ Browser automation features
- ❌ Web scraping tools

**What still works:**
- ✅ AI agents and workflows
- ✅ All API integrations
- ✅ Plugins, image processing, email automation

**Build commands:**

```bash
# Build Lite for current platform
npm run build:lite

# Build Lite for specific platforms
npm run build:lite:win      # Windows Lite
npm run build:lite:mac      # macOS Lite (x64 + ARM64)
npm run build:lite:linux    # Linux Lite

# Build Lite for all platforms
npm run build:lite:all

# Build BOTH Full and Lite (recommended for distribution)
npm run build:both          # Current platform
npm run build:both:win      # Windows both
npm run build:both:mac      # macOS both
npm run build:both:linux    # Linux both
```

**Build outputs:**

**Full:**
- `dist/AGNT-0.3.7-win-x64.exe` (~150MB)
- `dist/AGNT-0.3.7-mac-x64.dmg` (~200MB)
- `dist/AGNT-0.3.7-linux-x64.AppImage` (~180MB)

**Lite:**
- `dist/AGNT-Lite-0.3.7-win-x64.exe` (~80MB)
- `dist/AGNT-Lite-0.3.7-mac-x64.dmg` (~120MB)
- `dist/AGNT-Lite-0.3.7-linux-x64.AppImage` (~100MB)

**Using Makefile (recommended):**

```bash
make electron-build-both        # Current platform
make electron-build-win-both    # Windows both
make electron-build-mac-both    # macOS both
make electron-build-linux-both  # Linux both
make electron-build-all-both    # All platforms both
```

See [Electron Lite Mode Guide](ELECTRON_LITE_MODE.md) for complete details.

## Development Mode

### Run in Development

```bash
npm start
```

This will:

1. Start the backend server on port 3333
2. Launch the Electron window
3. Load the frontend from `frontend/dist/`

### Run Backend Only

```bash
npm run dev
```

### Run Frontend Development Server

```bash
cd frontend
npm run dev
```

## Troubleshooting

### Build Fails on Windows

- Ensure you have the latest Windows SDK installed
- Run PowerShell as Administrator
- Try: `npm install --global windows-build-tools`

### Build Fails on macOS

- Install Xcode Command Line Tools: `xcode-select --install`
- Accept Xcode license: `sudo xcodebuild -license accept`
- For code signing errors, remove signing temporarily by editing `package.json`:
  ```json
  "mac": {
    "identity": null
  }
  ```

### Build Fails on Linux

- Install missing dependencies (see Prerequisites)
- For AppImage issues: `sudo apt-get install -y fuse libfuse2`
- For permission errors: `chmod +x dist/*.AppImage`

### Backend Won't Start

- Check that port 3333 is not in use
- Verify `.env` file exists in `backend/` directory
- Check backend logs in the Electron console

### Frontend Not Loading

- Ensure `frontend/dist/` exists and contains built files
- Run `cd frontend && npm run build`
- Check browser console for errors (F12 in Electron)

### FFmpeg Errors

- The app bundles ffmpeg-static automatically
- If issues persist, check `node_modules/ffmpeg-static/` exists
- Platform-specific binaries are selected automatically

## Distribution

### Windows

- Distribute the `.exe` installer or portable version
- Users can install or run directly
- No additional dependencies required

### macOS

- Distribute the `.dmg` file
- Users drag to Applications folder
- For unsigned apps, users must right-click → Open first time
- Consider notarization for better user experience

### Linux

- **AppImage**: Universal, no installation needed
  - Make executable: `chmod +x AGNT-*.AppImage`
  - Run: `./AGNT-*.AppImage`
- **DEB**: For Debian/Ubuntu
  - Install: `sudo dpkg -i AGNT-*.deb`
- **RPM**: For Fedora/RHEL
  - Install: `sudo rpm -i AGNT-*.rpm`

## File Structure

```
product/desktop/
├── main.js                 # Electron main process
├── preload.js             # Preload script
├── package.json           # Project configuration
├── backend/               # Backend server
│   ├── server.js         # Express server
│   ├── .env              # Environment config
│   └── src/              # Backend source
├── frontend/             # Vue.js frontend
│   ├── dist/            # Built frontend (created by build)
│   └── src/             # Frontend source
└── _electron/           # Electron assets
    ├── icon.ico        # Windows icon
    ├── icon.icns       # macOS icon
    ├── icon.png        # Linux icon
    └── entitlements.mac.plist  # macOS entitlements
```

## System Requirements

### Minimum

- **RAM**: 4 GB
- **Storage**: 500 MB free space
- **Display**: 1280x720 resolution

### Recommended

- **RAM**: 8 GB or more
- **Storage**: 1 GB free space
- **Display**: 1920x1080 resolution

## Support

For issues and questions:

- Check the troubleshooting section above
- Review logs in the Electron console
- Check backend logs in terminal/console
- Report bugs with detailed error messages

## License

See LICENSE.md for licensing information.
