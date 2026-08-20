# AGNT Makefile Guide

Complete reference for building, deploying, and managing AGNT using the Makefile.

## Quick Start

```bash
# Show all available commands
make help

# Build the Docker image from scratch
make build

# Pull the image from GHCR
make pull

# Build and run locally
make run-local

# Pull and run from GHCR
make run-remote
```

## The Image

AGNT ships one Docker image (~1.5GB) that includes Chromium for web scraping and
browser automation. It runs on port 3333.

## Configuration

Set your GitHub org (default: `agnt-gg`):

```bash
make GITHUB_ORG=yourname build
```

## Core Commands

### Building the image locally

```bash
make build
# Creates tags:
#   ghcr.io/agnt-gg/agnt:latest
#   ghcr.io/agnt-gg/agnt:0.6.6
```

### Multi-architecture build

Build for both `amd64` (Intel/AMD) and `arm64` (Apple Silicon/ARM). Requires
Docker Buildx and pushes directly to GHCR:

```bash
make build-multiarch
```

### Pulling from GHCR

```bash
make pull            # latest
make pull-version    # version from package.json
```

### Running the container

```bash
make run-local       # build then run (port 3333)
make run-remote      # pull then run
make run             # start (assumes the image exists)
```

After running, open http://localhost:3333.

### Managing the container

```bash
make stop            # stop AGNT (checkpoints the WAL database first)
make restart         # restart
make logs            # follow logs
make status          # container status
make shell           # shell into the running container
```

### Pushing to GHCR

```bash
make push            # requires: docker login ghcr.io
```

## Updating

```bash
make update          # pull latest from GHCR and restart (registry install)
make update-local    # rebuild from source and restart (after git pull)
```

`docker-compose up -d` alone does NOT pick up a new image — Compose reuses the
cached tag. The `update` targets do the right thing end to end.

## Cleanup

```bash
make clean           # stop and remove images
make clean-volumes   # remove ALL data (WARNING: destructive!)
make prune           # remove unused Docker resources
```

⚠️ **Warning**: `make clean-volumes` deletes all AGNT data, plugins, and logs.

## Utility

```bash
make info            # build information
make version         # current version
make inspect         # image details
make test-image      # image health check
```

## Electron Desktop Builds

The Makefile also builds desktop installers (one per platform, full feature set).

```bash
make electron-info           # build information

make electron-build          # current platform
make electron-build-win      # Windows
make electron-build-mac      # macOS (x64 + ARM64)
make electron-build-linux    # GNU/Linux (AppImage, DEB, RPM)
make electron-build-all      # all platforms
```

Installers are written to `dist/` (gitignored). macOS builds are signed and
notarized in CI.

## Mobile Lite (Annie chat shell)

`mobile-lite-*` targets build the Capacitor iOS shell for the `/m` chat surface.
This is a **separate product** and is unrelated to the former AGNT Lite build
variant. See `mobile/mobile-lite/README.md` and `make mobile-lite-info`.

## Docker Compose Direct Usage

```bash
docker-compose up -d
docker-compose down
docker-compose logs -f
```

## Resources

- [Dockerfile](../Dockerfile) - image build
- [docker-compose.yml](../docker-compose.yml) - compose config
- [Self-Hosting Guide](SELF_HOSTING.md) - complete deployment guide
- [CI/CD Guide](CI_CD.md) - release automation

## Support

- [GitHub Issues](https://github.com/agnt-gg/agnt/issues)
- [Documentation](https://agnt.gg/docs)
