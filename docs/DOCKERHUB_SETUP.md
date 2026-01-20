# DockerHub CI/CD Setup Guide

This guide explains how to configure GitHub Actions to automatically build and publish AGNT Docker images to DockerHub.

## Prerequisites

1. **DockerHub Account**: Create one at https://hub.docker.com if you don't have one
2. **GitHub Repository**: Must have admin access to configure secrets

## Step 1: Create DockerHub Access Token

1. Log in to [DockerHub](https://hub.docker.com)
2. Navigate to **Account Settings** → **Security** → **Access Tokens**
3. Click **"New Access Token"**
4. Configure the token:
   - **Description**: `GitHub-Actions-AGNT` (or similar descriptive name)
   - **Access permissions**: Select **"Read, Write, Delete"**
5. Click **"Generate"**
6. **CRITICAL**: Copy the token immediately - you'll only see it once!

## Step 2: Configure GitHub Secrets

1. Go to your GitHub repository: `https://github.com/YOUR_USERNAME/agnt`
2. Navigate to **Settings** → **Secrets and variables** → **Actions**

### Add Repository Secret:
- Click **"New repository secret"**
- **Name**: `DOCKERHUB_TOKEN`
- **Secret**: Paste the access token from Step 1
- Click **"Add secret"**

### Add Repository Variable:
- Switch to the **"Variables"** tab
- Click **"New repository variable"**
- **Name**: `DOCKERHUB_USERNAME`
- **Value**: Your DockerHub username (e.g., `nathanw`)
- Click **"Add variable"**

## Step 3: Verify Workflow Configuration

The workflow file `.github/workflows/docker-publish.yml` is already configured. It will:

### Triggers:
- **Push to `main` branch**: Builds and pushes with `latest` tag
- **Version tags** (e.g., `v0.3.7`): Builds and pushes with semantic version tags
- **Pull requests**: Builds only (doesn't push to DockerHub)
- **Manual trigger**: Via GitHub Actions UI

### Image Tags:
When you push to main:
- `your-username/agnt:latest`
- `your-username/agnt:sha-abc1234`

When you create a version tag (e.g., `v0.3.7`):
- `your-username/agnt:0.3.7`
- `your-username/agnt:0.3`
- `your-username/agnt:0`
- `your-username/agnt:latest`

### Multi-Platform Support:
Builds for both:
- `linux/amd64` (Intel/AMD)
- `linux/arm64` (ARM - Apple Silicon, AWS Graviton)

## Step 4: Test the Workflow

### Option A: Push to Main
```bash
git add .
git commit -m "ci: add docker publishing workflow"
git push origin main
```

### Option B: Create a Version Tag
```bash
# Tag with the current version from package.json
git tag v0.3.7
git push origin v0.3.7
```

### Option C: Manual Trigger
1. Go to **Actions** tab in GitHub
2. Select **"Build and Push Docker Image"**
3. Click **"Run workflow"**
4. Select branch and click **"Run workflow"**

## Step 5: Monitor the Build

1. Go to the **Actions** tab in your GitHub repository
2. Click on the latest workflow run
3. Watch the build progress (typically takes 5-10 minutes)
4. Check for any errors in the logs

## Step 6: Verify on DockerHub

1. Go to https://hub.docker.com/r/YOUR_USERNAME/agnt
2. Check that the image appears with the correct tags
3. Verify the README is synced from your repository

## Using the Published Image

Once published, users can pull and run AGNT:

```bash
# Pull the latest image
docker pull YOUR_USERNAME/agnt:latest

# Run AGNT
docker run -d \
  -p 3333:3333 \
  -v agnt-data:/app/data \
  -v agnt-plugins:/app/backend/plugins/installed \
  --name agnt \
  YOUR_USERNAME/agnt:latest
```

Or using docker-compose, update `docker-compose.yml`:

```yaml
services:
  agnt:
    image: YOUR_USERNAME/agnt:latest
    # ... rest of config
```

## Security Best Practices

### Token Management
- ✅ Rotate access tokens every 30-90 days
- ✅ Use separate tokens for different projects
- ✅ Revoke tokens immediately if compromised
- ❌ Never commit tokens to git
- ❌ Never use your DockerHub password in CI/CD

### Secret Rotation
To rotate your DockerHub token:
1. Generate a new token in DockerHub (Step 1)
2. Update the `DOCKERHUB_TOKEN` secret in GitHub
3. Revoke the old token in DockerHub

### Monitoring
- Enable email notifications for failed workflows
- Review workflow logs regularly
- Monitor DockerHub for unauthorized pulls

## Troubleshooting

### Build Fails: "unauthorized: incorrect username or password"
- Verify `DOCKERHUB_USERNAME` variable is correct (case-sensitive)
- Verify `DOCKERHUB_TOKEN` secret contains a valid access token (not password)
- Check token hasn't expired in DockerHub settings

### Build Fails: Multi-platform error
- GitHub Actions runners support multi-platform builds via QEMU
- If issues persist, remove `linux/arm64` from the `platforms` line

### Docker Hub Description Not Updating
- Requires additional permission scope in token
- Check that README.md exists in repository root
- Verify token has "Read, Write, Delete" permissions

### Workflow Doesn't Trigger
- Check workflow file is in `.github/workflows/` directory
- Verify YAML syntax is valid
- Check branch name matches trigger (e.g., `main` vs `master`)

## Advanced Configuration

### Custom Tags
Edit `.github/workflows/docker-publish.yml` tags section:

```yaml
tags: |
  type=raw,value=nightly,enable={{is_default_branch}}
  type=raw,value=beta,enable=${{ github.ref == 'refs/heads/develop' }}
```

### Build Arguments
Pass custom build args:

```yaml
build-args: |
  NODE_ENV=production
  CUSTOM_VAR=value
```

### Conditional Builds
Only build on specific conditions:

```yaml
on:
  push:
    branches:
      - main
    paths:
      - 'backend/**'
      - 'frontend/**'
      - 'Dockerfile'
```

## Resources

- [Docker Login Action](https://github.com/docker/login-action)
- [Docker Build Push Action](https://github.com/docker/build-push-action)
- [Docker Metadata Action](https://github.com/docker/metadata-action)
- [DockerHub Access Tokens](https://docs.docker.com/security/access-tokens/)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

## Support

If you encounter issues:
1. Check workflow logs in GitHub Actions tab
2. Review [GitHub Issues](https://github.com/anthropics/agnt/issues)
3. Join [Discord community](https://discord.gg/agnt)
4. Check DockerHub status page

---

**Last Updated**: 2026-01-20
**AGNT Version**: 0.3.7
