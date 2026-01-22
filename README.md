<p align="center">
  <img src="assets/icon.png" alt="AGNT Logo" width="140" height="140">
</p>

<h1 align="center">🤖 AGNT</h1>

<p align="center">
  <strong>The AI Agent Framework for Building, Deploying, and Orchestrating Intelligent Workflows</strong>
</p>

<p align="center">
  <em>Create powerful AI agents • Design visual workflows • Extend with plugins • No code required</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/AGNT-AI%20Agents-blueviolet?style=for-the-badge&logo=robot&logoColor=white" alt="AGNT AI Agents">
  <img src="https://img.shields.io/badge/Electron-Desktop-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron Desktop">
  <img src="https://img.shields.io/badge/Vue.js-Frontend-4FC08D?style=for-the-badge&logo=vue.js&logoColor=white" alt="Vue.js Frontend">
  <img src="https://img.shields.io/badge/Node.js-Backend-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js Backend">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.7-blue.svg?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/electron-33.0.2-47848F.svg?style=flat-square&logo=electron" alt="Electron">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg?style=flat-square&logo=node.js" alt="Node">
  <img src="https://img.shields.io/badge/license-Custom-orange.svg?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome">
</p>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/agnt-gg/agnt/docker-build.yml?branch=main&style=flat-square&logo=docker&label=Docker%20Build" alt="Docker Build">
  <img src="https://img.shields.io/github/actions/workflow/status/agnt-gg/agnt/electron-build.yml?branch=main&style=flat-square&logo=electron&label=Electron%20Build" alt="Electron Build">
  <img src="https://img.shields.io/badge/Docker%20Full-~1.5GB-blue?style=flat-square&logo=docker" alt="Docker Full Size">
  <img src="https://img.shields.io/badge/Docker%20Lite-~715MB-blue?style=flat-square&logo=docker" alt="Docker Lite Size">
</p>

<p align="center">
  <a href="https://agnt.gg">🌐 Website</a> •
  <a href="#-features">✨ Features</a> •
  <a href="#-installation">📦 Installation</a> •
  <a href="#-quick-start">🏃 Quick Start</a> •
  <a href="docs/_API-DOCUMENTATION.md">📚 API Docs</a> •
  <a href="#-plugin-development">🔌 Plugins</a> •
  <a href="https://discord.gg/agnt">💬 Discord</a>
</p>

<br>

<p align="center">
  <img src="https://agnt.gg/_assets/images/agnt-banner.png" alt="AGNT Hero Banner" width="100%">
</p>

---

## 👥 Who Is This For?

**AGNT is local-first and designed for:**

- ✅ **Single users** - Run on your personal computer
- ✅ **Families** - Share across household devices
- ✅ **Small teams** - 2-10 people in your organization

**NOT designed for:**

- ❌ Multi-tenant SaaS (isolating hundreds of unrelated users)
- ❌ Public hosting (each org should self-host their own instance)
- ❌ Large enterprises (50+ concurrent users)

AGNT uses SQLite and real-time sync that broadcasts to all connected clients. Perfect for trusted groups sharing a workspace, not for isolating thousands of separate organizations.

---

## 🎯 Why AGNT?

<table>
<tr>
<td width="50%">

### 🚀 **Zero to Agent in Minutes**

No complex setup. No coding required. Just install, connect your AI provider, and start building intelligent agents.

### 🔗 **Connect Everything**

9+ AI providers, 50+ built-in tools, webhooks, and a plugin marketplace. If it has an API, AGNT can connect to it.

### 🎨 **Visual-First Design**

Drag-and-drop workflow designer that makes complex automation accessible to everyone.

</td>
<td width="50%">

### 🔌 **Infinitely Extensible**

Build custom plugins with our VSCode-style distribution system. Share with the community or keep them private.

### 🎯 **Goal-Oriented AI**

Set objectives and let your agents work autonomously towards them with built-in progress tracking.

### 🖥️ **True Desktop Power**

Native desktop app with full system access. No browser limitations. Your data stays on your machine.

</td>
</tr>
</table>

---

## ✨ Features

<p align="center">
  <img src="https://img.shields.io/badge/AI%20Providers-9+-blueviolet?style=for-the-badge" alt="9+ AI Providers">
  <img src="https://img.shields.io/badge/Built--in%20Tools-50+-green?style=for-the-badge" alt="50+ Tools">
  <img src="https://img.shields.io/badge/Plugin%20System-Extensible-orange?style=for-the-badge" alt="Extensible">
  <img src="https://img.shields.io/badge/No%20Code-Required-blue?style=for-the-badge" alt="No Code Required">
</p>

### 🤖 AI Agent Management

<img align="right" src="https://agnt.gg/_assets/images/chat-ui-md-1.png" alt="Agent Chat" width="100%">

&nbsp;

- **Multi-Provider Support** — Connect to OpenAI, Anthropic, Google Gemini, Groq, Cerebras, DeepSeek, and more
- **Custom Agents** — Create specialized agents with unique personalities, capabilities, and tool access
- **Agent Forge** — AI-powered agent generation from natural language descriptions
- **Real-time Chat** — Interactive conversations with streaming responses
- **Memory & Context** — Agents remember conversation history and learn from interactions

<br clear="right"/>

### 🔧 Visual Workflow Designer

<img align="left" src="https://agnt.gg/_assets/images/agent-workflow-1.png" alt="Workflow Designer" width="100%">

&nbsp;

- **Drag-and-Drop Interface** — Build complex workflows visually without coding
- **50+ Built-in Tools** — Triggers, actions, utilities, and widgets ready to use
- **Conditional Logic** — Branch workflows based on conditions and data
- **Webhook Integration** — Trigger workflows from external services
- **Real-time Execution** — Watch your workflows run with live status updates

<br clear="left"/>

### 🔌 Extensible Plugin System

```
┌─────────────────────────────────────────────────────────────┐
│  📦 Plugin Marketplace                                       │
├─────────────────────────────────────────────────────────────┤
│  🔷 Discord Bot        🔷 GitHub Actions    🔷 Slack         │
│  🔷 Gmail              🔷 Google Sheets     🔷 Notion        │
│  🔷 Twitter/X          🔷 Stripe            🔷 Zapier        │
│  🔷 YouTube            🔷 Dropbox           🔷 And more...   │
└─────────────────────────────────────────────────────────────┘
```

- **VSCode/Figma-style Distribution** — Install plugins as `.agnt` packages
- **No Dependencies Required** — Plugins come pre-bundled with all dependencies
- **Hot Reload** — Install and uninstall plugins without restarting
- **Plugin Marketplace** — Browse and install community plugins
- **AI Plugin Generator** — Describe what you need, AI builds the plugin

### 🎯 Goal-Oriented Automation

- **Autonomous Goals** — Set objectives and let agents work towards them
- **Progress Tracking** — Monitor goal completion and agent performance
- **Golden Standards** — Save successful executions as templates
- **Evaluation Reports** — AI-powered analysis of goal completion

### 🛠️ Developer Tools

- **Tool Forge** — Create custom tools with AI assistance
- **MCP Server Support** — Connect to Model Context Protocol servers
- **Comprehensive API** — Full REST API for programmatic control
- **E2E Testing** — Playwright-based test suite included
- **WebSocket Streaming** — Real-time updates and notifications

---

## 🖼️ Screenshots

<p align="center">
  <img src="https://agnt.gg/_assets/images/dashboard-1.png" alt="Dashboard" width="45%">
  <img src="https://agnt.gg/_assets/images/multi-agent-1.png" alt="Agents" width="45%">
</p>
<p align="center">
  <img src="https://agnt.gg/_assets/images/unlimited-canvas-1.png" alt="Workflow Canvas" width="45%">
  <img src="https://agnt.gg/_assets/images/asset-marketplace-1.png" alt="Marketplace" width="45%">
</p>

---

## 📦 Installation

### Prerequisites

<p align="left">
  <img src="https://img.shields.io/badge/Node.js-v18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js v18+">
  <img src="https://img.shields.io/badge/npm-v9+-CB3837?style=flat-square&logo=npm&logoColor=white" alt="npm v9+">
  <img src="https://img.shields.io/badge/Git-Required-F05032?style=flat-square&logo=git&logoColor=white" alt="Git Required">
</p>

### Quick Install

```bash
# Clone the repository
git clone https://github.com/agnt-gg/agnt.git
cd agnt/desktop

# Install dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Start the application
npm start
```

### 🐳 Docker Install (Self-Hosting)

Use Docker for an isolated, production-ready deployment.

#### Option A: Pull Pre-built Images from GHCR (Recommended)

```bash
# Full version with browser automation (~1.5GB) - Port 33333
docker run -d \
  --name agnt-full \
  -p 33333:33333 \
  -v agnt-data:/root/.agnt/data \
  ghcr.io/agnt-gg/agnt:latest

# Access at http://localhost:33333
```

```bash
# Lite version without browser automation (~715MB) - Port 3333
docker run -d \
  --name agnt-lite \
  -p 3333:3333 \
  -v agnt-data:/root/.agnt/data \
  ghcr.io/agnt-gg/agnt:lite

# Access at http://localhost:3333
```

**Available tags:**
- `latest` / `full` - Latest Full variant with browser automation
- `lite` - Latest Lite variant without browser automation
- `v0.3.7` / `v0.3.7-full` - Specific version (Full)
- `v0.3.7-lite` - Specific version (Lite)

#### Option B: Build from Source (Advanced)

```bash
# Clone the repository
git clone https://github.com/agnt-gg/agnt.git
cd agnt

# Option 1: Full version with browser automation (~1.5GB) - Port 33333
docker-compose up -d
# Access at http://localhost:33333

# Option 2: Lite version without browser automation (~715MB) - Port 3333
docker-compose -f docker-compose.lite.yml up -d
# Access at http://localhost:3333

# Option 3: Run both versions simultaneously
docker-compose -f docker-compose.both.yml up -d
# Full: http://localhost:33333
# Lite: http://localhost:3333

# Or use the Makefile
make run-both
```

**Docker variants available:**
- 🔋 **Full** (~1.5GB): Includes Chromium for web scraping & browser automation (Port **33333**)
- 🪶 **Lite** (~715MB): Smaller image without browser features, ~52% smaller (Port **3333**)
- 🚀 **Both**: Run full and lite versions side-by-side for testing

**Desktop installers available:**
- 💻 **Electron Full** (~150-200MB): Portable desktop app with browser automation
- 📦 **Electron Lite** (~80-120MB): Lightweight desktop app, ~50% smaller

📖 See the [Self-Hosting Guide](docs/SELF_HOSTING.md) for complete Docker setup, networking, and configuration.

### 📥 Download Pre-built Binaries

<p align="center">
  <a href="https://agnt.gg/downloads/">
    <img src="https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows">
  </a>
  <a href="https://agnt.gg/downloads/">
    <img src="https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS">
  </a>
  <a href="https://agnt.gg/downloads/">
    <img src="https://img.shields.io/badge/Download-GNU/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Download for GNU/Linux">
  </a>
</p>

### Platform-Specific Notes

<details>
<summary><strong>🪟 Windows</strong></summary>

Windows users may need to install build tools for native modules:

```bash
npm install --global windows-build-tools
```

</details>

<details>
<summary><strong>🍎 macOS</strong></summary>

Ensure Xcode Command Line Tools are installed:

```bash
xcode-select --install
```

</details>

<details>
<summary><strong>🐧 GNU/Linux</strong></summary>

Install required system dependencies:

```bash
# Ubuntu/Debian
sudo apt-get install build-essential libx11-dev libxkbfile-dev

# Fedora
sudo dnf install gcc-c++ make libX11-devel libxkbfile-devel
```

See [GNU/Linux Build Instructions](docs/_LINUX-BUILD-INSTRUCTIONS.md) for detailed setup.

</details>

---

## 🏃 Quick Start

### Development Mode

Run the frontend and backend separately for hot-reloading:

```bash
# Terminal 1: Start the frontend dev server
cd frontend
npm run dev

# Terminal 2: Start the Electron app
npm start
```

### Production Mode

Build and run the production version:

```bash
# Build the frontend
cd frontend && npm run build && cd ..

# Start the app
npm start
```

---

## 🏗️ Building for Distribution

Create distributable packages for your platform:

```bash
# Build for current platform
npm run build

# Build for specific platforms
npm run build:win      # Windows (NSIS installer)
npm run build:mac      # macOS (DMG + ZIP)
npm run build:linux    # GNU/Linux (AppImage, DEB, RPM)

# Build for all platforms
npm run build:all
```

### 🪶 Lite Mode - Smaller Desktop Builds

Build **AGNT Lite** variants that exclude browser automation for ~50% smaller installers:

```bash
# Build Lite variant (~80-120MB vs ~150-200MB)
npm run build:lite
npm run build:lite:win      # Windows
npm run build:lite:mac      # macOS
npm run build:lite:linux    # GNU/Linux

# Build BOTH Full and Lite (recommended)
npm run build:both
npm run build:both:win
npm run build:both:mac
npm run build:both:linux
```

**Lite Mode removes:**
- ❌ Puppeteer/Playwright browser automation
- ❌ Web scraping tools
- ❌ Screenshot capture via browser

**Everything else works:**
- ✅ AI agents and workflows
- ✅ All API integrations
- ✅ Plugins, image processing, email automation

📖 See [Electron Lite Mode Guide](docs/ELECTRON_LITE_MODE.md) for details.

Build outputs are saved to the `dist/` directory:

### Build Artifacts

| Platform | Full | Lite | Size Reduction |
| -------- | ---- | ---- | -------------- |
| Windows | AGNT-0.3.7-win-x64.exe (~150MB) | AGNT-Lite-0.3.7-win-x64.exe (~80MB) | ~47% |
| macOS | AGNT-0.3.7-mac-x64.dmg (~200MB) | AGNT-Lite-0.3.7-mac-x64.dmg (~120MB) | ~40% |
| GNU/Linux | AppImage (~180MB), DEB, RPM | AppImage (~100MB), DEB, RPM | ~44% |

---

## 🔌 Plugin Development

AGNT features a powerful plugin system that allows you to extend functionality with custom tools.

### Creating a Plugin

```bash
# Navigate to the plugins development directory
cd backend/plugins/dev

# Create your plugin directory
mkdir my-awesome-plugin
cd my-awesome-plugin
```

Create a `manifest.json`:

```json
{
  "name": "my-awesome-plugin",
  "version": "1.0.0",
  "description": "Does something awesome",
  "author": "Your Name",
  "tools": [
    {
      "type": "awesome-tool",
      "entryPoint": "./awesome-tool.js",
      "schema": {
        "title": "Awesome Tool",
        "category": "action",
        "description": "Performs awesome operations",
        "parameters": {
          "input": {
            "type": "string",
            "description": "Input value"
          }
        }
      }
    }
  ]
}
```

Create your tool implementation (`awesome-tool.js`):

```javascript
class AwesomeTool {
  constructor() {
    this.name = 'awesome-tool';
  }

  async execute(params, inputData, workflowEngine) {
    // Your tool logic here
    return {
      success: true,
      result: `Processed: ${params.input}`,
      error: null,
    };
  }
}

export default new AwesomeTool();
```

Build and install:

```bash
cd backend/plugins
node build-plugin.js my-awesome-plugin
```

📚 See the full [Plugin Development Guide](backend/plugins/README.md) for more details.

---

## 🗂️ Project Structure

```
desktop/
├── 📄 main.js              # Electron main process
├── 📄 preload.js           # Preload scripts for IPC
├── 📄 package.json         # Project configuration
│
├── 📁 backend/             # Express.js backend server
│   ├── 📄 server.js        # Server entry point
│   ├── 📁 src/
│   │   ├── 📁 routes/      # API route handlers
│   │   ├── 📁 services/    # Business logic
│   │   ├── 📁 models/      # Data models
│   │   └── 📁 plugins/     # Plugin management
│   └── 📁 plugins/         # Plugin development & builds
│
├── 📁 frontend/            # Vue.js frontend application
│   ├── 📁 src/
│   │   ├── 📁 views/       # Page components
│   │   ├── 📁 components/  # Reusable components
│   │   ├── 📁 store/       # Vuex state management
│   │   └── 📁 services/    # API services
│   └── 📁 public/          # Static assets
│
├── 📁 build/               # Build resources & icons
├── 📁 docs/                # Documentation
└── 📁 tests/               # E2E test suites
```

---

## 🧪 Testing

Run the end-to-end test suite:

```bash
# Run all tests
npm run test:e2e

# Run specific test file
npx playwright test tests/e2e/agents.spec.js
```

See [Testing Instructions](docs/_TESTS_INSTRUCTIONS.md) for more details.

---

## 📖 Documentation

| Document                                                  | Description                        |
| --------------------------------------------------------- | ---------------------------------- |
| [📚 API Documentation](docs/_API-DOCUMENTATION.md)        | Complete REST API reference        |
| [🔨 Build Instructions](docs/_BUILD-INSTRUCTIONS.md)      | Detailed build guide               |
| [🐧 GNU/Linux Build Guide](docs/_LINUX-BUILD-INSTRUCTIONS.md) | GNU/Linux-specific setup               |
| [🐳 Self-Hosting Guide](docs/SELF_HOSTING.md)             | Docker deployment & hosting        |
| [🪶 Docker Lite Mode](docs/LITE_MODE.md)                  | Docker without browser automation  |
| [🪶 Electron Lite Mode](docs/ELECTRON_LITE_MODE.md)       | Smaller desktop builds (~50% size) |
| [🔌 Plugin Development](backend/plugins/README.md)        | Creating custom plugins            |
| [🔧 Rebuild Guide](docs/_REBUILD-INSTRUCTIONS.md)         | Native module rebuilding           |
| [🚀 CI/CD Pipelines](docs/CI_CD.md)                       | GitHub Actions workflows           |

---

## 🔗 Supported AI Providers

<p align="center">
  <img src="https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI">
  <img src="https://img.shields.io/badge/Anthropic-191919?style=for-the-badge&logo=anthropic&logoColor=white" alt="Anthropic">
  <img src="https://img.shields.io/badge/Google%20Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Google Gemini">
  <img src="https://img.shields.io/badge/Groq-000000?style=for-the-badge" alt="Groq">
</p>
<p align="center">
  <img src="https://img.shields.io/badge/Cerebras-FF6B35?style=for-the-badge" alt="Cerebras">
  <img src="https://img.shields.io/badge/DeepSeek-0066FF?style=for-the-badge" alt="DeepSeek">
  <img src="https://img.shields.io/badge/OpenRouter-7C3AED?style=for-the-badge" alt="OpenRouter">
  <img src="https://img.shields.io/badge/Together%20AI-FF4500?style=for-the-badge" alt="Together AI">
</p>

| Provider    | Models                      | Status       |
| ----------- | --------------------------- | ------------ |
| OpenAI      | GPT-4, GPT-4 Turbo, GPT-3.5 | ✅ Supported |
| Anthropic   | Claude 3.5, Claude 3        | ✅ Supported |
| Google      | Gemini Pro, Gemini Ultra    | ✅ Supported |
| Groq        | Llama 3, Mixtral            | ✅ Supported |
| Cerebras    | Fast inference models       | ✅ Supported |
| DeepSeek    | DeepSeek Coder, Chat        | ✅ Supported |
| OpenRouter  | 100+ models                 | ✅ Supported |
| Together AI | Open source models          | ✅ Supported |
| Custom      | Any OpenAI-compatible API   | ✅ Supported |

---

## 🤝 Contributing

<p align="center">
  <img src="https://img.shields.io/badge/contributions-welcome-brightgreen.svg?style=for-the-badge" alt="Contributions Welcome">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge" alt="PRs Welcome">
</p>

We welcome contributions! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines

- Follow the existing code style
- Write tests for new features
- Update documentation as needed
- Keep commits atomic and well-described

---

## ⭐ Star History

<p align="center">
  <a href="https://star-history.com/#agnt-gg/agnt&Date">
    <img src="https://api.star-history.com/svg?repos=agnt-gg/agnt&type=Date" alt="Star History Chart" width="600">
  </a>
</p>

---

## 📊 Project Stats

<p align="center">
  <img src="https://img.shields.io/github/stars/agnt-gg/agnt?style=social" alt="GitHub Stars">
  <img src="https://img.shields.io/github/forks/agnt-gg/agnt?style=social" alt="GitHub Forks">
  <img src="https://img.shields.io/github/watchers/agnt-gg/agnt?style=social" alt="GitHub Watchers">
</p>

<p align="center">
  <img src="https://img.shields.io/github/issues/agnt-gg/agnt?style=flat-square" alt="GitHub Issues">
  <img src="https://img.shields.io/github/issues-pr/agnt-gg/agnt?style=flat-square" alt="GitHub PRs">
  <img src="https://img.shields.io/github/last-commit/agnt-gg/agnt?style=flat-square" alt="Last Commit">
  <img src="https://img.shields.io/github/commit-activity/m/agnt-gg/agnt?style=flat-square" alt="Commit Activity">
</p>

---

## 📄 License

This project is licensed under a Custom License. See [LICENSE.md](../LICENSE.md) for details.

---

## 🙏 Acknowledgments

<p align="center">
  <a href="https://www.electronjs.org/">
    <img src="https://img.shields.io/badge/Built%20with-Electron-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Built with Electron">
  </a>
  <a href="https://vuejs.org/">
    <img src="https://img.shields.io/badge/Powered%20by-Vue.js-4FC08D?style=for-the-badge&logo=vue.js&logoColor=white" alt="Powered by Vue.js">
  </a>
  <a href="https://expressjs.com/">
    <img src="https://img.shields.io/badge/Backend-Express.js-000000?style=for-the-badge&logo=express&logoColor=white" alt="Backend Express.js">
  </a>
</p>

- Built with [Electron](https://www.electronjs.org/)
- Frontend powered by [Vue.js](https://vuejs.org/)

---

<p align="center">
  <img src="assets/icon.png" alt="AGNT Logo" width="60" height="60">
</p>

<h3 align="center">Built with ❤️ by <a href="https://x.com/NathanWilbanks_">Nathan Wilbanks</a></h3>

<p align="center">
  <a href="https://agnt.gg">
    <img src="https://img.shields.io/badge/Website-agnt.gg-blueviolet?style=for-the-badge" alt="Website">
  </a>
  <a href="https://twitter.com/agnt_gg">
    <img src="https://img.shields.io/badge/Twitter-@agnt__gg-1DA1F2?style=for-the-badge&logo=twitter&logoColor=white" alt="Twitter">
  </a>
  <a href="https://discord.gg/agnt">
    <img src="https://img.shields.io/badge/Discord-Join%20Us-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord">
  </a>
</p>

<p align="center">
  <sub>If you find AGNT useful, please consider giving it a ⭐ on GitHub!</sub>
</p>
