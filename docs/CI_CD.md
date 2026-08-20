# CI/CD Pipeline Documentation

AGNT uses GitHub Actions to automate building and publishing distribution artifacts.

## Workflows

### 1. Docker Build (`docker-build.yml`)

Builds and publishes a multi-arch Docker image to GitHub Container Registry (GHCR).
The image includes Chromium for web scraping and browser automation (~1.5GB).

**Triggers:**
- Git tags matching `v*.*.*` or `*.*.*` (with or without 'v' prefix)
- Manual workflow dispatch

**Container Architectures:**
- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64/Apple Silicon)

**Runs on:** Any OS with Docker support (Windows, macOS, GNU/Linux, FreeBSD, etc.)

**GitHub Container Registry Tags:**
```
ghcr.io/agnt-gg/agnt:latest        # latest release
ghcr.io/agnt-gg/agnt:0.6.6         # specific version
ghcr.io/agnt-gg/agnt:0.6           # latest patch on that minor line
ghcr.io/agnt-gg/agnt:sha-abc1234   # git SHA
```

**Secrets Required:**
- `GITHUB_TOKEN` (automatic, no setup needed)

### 2. Electron Build (`electron-build.yml`)

Builds native desktop applications for all platforms.

**Triggers:**
- Git tags matching `v*.*.*` or `*.*.*` (with or without 'v' prefix)
- Manual workflow dispatch

**Platforms:**
- Windows (x64) - NSIS installer (.exe)
- macOS (x64 + ARM64) - DMG + ZIP
- GNU/Linux (x64) - AppImage, DEB, RPM

**Build Matrix:**

| OS              | Platform | Outputs                                |
|-----------------|----------|----------------------------------------|
| windows-2022    | win      | AGNT-*-win-x64.exe                      |
| macos-latest    | mac      | AGNT-*-mac-*.dmg, .zip                  |
| ubuntu-latest   | linux    | AGNT-*-linux-x64.AppImage, .deb, .rpm  |

**Build Jobs:**
- `build-electron-full` - Builds the desktop app for all platforms
- `release` - Creates a GitHub Release with all artifacts (tags only)

**macOS builds are signed and notarized** (Developer ID + notarytool via
`scripts/notarize.js`). Secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

**Artifacts:**
- Uploaded to GitHub Actions artifacts (30 day retention)
- Attached to GitHub Releases (for tagged versions)

## Running Workflows Manually

```bash
# Docker
gh workflow run docker-build.yml

# Electron
gh workflow run electron-build.yml
```

Or via the GitHub Web UI: **Actions → select workflow → Run workflow.**

## Local Testing

### Docker

```bash
docker build -f Dockerfile -t agnt:latest .
# Or use the Makefile
make build
```

### Electron

```bash
# Build frontend
cd frontend && npm run build && cd ..

# Build for the current platform
npm run build

# Build a specific platform
npm run build:win
npm run build:mac
npm run build:linux
```

## Release Process

Push a tag:

```bash
git tag v0.6.7
git push origin v0.6.7
```

This triggers:
1. **Docker Build** - builds and pushes the image with version tags
2. **Electron Build** - builds all installers and creates a draft GitHub Release

After the run completes, edit the draft release notes if needed and publish.

Users can then:
- Download installers from GitHub Releases
- Pull the Docker image:
  ```bash
  docker pull ghcr.io/agnt-gg/agnt:0.6.7
  ```

## Monitoring Builds

```bash
gh run list
gh run view <run-id>
gh run watch
```

Build logs are available in the GitHub Actions UI and retained for 90 days.

## Security

- Never commit code-signing certificates or API keys — store them as GitHub Secrets.
- Pull requests from forks cannot access secrets: Docker images are built but not
  pushed, and Electron builds run but do not sign code.

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Build Push Action](https://github.com/docker/build-push-action)
- [Electron Builder](https://www.electron.build/)

---

**Questions?** See [GitHub Issues](https://github.com/agnt-gg/agnt/issues)
