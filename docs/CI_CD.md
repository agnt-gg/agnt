# CI/CD Pipeline Documentation

AGNT uses GitHub Actions to automate building and publishing all distribution variants.

## Workflows

### 1. Docker Build (`docker-build.yml`)

Builds and publishes Docker images to Docker Hub.

**Variants:**
- **Full** (~1.5GB) - With Chromium and browser automation
- **Lite** (~715MB) - Without browser automation

**Triggers:**
- Push to `main` branch
- Pull requests to `main`
- Git tags matching `v*.*.*`
- Manual workflow dispatch

**Platforms:**
- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64/Apple Silicon)

**Docker Hub Tags:**
```
agnt/agnt:latest        # Full variant (main branch)
agnt/agnt:full          # Full variant (main branch)
agnt/agnt:lite          # Lite variant (main branch)
agnt/agnt:0.3.7         # Version (Full)
agnt/agnt:0.3.7-full    # Version (Full)
agnt/agnt:0.3.7-lite    # Version (Lite)
agnt/agnt:sha-abc1234   # Git SHA (Full)
agnt/agnt:sha-lite-abc1234  # Git SHA (Lite)
```

**Build Jobs:**
- `build-full` - Builds Full variant with Chromium
- `build-lite` - Builds Lite variant without browser automation
- `update-dockerhub-description` - Updates Docker Hub README

**Secrets Required:**
- `DOCKERHUB_USERNAME` (variable)
- `DOCKERHUB_TOKEN` (secret)

### 2. Electron Build (`electron-build.yml`)

Builds native desktop applications for all platforms.

**Variants:**
- **Full** (~150-200MB) - With browser automation
- **Lite** (~80-120MB) - Without browser automation

**Triggers:**
- Push to `main` branch
- Pull requests to `main`
- Git tags matching `v*.*.*`
- Manual workflow dispatch

**Platforms:**
- Windows (x64) - NSIS installer (.exe)
- macOS (x64 + ARM64) - DMG + ZIP
- Linux (x64) - AppImage, DEB, RPM

**Build Matrix:**

| OS              | Platform | Outputs                          |
|-----------------|----------|----------------------------------|
| windows-latest  | win      | AGNT-*-win-x64.exe               |
| macos-latest    | mac      | AGNT-*-mac-*.dmg, .zip           |
| ubuntu-latest   | linux    | AGNT-*-linux-x64.AppImage, .deb, .rpm |

**Build Jobs:**
- `build-electron-full` - Builds Full variant for all platforms
- `build-electron-lite` - Builds Lite variant for all platforms
- `release` - Creates GitHub Release with all artifacts (tags only)

**Artifacts:**
- Uploaded to GitHub Actions artifacts (30 day retention)
- Attached to GitHub Releases (for tagged versions)

**Secrets Required:**
- `GITHUB_TOKEN` (automatic)

## Workflow Outputs

### Docker Builds

**Pull Request:**
- Builds images but doesn't push to Docker Hub
- Validates Dockerfiles and build process

**Main Branch:**
- Builds and pushes to Docker Hub
- Tags with `latest`, `full`, `lite`, `sha-*`
- Updates Docker Hub description

**Tagged Release (v*.*.*):**
- Builds and pushes to Docker Hub
- Tags with version numbers (e.g., `0.3.7`, `0.3.7-full`, `0.3.7-lite`)

### Electron Builds

**Pull Request:**
- Builds all variants for all platforms
- Uploads artifacts to GitHub Actions (30 days)

**Main Branch:**
- Builds all variants for all platforms
- Uploads artifacts to GitHub Actions (30 days)

**Tagged Release (v*.*.*):**
- Builds all variants for all platforms
- Uploads artifacts to GitHub Actions (30 days)
- Creates draft GitHub Release with all installers
- Auto-generates release notes

## Running Workflows Manually

### Docker Build

```bash
# Via GitHub CLI
gh workflow run docker-build.yml

# Via GitHub Web UI
Actions → Build and Push Docker Images → Run workflow
```

### Electron Build

```bash
# Via GitHub CLI
gh workflow run electron-build.yml

# Via GitHub Web UI
Actions → Build Electron Apps → Run workflow
```

## Local Testing

### Test Docker Build Locally

```bash
# Build Full variant
docker build -f Dockerfile -t agnt:full .

# Build Lite variant
docker build -f Dockerfile.lite -t agnt:lite .

# Or use Makefile
make build-all
```

### Test Electron Build Locally

```bash
# Build frontend
cd frontend && npm run build && cd ..

# Build Full variant (current platform)
npm run build

# Build Lite variant (current platform)
npm run build:lite

# Build specific platform
npm run build:win          # Windows Full
npm run build:lite:mac     # macOS Lite
npm run build:linux        # Linux Full
```

## Build Caching

### Docker

Uses GitHub Actions cache to speed up builds:
- Separate caches for Full (`docker-full`) and Lite (`docker-lite`)
- Caches Docker layers between builds
- Significantly reduces build times on subsequent runs

### Electron

Uses npm cache to speed up dependency installation:
- Caches `node_modules` based on `package-lock.json`
- Separate caches per OS

## Release Process

### 1. Automated Builds

When you push a tag:

```bash
# Tag a release
git tag v0.3.8
git push origin v0.3.8
```

Triggers:
1. **Docker Build** - Builds and pushes Docker images with version tags
2. **Electron Build** - Builds all installers and creates draft GitHub Release

### 2. Manual Release Steps

After GitHub Actions completes:

1. Go to GitHub Releases
2. Find the draft release
3. Edit release notes if needed
4. Publish the release

Users can then:
- Download installers from GitHub Releases
- Pull Docker images from Docker Hub:
  ```bash
  docker pull agnt/agnt:0.3.8      # Full
  docker pull agnt/agnt:0.3.8-lite # Lite
  ```

## Monitoring Builds

### View Workflow Status

```bash
# Via GitHub CLI
gh run list
gh run view <run-id>
gh run watch

# Via GitHub Web UI
Actions tab → Select workflow → View runs
```

### Build Logs

- Available in GitHub Actions UI
- Retained for 90 days
- Download logs with: `gh run download <run-id>`

## Troubleshooting

### Docker Build Fails

**Check Docker Hub credentials:**
```bash
gh secret list
```

Should show `DOCKERHUB_TOKEN`.

**Variables:**
```bash
gh variable list
```

Should show `DOCKERHUB_USERNAME`.

### Electron Build Fails

**Platform-specific issues:**
- **Windows**: Requires `windows-build-tools` (pre-installed on GitHub runners)
- **macOS**: Builds both x64 and ARM64 (universal builds)
- **Linux**: Requires build tools (pre-installed on GitHub runners)

**Check Node.js version:**
Workflow uses Node.js 20. If building locally, ensure same version:
```bash
node --version  # Should be v20.x.x
```

### Artifacts Not Found

**Check artifact name:**
```bash
gh run view <run-id> --log
```

Look for "Upload artifacts" step.

**Download artifacts:**
```bash
gh run download <run-id>
```

## Build Matrix Summary

| Variant        | Docker | Electron | Platforms               | Size        |
|----------------|--------|----------|-------------------------|-------------|
| Full           | ✅     | ✅       | All                     | 1.5GB / 150-200MB |
| Lite           | ✅     | ✅       | All                     | 715MB / 80-120MB |
| **Docker**     | ✅     | -        | linux/amd64, linux/arm64 | -           |
| **Electron**   | -      | ✅       | Windows, macOS, Linux   | -           |

## Environment Variables

### Docker Build

```yaml
DOCKER_IMAGE: ${{ vars.DOCKERHUB_USERNAME }}/agnt
BUILD_DATE: ${{ github.event.head_commit.timestamp }}
VCS_REF: ${{ github.sha }}
VERSION: ${{ steps.meta.outputs.version }}
```

### Electron Build

```yaml
GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}  # For auto-update and code signing
NODE_ENV: production
```

## Security

### Secrets Management

**Never commit:**
- Docker Hub tokens
- Code signing certificates
- API keys

**Store as GitHub Secrets:**
```bash
gh secret set DOCKERHUB_TOKEN
gh variable set DOCKERHUB_USERNAME
```

### Pull Request Builds

- Pull requests from forks cannot access secrets
- Docker images are built but not pushed
- Electron builds run but don't sign code

## Performance

### Build Times

| Workflow       | Platform | Time (approx) |
|----------------|----------|---------------|
| Docker Full    | Multi-arch | 15-20 min   |
| Docker Lite    | Multi-arch | 10-15 min   |
| Electron Full  | Windows  | 10-15 min   |
| Electron Full  | macOS    | 12-18 min   |
| Electron Full  | Linux    | 8-12 min    |
| Electron Lite  | Windows  | 8-12 min    |
| Electron Lite  | macOS    | 10-15 min   |
| Electron Lite  | Linux    | 6-10 min    |

**Total pipeline time (tagged release):** ~30-40 minutes (parallel execution)

### Optimization Tips

1. **Cache hit rate** - Minimize changes to Dockerfiles and package.json
2. **Layer ordering** - Put frequently changing steps last
3. **Parallel execution** - All builds run concurrently
4. **Incremental builds** - Use GitHub Actions cache

## Future Improvements

- [ ] Code signing for macOS and Windows
- [ ] Notarization for macOS
- [ ] Auto-update server setup
- [ ] Nightly builds
- [ ] Beta/preview channels
- [ ] Build performance metrics
- [ ] Security scanning (Trivy, Snyk)
- [ ] Dependency updates (Dependabot)

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Build Push Action](https://github.com/docker/build-push-action)
- [Electron Builder](https://www.electron.build/)
- [electron-builder GitHub Actions](https://www.electron.build/configuration/publish#github-repository)

---

**Questions?** See [GitHub Issues](https://github.com/agnt-gg/agnt/issues)
