# Electron Lite Mode - Building Smaller Desktop Apps

AGNT supports building two Electron variants:

1. **AGNT Full** (~348MB AppImage / ~253MB DEB) - Includes all features including browser automation
2. **AGNT Lite** (~344MB AppImage / ~251MB DEB) - Excludes browser automation packages for smaller size

## Why Lite Mode?

**Desktop apps have TWO Chromiums:**
- **Electron's Chromium** - The app UI itself (can't be removed)
- **Puppeteer/Playwright Chromium** - For browser automation tools (already excluded from builds)

**Lite Mode removes the browser automation libraries** (puppeteer, playwright, and their dependencies), saving ~16MB uncompressed. The Chromium binaries used by these tools are already excluded from all builds by the `files` filter in `package.json`.

## Size Comparison

Measured on v0.4.9 (GNU/Linux, March 2025):

| Platform | Full | Lite | Savings |
|----------|------|------|---------|
| **GNU/Linux (AppImage)** | 348MB | 344MB | ~4MB (1.2%) |
| **GNU/Linux (DEB)** | 253MB | 251MB | ~2MB (0.9%) |

> **Note:** Chromium browser binaries are already excluded from both variants by the build config. Lite mode removes the browser automation **source code and libraries** (~16MB uncompressed), which compresses down to ~2-4MB in the final installers. The savings are modest because the large browser binaries were never bundled.

## What's Disabled in Lite Mode

❌ **Browser Automation Features:**
- Web scraping with Puppeteer/Playwright
- Screenshot capture via headless browser
- HTML to PDF conversion via browser
- Browser-based form automation
- AI Browser Use tool

✅ **Everything Else Works:**
- AI agents and workflows
- All API integrations
- Plugin system
- Image processing (non-browser)
- PDF reading
- Email automation
- MCP servers
- All other built-in tools

## Building Lite Mode

### Quick Start

```bash
# Build frontend first (REQUIRED)
cd frontend && npm run build && cd ..

# Build Lite variant for current platform
npm run build:lite

# Build Lite for specific platforms
npm run build:lite:win      # Windows
npm run build:lite:mac      # macOS (x64 + ARM64)
npm run build:lite:linux    # GNU/Linux (AppImage, DEB, RPM)
npm run build:lite:all      # All platforms

# Build BOTH Full and Lite (recommended)
npm run build:both
npm run build:both:win
npm run build:both:mac
npm run build:both:linux
```

### Build Outputs

**Full Version:**
- `dist/AGNT-0.4.9-win-x64.exe`
- `dist/AGNT-0.4.9-mac-x64.dmg`
- `dist/AGNT-0.4.9-linux-x86_64.AppImage` (348MB)
- `dist/AGNT-0.4.9-linux-amd64.deb` (253MB)

**Lite Version:**
- `dist/AGNT-Lite-0.4.9-win-x64.exe`
- `dist/AGNT-Lite-0.4.9-mac-x64.dmg`
- `dist/AGNT-Lite-0.4.9-linux-x86_64.AppImage` (344MB)
- `dist/AGNT-Lite-0.4.9-linux-amd64.deb` (251MB)

Notice the **"-Lite"** suffix in filenames.

## How It Works

### 1. Optional Dependencies

Puppeteer/Playwright are marked as `optionalDependencies` in `package.json`:

```json
"optionalDependencies": {
  "playwright": "^1.56.0",
  "puppeteer": "^24.10.2",
  "puppeteer-extra": "^3.3.6",
  "puppeteer-extra-plugin-stealth": "^2.11.2"
}
```

This allows npm to skip them during installation if they fail, but they're still included in Full builds.

### 2. Build-Time Exclusion

The `scripts/electron-builder-lite.js` hook runs during the build process:

```javascript
// When AGNT_BUILD_VARIANT=-Lite is set
export async function afterPack(context) {
  if (isLiteBuild) {
    // Remove browser automation packages
    removePackage('puppeteer');
    removePackage('playwright');
    // ... etc
  }
}
```

This removes the packages **after** the app is packaged but **before** the installer is created.

### 3. Runtime Detection

`main.js` detects Lite builds automatically:

```javascript
// Check for .agnt-lite-mode marker file
const isLiteBuild = fs.existsSync('.agnt-lite-mode');

if (isLiteBuild) {
  process.env.AGNT_LITE_MODE = 'true';
}
```

The backend then uses `liteModeHelper.js` to gracefully handle missing browser features.

### 4. Graceful Degradation

When browser automation tools are called in Lite mode:

```javascript
import { isLiteMode, getLiteModeError } from './utils/liteModeHelper.js';

if (isLiteMode()) {
  return getLiteModeError('Web scraping');
}
```

Users see a helpful error message:

```
Web scraping is not available in AGNT Lite Mode.

Browser automation features (Puppeteer/Playwright) are disabled in the Lite version.

To use this feature:
1. Download the full AGNT installer from https://agnt.gg/downloads
2. Or use the Docker full image: docker-compose up -d

Learn more: https://agnt.gg/docs/lite-mode
```

## Testing Lite Mode

### Test Without Building

Run the app in Lite mode without building an installer:

```bash
npm run start:lite
```

This sets `AGNT_LITE_MODE=true` and starts Electron normally.

### Verify Lite Build

After building, check the installer:

1. **File size** - Should be ~2-4MB smaller than Full (browser automation libs removed)
2. **Marker file** - Extract the app and check for `.agnt-lite-mode`
3. **Browser tools** - Try web scraping → should show Lite mode error

## Development

### Working on Lite Mode Features

```bash
# Start backend in lite mode
AGNT_LITE_MODE=true node backend/server.js

# Start Electron in lite mode
npm run start:lite
```

### Adding New Browser-Dependent Features

When adding features that require browser automation:

1. **Check lite mode** before using Puppeteer/Playwright:

```javascript
import { isLiteMode, getLiteModeError } from './utils/liteModeHelper.js';

async function myBrowserFeature() {
  if (isLiteMode()) {
    return getLiteModeError('My feature');
  }

  // Use Puppeteer/Playwright here
}
```

2. **Update `liteModeHelper.js`** if needed:

```javascript
export function requiresBrowser(featureName) {
  const browserFeatures = [
    'puppeteer',
    'playwright',
    'web-scraper',
    'my-new-feature'  // Add here
  ];
  // ...
}
```

## Distribution Strategy

### Recommended: Offer Both Variants

**Download page example:**

```
┌─────────────────────────────────────┐
│ Download AGNT for Windows           │
├─────────────────────────────────────┤
│ ⚡ AGNT Full (348MB)                │
│    All features including browser   │
│    automation, web scraping         │
│    [Download]                       │
│                                     │
│ 🪶 AGNT Lite (344MB)                │
│    No browser automation            │
│    [Download]                       │
└─────────────────────────────────────┘
```

### Auto-Update Strategy

If you implement auto-updates:

- **Full → Full** - Standard update
- **Lite → Lite** - Standard update
- **Full → Lite** - User must manually download
- **Lite → Full** - User must manually download

Don't auto-update between variants to avoid surprising users.

## Troubleshooting

### Build fails with "Cannot find module 'puppeteer'"

The Lite build script may be running too early. Ensure:

1. Full build completes successfully first
2. `node_modules` contains browser packages before building Lite
3. Run `npm install` before building

### Lite build same size as Full

Check if the afterPack hook ran:

```bash
# Should see this during build:
[Lite Build] Removing browser automation packages...
[Lite Build] ✓ Removed puppeteer (54.91 KB)
[Lite Build] ✓ Removed puppeteer-core (6.57 MB)
[Lite Build] ✓ Removed playwright (3.27 MB)
[Lite Build] ✓ Removed playwright-core (6.28 MB)
[Lite Build] Total space saved: 16.48 MB
```

If not visible, check:
- `AGNT_BUILD_VARIANT=-Lite` is set
- `scripts/electron-builder-lite.js` exists
- `package.json` has `"afterPack": "./scripts/electron-builder-lite.js"`

### Browser tools work in Lite build

The packages weren't removed. Verify:

1. Marker file exists: `.agnt-lite-mode` in resources
2. Console shows: `[Lite Mode] Detected AGNT Lite build`
3. Check extracted app's `node_modules` - should have no `puppeteer/` or `playwright/`

## Technical Details

### Why Not Skip Installation Entirely?

We can't use `npm install --no-optional` because:

1. electron-builder needs all packages present during build
2. The packages must exist to be excluded from the ASAR
3. We remove them **after** packaging but **before** installer creation

### Why optionalDependencies?

Marking as optional allows:

1. Graceful degradation if installation fails
2. npm to skip them in certain scenarios
3. Easier conditional inclusion/exclusion

### ASAR Considerations

Browser packages are listed in `asarUnpack` in `package.json` so they're extracted to `app.asar.unpacked/node_modules/`. This is required because:

1. The `afterPack` hook can only remove files from the unpacked directory
2. Packages inside the ASAR archive can't be selectively removed at build time
3. In Full builds, having them unpacked has no functional impact

## See Also

- [Docker Lite Mode](LITE_MODE.md) - Lite mode for Docker deployments
- [Build Instructions](/_BUILD-INSTRUCTIONS.md) - General build guide
- [Self-Hosting Guide](SELF_HOSTING.md) - Docker deployment options

---

**Summary:**

- **Full**: ~348MB AppImage / ~253MB DEB, all features
- **Lite**: ~344MB AppImage / ~251MB DEB, no browser automation (~16MB uncompressed savings)
- **Both**: Use `npm run build:both` to create both variants
- **Detection**: Automatic via marker file
- **Degradation**: Graceful error messages for disabled features
