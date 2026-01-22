# SQLite3 Native Module Rebuild Instructions

## Problem Summary

The build was failing with the error: `node_sqlite3.node is not a valid Win32 application`

This occurred because sqlite3 is a native module that must be compiled for the specific Electron version and architecture (x64 or ia32). When building for multiple architectures, the wrong binary was being loaded.

## Solution Implemented

We've configured proper native module rebuilding for sqlite3 while maintaining support for both x64 and ia32 architectures.

### Changes Made:

1. **Added electron-rebuild** to devDependencies
2. **Updated npm scripts** to rebuild before building
3. **Configured electron-builder** with native module rebuild flags
4. **Created afterPack hook** to rebuild for each architecture during multi-arch builds

## Clean Rebuild Process

### Step 1: Clean Everything

```powershell
# Navigate to desktop directory
cd product\desktop

# Remove old builds and dependencies
Remove-Item -Recurse -Force node_modules, package-lock.json, dist -ErrorAction SilentlyContinue
```

### Step 2: Fresh Install

```powershell
# Install all dependencies (this will also run electron-rebuild via postinstall)
npm install
```

### Step 3: Test Locally

```powershell
# Test that the app runs correctly
npm start
```

If the app starts without the sqlite3 error, proceed to building.

### Step 4: Build for Windows

```powershell
# Build for Windows (both x64 and ia32)
npm run build:win
```

The build process will:

1. Run `electron-rebuild` to rebuild sqlite3 for your current architecture
2. Run `electron-builder` which will:
   - Rebuild native modules during packaging (npmRebuild: true)
   - Use the afterPack hook to rebuild for each specific architecture
   - Create installers for both x64 and ia32

## Available Scripts

- `npm run rebuild` - Manually rebuild sqlite3 for current architecture
- `npm start` - Start the Electron app
- `npm run build` - Build for current platform
- `npm run build:win` - Build for Windows (x64 and ia32)
- `npm run build:mac` - Build for macOS (x64 and arm64)
- `npm run build:linux` - Build for GNU/Linux (x64)
- `npm run build:all` - Build for all platforms

## Troubleshooting

### If you still get the sqlite3 error:

1. **Manually rebuild sqlite3:**

   ```powershell
   npm run rebuild
   ```

2. **Check your Electron version:**

   ```powershell
   npx electron --version
   ```

   Make sure it matches the version in package.json (^33.0.2)

3. **Verify sqlite3 binary architecture:**

   ```powershell
   # Check the sqlite3 build
   dir node_modules\sqlite3\build\Release\
   ```

4. **Clean rebuild from scratch:**
   Follow Steps 1-3 above again

### If build fails:

1. Check that `scripts/rebuild-native.js` exists
2. Verify electron-rebuild is installed: `npm list electron-rebuild`
3. Check build logs for specific errors

## Configuration Details

### package.json Build Configuration:

- `npmRebuild: true` - Rebuilds native modules during packaging
- `buildDependenciesFromSource: true` - Builds from source when needed
- `nodeGypRebuild: true` - Uses node-gyp for rebuilding
- `afterPack: "./scripts/rebuild-native.js"` - Rebuilds for each architecture

### Why This Works:

- **electron-rebuild** ensures native modules match Electron's Node.js version
- **Architecture-specific rebuilds** ensure each installer has the correct binary
- **Automated process** prevents manual intervention and human error

## Notes

- sqlite3 is kept as-is (version ^5.1.7) - no migration to better-sqlite3
- Both x64 and ia32 architectures are supported
- The rebuild process is automatic during `npm install` and `npm run build`
- Each architecture gets its own properly compiled sqlite3 binary
