# Claude AI Instructions for AGNT

## Project Overview

AGNT is an Electron-based desktop AI agent framework for building, deploying, and orchestrating intelligent workflows. It combines a Vue.js frontend, Express.js backend, and Electron shell to provide a cross-platform desktop application for managing AI agents, workflows, and plugins.

**Version**: 0.5.0
**Platform**: Windows, macOS, GNU/Linux
**Website**: https://agnt.gg
**Author**: Nathan Wilbanks

### Local-First Architecture

**AGNT is designed for:**

- ✅ Single users - Personal desktop or laptop
- ✅ Families - Shared Docker backend across household
- ✅ Small teams - 2-10 people in same organization

**NOT designed for:**

- ❌ Multi-tenant SaaS - Hundreds of unrelated users
- ❌ Public hosting - Each org self-hosts their own
- ❌ Large enterprises - 50+ concurrent users

**Why?** Uses SQLite (local database) and broadcasts real-time updates to all connected clients. Perfect for trusted groups sharing a workspace, not for isolating thousands of separate users.

## Architecture

### Tech Stack

- **Desktop Shell**: Electron (v33.0.2)
- **Backend**: Express.js + Node.js (ES Modules)
- **Frontend**: Vue.js 3 + Vite
- **State Management**: Vuex
- **Database**: SQLite3 (local storage)
- **Testing**: Playwright (E2E)

### Application Structure

```
┌─────────────────────────────────────┐
│   Electron Main Process (main.js)   │
│   - Window management                │
│   - IPC handlers                     │
│   - Auto-update system               │
└─────────────────────────────────────┘
            ↕ IPC (preload.js)
┌─────────────────────────────────────┐
│   Backend Server (Express on 3333)  │
│   - REST API routes                  │
│   - Plugin system                    │
│   - Workflow engine                  │
│   - AI provider integrations         │
└─────────────────────────────────────┘
            ↕ HTTP/WebSocket
┌─────────────────────────────────────┐
│   Frontend (Vue.js)                  │
│   - Agent UI                         │
│   - Workflow designer                │
│   - Plugin marketplace               │
└─────────────────────────────────────┘
```

## Development Workflow

### Quick Start (Development Mode)

```bash
# Terminal 1: Start frontend dev server (hot reload)
cd frontend
npm run dev          # Runs on http://localhost:5173

# Terminal 2: Start Electron app (loads dev server)
npm start            # Backend runs on port 3333
```

**Frontend Dev Server** (recommended for rapid iteration):

- Frontend runs on Vite dev server (port 5173)
- Hot module replacement (HMR) for instant updates
- Electron window loads from dev server

**Production Mode** (test built frontend):

```bash
# Build frontend first
cd frontend && npm run build && cd ..

# Start Electron (loads from frontend/dist)
npm start
```

### User Manages Dev Server

- **DO NOT** start/stop the frontend dev server automatically
- User controls `npm run dev` in a separate terminal
- Frontend changes appear instantly via HMR
- If frontend not loading, ask user to check their dev server

## Project Structure

```
/
├── main.js                    # Electron main process entry
├── preload.js                 # IPC bridge for renderer
├── package.json               # Root project config
├── .env.example               # Environment template
│
├── backend/                   # Express.js backend server
│   ├── server.js              # Server entry (port 3333)
│   ├── src/
│   │   ├── routes/            # API route handlers
│   │   ├── services/          # Business logic
│   │   ├── models/            # Data models
│   │   ├── plugins/           # Plugin management
│   │   ├── tools/             # Built-in workflow tools
│   │   ├── workflow/          # Workflow engine
│   │   ├── stream/            # WebSocket streaming
│   │   └── utils/             # Utilities
│   └── plugins/
│       ├── dev/               # Plugin development
│       ├── plugin-builds/     # Built .agnt packages
│       └── installed/         # User-installed plugins
│
├── frontend/                  # Vue.js frontend app
│   ├── src/
│   │   ├── views/             # Page components
│   │   ├── components/        # Reusable components
│   │   ├── store/             # Vuex state management
│   │   ├── services/          # API client services
│   │   └── router/            # Vue Router config
│   ├── dist/                  # Build output (served by Electron)
│   └── package.json           # Frontend dependencies
│
├── build/                     # Electron builder resources
│   ├── icon.ico               # Windows icon
│   ├── icon.icns              # macOS icon
│   ├── icons/                 # GNU/Linux icons
│   └── installer.nsh          # NSIS installer config
│
├── tests/                     # Playwright E2E tests
├── docs/                      # Documentation
└── scripts/                   # Build scripts
```

## Common Commands

### Development

```bash
npm start                      # Start Electron app (dev or prod mode)
npm run dev                    # Start backend server only (port 3333)
cd frontend && npm run dev     # Start frontend dev server (port 5173)
```

### Building

```bash
# Build frontend (ALWAYS do this before building Electron)
cd frontend && npm run build && cd ..

# Build Electron packages
npm run build                  # Current platform
npm run build:win              # Windows (NSIS)
npm run build:mac              # macOS (DMG + ZIP, x64 + ARM64)
npm run build:linux            # GNU/Linux (AppImage, DEB, RPM)
npm run build:all              # All platforms

# Outputs go to dist/
```

### Testing

```bash
npm run test:e2e               # Run all Playwright tests
npx playwright test tests/e2e/agents.spec.js  # Specific test
```

### Plugin Development

```bash
# Create plugin in backend/plugins/dev/my-plugin/
# Build it:
cd backend/plugins
node build-plugin.js my-plugin

# Output: backend/plugins/plugin-builds/my-plugin.agnt
```

## Git Commits

### Commit Message Style

- **NO** Claude attribution (`Co-Authored-By: Claude` or `Generated with Claude Code`)
- Write professional, descriptive commit messages
- Use conventional format: `type: description`

**Examples:**

```bash
git commit -m "feat: add goal evaluation reports"
git commit -m "fix: resolve workflow execution race condition"
git commit -m "docs: update plugin development guide"
git commit -m "refactor: simplify agent chat streaming"
```

### Committing Changes

Only create commits when requested by the user. If unclear, ask first.

1. Check status and diff:

   ```bash
   git status
   git diff
   git log --oneline -5  # Review recent commit style
   ```

2. Stage and commit:

   ```bash
   git add <files>
   git commit -m "type: description"
   ```

3. **NEVER** commit sensitive files:
   - `.env` files (except `.env.example`)
   - `*.db`, `*.sqlite`, `*.sqlite3`
   - `*mcp.json` (contains API keys)
   - `*.p12`, `*.pfx`, `*.key`, `*.pem` (code signing)

## Code Style & Conventions

### Backend (Express.js)

- **ES Modules**: Use `import/export`, not `require/module.exports`
- **Async/Await**: Prefer over callbacks
- **Error Handling**: Always wrap async routes in try-catch
- **Logging**: Use `console.log` for important events (structured logs preferred)

### Frontend (Vue.js)

- **Composition API**: Prefer over Options API for new code
- **TypeScript**: Not currently used (JavaScript + JSDoc for types)
- **CSS Scoped**: Use `<style scoped>` in Single File Components
- **API Calls**: Always use services from `frontend/src/services/`

### Plugin System

- Plugins are `.agnt` files (ZIP archives)
- Each plugin has `manifest.json` with tools/actions/widgets
- Tools implement `execute(params, inputData, workflowEngine)`
- See `backend/plugins/README.md` for full docs

## Environment Variables

Create `.env` in root (copy from `.env.example`):

```bash
# Backend server
PORT=3333

# Frontend URLs (for CORS)
FRONTEND_DEV_URL=http://localhost:5173
FRONTEND_DIST_URL=http://localhost:3333

# AI Provider API Keys (optional - user configures in UI)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
GROQ_API_KEY=
```

**NEVER commit `.env` files!** Always use `.env.example` as template.

## Building for Distribution

### Pre-build Checklist

1. ✅ Build frontend: `cd frontend && npm run build && cd ..`
2. ✅ Test production mode: `npm start` (loads from `frontend/dist`)
3. ✅ Run E2E tests: `npm run test:e2e`
4. ✅ Update version in `package.json` (both root and frontend)
5. ✅ Generate icons if changed: `npm run generate-icons`

### Platform-Specific Notes

**Windows**:

- Requires `windows-build-tools` for native modules
- Output: `dist/AGNT-{version}-win-x64.exe` (NSIS installer)

**macOS**:

- Requires Xcode Command Line Tools
- Builds both x64 and ARM64 (Apple Silicon)
- Output: `dist/AGNT-{version}-mac-{arch}.dmg` and `.zip`
- **Code Signing**: Disabled by default (`hardenedRuntime: false`)

**GNU/Linux**:

- Requires build tools: `build-essential libx11-dev libxkbfile-dev`
- Output: AppImage, DEB, RPM
- See `docs/_LINUX-BUILD-INSTRUCTIONS.md`

### Build Outputs

| Platform  | Formats            | Architecture | Notes                  |
| --------- | ------------------ | ------------ | ---------------------- |
| Windows   | NSIS (.exe)        | x64          | One-click installer    |
| macOS     | DMG, ZIP           | x64, ARM64   | Universal builds       |
| GNU/Linux | AppImage, DEB, RPM | x64          | Portable + distro pkgs |

All outputs saved to `dist/` (gitignored).

## Releasing a New Version

AGNT uses **tag-driven releases**. Pushing a version tag triggers `.github/workflows/docker-build.yml` to build and publish multi-arch Docker images (Full + Lite) to `ghcr.io/agnt-gg/agnt`. Regular commits to `main` do **NOT** rebuild images — this is intentional to keep CI cheap and releases deliberate.

### Release Commands

```bash
npm run release:patch    # Bug fix (0.5.4 → 0.5.5)
npm run release:minor    # New feature (0.5.4 → 0.6.0)
npm run release:major    # Breaking change (0.5.4 → 1.0.0)
```

Each command runs `npm version <bump>` (updates `package.json`, commits, creates annotated `v{version}` tag) then `git push --follow-tags` (pushes commit + tag in one go).

### Release Workflow

1. Commit all code changes first (`npm version` requires a clean working tree)
2. Run the appropriate `npm run release:*` command
3. Wait ~15 min for CI to build both variants (Full + Lite, multi-arch amd64 + arm64)
4. Docker users can now pull the update:

   ```bash
   docker compose pull
   docker compose up -d
   ```

   **Important:** `docker compose up -d` alone does NOT fetch new images if the tag already exists locally. Always `pull` first (or use `--pull always`).

### Image Tags Published

**Full variant:** `:latest`, `:full`, `:{version}`, `:{version}-full`, `:{major}.{minor}`, `:{major}.{minor}-full`, `:sha-{short}`

**Lite variant:** `:lite`, `:{version}-lite`, `:{major}.{minor}-lite`, `:sha-lite-{short}`

### When NOT to release

Don't release for docs-only changes, internal refactors with no user-facing impact, or WIP commits. The tag should represent a meaningful user-facing change. If you need to rebuild without bumping, use the `workflow_dispatch` trigger from the GitHub Actions UI.

## Docker Support (Self-Hosting)

AGNT can run in Docker for server deployments:

```bash
# Start with Docker Compose (use absolute path for AGNT_HOME)
AGNT_HOME=/home/youruser docker-compose up -d

# Access at http://localhost:3333
```

**Data Directory:** `~/.agnt/data/`

- SQLite database: `~/.agnt/data/agnt.db`
- Plugins: `~/.agnt/data/plugins/`
- Logs: `~/.agnt/logs/`

**Important:** When using Docker snap, use absolute paths for `AGNT_HOME` (e.g., `/home/username`) instead of `$HOME` to avoid snap's home directory isolation.

See `docs/SELF_HOSTING.md` for complete Docker setup, networking, and configuration.

## AI Provider Support

Supported providers (9+):

- **OpenAI**: GPT-4, GPT-4 Turbo, GPT-3.5
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Opus/Sonnet/Haiku
- **Google**: Gemini Pro, Gemini Ultra
- **Groq**: Llama 3, Mixtral (fast inference)
- **Cerebras**: Fast inference models
- **DeepSeek**: DeepSeek Coder, DeepSeek Chat
- **OpenRouter**: 100+ models
- **Together AI**: Open source models
- **Custom**: Any OpenAI-compatible API

Users configure API keys in the AGNT UI (stored locally).

## Plugin System Architecture

AGNT uses a **VSCode-style plugin distribution** system:

1. **Development**: Create plugin in `backend/plugins/dev/my-plugin/`
2. **Build**: `node backend/plugins/build-plugin.js my-plugin`
3. **Package**: Creates `my-plugin.agnt` (ZIP with manifest + code + deps)
4. **Install**: Users install via UI or CLI
5. **Hot Reload**: Plugins can be installed/uninstalled without restart

**Plugin Types**:

- **Tools**: Workflow actions (API calls, data transforms, etc.)
- **Triggers**: Workflow starters (webhooks, schedules, etc.)
- **Widgets**: UI components for workflows

See `backend/plugins/README.md` for plugin development guide.

## Testing

### E2E Tests (Playwright)

```bash
# Run all tests
npm run test:e2e

# Run specific test
npx playwright test tests/e2e/agents.spec.js

# Debug mode (headed browser)
npx playwright test --headed --debug
```

Test files in `tests/e2e/`:

- `agents.spec.js` - Agent creation and chat
- `workflows.spec.js` - Workflow designer
- `plugins.spec.js` - Plugin installation

See `docs/_TESTS_INSTRUCTIONS.md` for more details.

## Troubleshooting

### Frontend Not Loading

1. Check if frontend dev server is running: `cd frontend && npm run dev`
2. Or build frontend: `cd frontend && npm run build`
3. Hard refresh browser: Ctrl+Shift+R (GNU/Linux/Win) or Cmd+Shift+R (Mac)

### Backend Port Conflicts

If port 3333 is in use, change in `.env`:

```bash
PORT=3334
```

Also update `backend/server.js` CORS origins.

### Native Module Errors

Rebuild native modules for Electron:

```bash
npm run rebuild
```

See `docs/_REBUILD-INSTRUCTIONS.md` for native module rebuilding.

### Plugin Not Loading

1. Check plugin manifest: `backend/plugins/dev/my-plugin/manifest.json`
2. Rebuild plugin: `node backend/plugins/build-plugin.js my-plugin`
3. Check logs: Backend console shows plugin load errors

## Security Notes

### Sensitive Files (NEVER COMMIT)

- `.env` (API keys, secrets)
- `*mcp.json` (MCP server configs with tokens)
- `*.db`, `*.sqlite`, `*.sqlite3` (user data)
- `*.p12`, `*.pfx`, `*.key`, `*.pem` (code signing certs)

### API Key Storage

- User API keys stored locally (SQLite or filesystem)
- **NEVER** hardcode API keys in source
- Use `.env.example` as template (no real keys)

### Puppeteer/Playwright

- Browsers **NOT** bundled (security + size reasons)
- Uses system-installed Chrome/Edge/Firefox
- `PUPPETEER_SKIP_DOWNLOAD=true` in environment

## Documentation

| Document                                                      | Description                 |
| ------------------------------------------------------------- | --------------------------- |
| [📚 API Documentation](docs/_API-DOCUMENTATION.md)            | REST API reference          |
| [🔨 Build Instructions](docs/_BUILD-INSTRUCTIONS.md)          | Detailed build guide        |
| [🐧 GNU/Linux Build Guide](docs/_LINUX-BUILD-INSTRUCTIONS.md) | GNU/Linux-specific setup    |
| [🐳 Self-Hosting Guide](docs/SELF_HOSTING.md)                 | Docker deployment & hosting |
| [🔌 Plugin Development](backend/plugins/README.md)            | Creating custom plugins     |
| [🔧 Rebuild Guide](docs/_REBUILD-INSTRUCTIONS.md)             | Native module rebuilding    |
| [🧪 Testing Instructions](docs/_TESTS_INSTRUCTIONS.md)        | E2E test setup and usage    |

## Meta-Instructions

### Cross-Repository Awareness

When working on AGNT:

1. **Read CLAUDE.md** at the start of each session
2. If user mentions other repos (unsandbox.com, etc.), read their CLAUDE.md too
3. Each repo has unique conventions - respect them

### Working with Claude

- **Research vs. Implementation**: Clearly distinguish between exploration (reading files, searching) and implementation (writing code)
- **Ask Before Committing**: Only create git commits when explicitly requested
- **No Time Estimates**: Never give time estimates for tasks
- **Professional Objectivity**: Prioritize technical accuracy over validation
- **Tool Usage**: Prefer specialized tools (Read, Edit, Write) over bash commands for file operations

## Quick Reference

```bash
# Development
npm start                              # Start Electron app
cd frontend && npm run dev             # Start frontend dev server

# Building
cd frontend && npm run build && cd ..  # Build frontend
npm run build                          # Build Electron package

# Testing
npm run test:e2e                       # Run E2E tests

# Plugin Development
cd backend/plugins
node build-plugin.js my-plugin         # Build plugin

# Git
git status                             # Check changes
git commit -m "feat: add feature"      # Professional commit

# Releasing
npm run release:patch                  # Bug fix bump + tag + push
npm run release:minor                  # Feature bump + tag + push
npm run release:major                  # Breaking change bump + tag + push

# Docker
docker-compose up -d                   # Start in Docker
docker compose pull && docker compose up -d  # Update to latest image
```

## Claude Acknowledgments

I, Claude, acknowledge that:

1. I will **read this CLAUDE.md** at the start of each session
2. I will **not commit changes** unless explicitly requested
3. I will **not give time estimates** for tasks
4. I will **ask clarifying questions** before implementing features
5. I will **respect the existing code style** and conventions
6. I will **never commit sensitive files** (.env, *.db, *mcp.json, certs)
7. I will **use proper git commit messages** (no Claude attribution)
8. I will **prefer specialized tools** over bash for file operations
9. I will **not start/stop the frontend dev server** (user manages it)
10. I will **build the frontend** before testing production mode

---

**Built with ❤️ by Nathan Wilbanks**
**Website**: https://agnt.gg
**Twitter**: @agnt_gg
**Discord**: https://discord.gg/agnt
