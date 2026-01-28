# AGNT Plugin Development Guide

This comprehensive guide covers everything you need to know to create, test, and distribute plugins for AGNT.

## Table of Contents

1. [Overview](#overview)
2. [Application Architecture](#application-architecture)
3. [Plugin Architecture](#plugin-architecture)
4. [Quick Start](#quick-start)
5. [Plugin Structure](#plugin-structure)
6. [Manifest File](#manifest-file)
7. [Creating Tools](#creating-tools)
8. [Schema Definition](#schema-definition)
9. [Authentication](#authentication)
10. [Dependencies](#dependencies)
11. [Building & Packaging](#building--packaging)
12. [Installation Methods](#installation-methods)
13. [API Reference](#api-reference)
14. [Best Practices](#best-practices)
15. [Troubleshooting](#troubleshooting)
16. [Examples](#examples)

---

## Overview

AGNT's plugin system allows you to extend the platform with custom tools, triggers, and integrations. Plugins are self-contained packages that can:

- Add new workflow nodes (actions, triggers, utilities)
- Integrate with external APIs and services
- Bundle their own NPM dependencies
- Be distributed via the marketplace or manually installed

### Why Plugins?

- **Modularity**: Users only install what they need, keeping the app lightweight
- **Extensibility**: Anyone can create and share custom integrations
- **Isolation**: Each plugin manages its own dependencies
- **Updates**: Plugins can be updated independently of the core app

---

## Application Architecture

AGNT is an **Electron + Node.js desktop application** with a dual-process architecture:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Electron Main Process                         │
│  (main.js - Window management, IPC, process orchestration)          │
├─────────────────────────────────────────────────────────────────────┤
│         │                                                            │
│         │ spawns (utilityProcess.fork / child_process.fork)         │
│         ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              Node.js Backend (server.js)                     │    │
│  │  Express.js on localhost:3333                                │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │    │
│  │  │ API Routes  │  │  Services   │  │ Workflow Engine  │    │    │
│  │  └─────────────┘  └─────────────┘  └──────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              Vue 3 Frontend (Vite)                           │    │
│  │  Served from backend or dev server (localhost:5173)          │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### ASAR Packaging & User Data

In production, the app code is bundled into an **ASAR archive** (read-only). Plugins and user data live **outside the ASAR** in the user data directory:

| Platform | User Data Path                               |
| -------- | -------------------------------------------- |
| Windows  | `%APPDATA%\AGNT\`                            |
| macOS    | `~/Library/Application Support/AGNT/`        |
| Linux    | `~/.config/AGNT/`                            |

**User Data Structure:**
```
AGNT/
├── Data/
│   └── agnt.db              # SQLite database
├── plugins/
│   ├── installed/           # Installed plugins (writable)
│   │   ├── discord-plugin/
│   │   ├── notion-plugin/
│   │   └── ...
│   └── registry.json        # Plugin registry
├── .env                     # Environment config
└── mcp.json                 # MCP server config
```

### Environment Variables

Electron sets these environment variables for the backend process:

| Variable         | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `APP_PATH`       | Path to the app bundle (ASAR root in production)          |
| `USER_DATA_PATH` | Path to user data directory (platform-specific)           |
| `UNPACKED_PATH`  | Path to unpacked native modules                           |
| `NODE_ENV`       | `production` or `development`                             |

**Important for plugins:** Use `APP_PATH` to access core app modules (like AuthManager) since plugins are in a separate directory.

### Technology Stack

| Component        | Technology                                              |
| ---------------- | ------------------------------------------------------- |
| Desktop Shell    | Electron 33.x                                           |
| Backend          | Node.js + Express.js                                    |
| Frontend         | Vue 3 + Vite                                            |
| Database         | SQLite (WAL mode)                                       |
| Web Automation   | Puppeteer + Playwright (uses system Chrome/Edge)        |
| Package Format   | ASAR archive                                            |

**Note:** The desktop app does **not** use Docker. It runs as a native Electron application with a Node.js backend process. Web scraping/automation uses the system's installed Chrome or Edge browser via Puppeteer.

---

## Plugin Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AGNT Application                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ ToolRegistry │◄───│PluginManager │───►│ NodeExecutor │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         ▲                   │                    │          │
│         │                   ▼                    │          │
│         │         ┌──────────────────┐          │          │
│         │         │PluginInstaller   │          │          │
│         │         └──────────────────┘          │          │
│         │                   │                    │          │
│         │                   ▼                    │          │
│  ┌──────┴───────────────────────────────────────┴──────┐   │
│  │         User Data: plugins/installed/                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │discord-plugin│  │github-plugin│  │custom-plugin│  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

| Component           | Location                                            | Description                                         |
| ------------------- | --------------------------------------------------- | --------------------------------------------------- |
| **PluginManager**   | `backend/src/plugins/PluginManager.js`              | Loads and registers plugins at startup              |
| **PluginInstaller** | `backend/src/plugins/PluginInstaller.js`            | Handles installation from registry, NPM, or files   |
| **ToolRegistry**    | `backend/src/tools/ToolRegistry.js`                 | Central registry for all tools (built-in + plugins) |
| **NodeExecutor**    | `backend/src/workflow/NodeExecutor.js`              | Executes workflow nodes, including plugin tools     |

---

## Quick Start

### 1. Create Plugin Directory

```bash
mkdir my-plugin
cd my-plugin
```

### 2. Create manifest.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My awesome AGNT plugin",
  "author": "Your Name",
  "icon": "magic",
  "tools": [
    {
      "type": "my-custom-tool",
      "entryPoint": "./my-tool.js",
      "schema": {
        "title": "My Custom Tool",
        "category": "action",
        "type": "my-custom-tool",
        "icon": "magic",
        "description": "Does something awesome",
        "parameters": {
          "input": {
            "type": "string",
            "inputType": "text",
            "description": "Input value"
          }
        },
        "outputs": {
          "result": {
            "type": "string",
            "description": "The result"
          }
        }
      }
    }
  ]
}
```

### 3. Create Tool Implementation

```javascript
// my-tool.js
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules (required for AuthManager access)
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

class MyCustomTool {
  static schema = null; // Will be set from manifest

  constructor() {
    this.name = 'my-custom-tool';
  }

  async execute(params, inputData, workflowEngine) {
    const { input } = params;

    // Your logic here
    const result = `Processed: ${input}`;

    return { result };
  }
}

export default new MyCustomTool();
```

### 4. Build & Install

```bash
# From the plugins directory (desktop/backend/plugins/)
node build-plugin.js ./dev/my-plugin

# Or install manually via UI (Settings → Integrations → Plugins → Marketplace)
```

---

## Plugin Structure

A plugin must have the following structure:

```
my-plugin/
├── manifest.json          # Required: Plugin metadata and tool definitions
├── package.json           # Optional: NPM dependencies
├── my-tool.js            # Tool implementation files
├── another-tool.js
├── utils/                 # Optional: Helper modules
│   └── helpers.js
└── node_modules/          # Auto-installed dependencies
```

### Required Files

| File            | Description                                    |
| --------------- | ---------------------------------------------- |
| `manifest.json` | Plugin metadata, tool definitions, and schemas |

### Optional Files

| File           | Description                     |
| -------------- | ------------------------------- |
| `package.json` | NPM dependencies for the plugin |
| `*.js`         | Tool implementation files       |
| `README.md`    | Documentation for your plugin   |

---

## Manifest File

The `manifest.json` is the heart of your plugin. It defines metadata, tools, and their schemas.

### Full Manifest Schema

```json
{
  "name": "plugin-name",
  "version": "1.0.0",
  "description": "What your plugin does",
  "author": "Your Name",
  "icon": "plugin-icon",
  "tools": [
    {
      "type": "tool-type-identifier",
      "entryPoint": "./tool-file.js",
      "schema": {
        /* Tool schema */
      }
    }
  ]
}
```

### Extended Manifest Schema (Optional Fields)

```json
{
  "name": "plugin-name",
  "version": "1.0.0",
  "description": "What your plugin does",
  "author": "Your Name",
  "icon": "plugin-icon",
  "homepage": "https://github.com/you/plugin",
  "license": "MIT",
  "tools": [
    {
      "type": "tool-type-identifier",
      "entryPoint": "./tool-file.js",
      "schema": {
        /* Tool schema */
      }
    }
  ]
}
```

### Manifest Fields

| Field         | Type   | Required | Description                                                   |
| ------------- | ------ | -------- | ------------------------------------------------------------- |
| `name`        | string | ✅       | Unique plugin identifier (kebab-case, e.g., "discord-plugin") |
| `version`     | string | ✅       | Semantic version (e.g., "1.0.0")                              |
| `description` | string | ✅       | Brief description of the plugin                               |
| `author`      | string | ✅       | Plugin author name                                            |
| `icon`        | string | ✅       | Icon name for the plugin (FontAwesome or custom)              |
| `tools`       | array  | ✅       | Array of tool definitions                                     |
| `homepage`    | string | ❌       | URL to plugin homepage/repo                                   |
| `license`     | string | ❌       | License identifier                                            |

### Tool Definition Fields

| Field        | Type   | Required | Description                                                     |
| ------------ | ------ | -------- | --------------------------------------------------------------- |
| `type`       | string | ✅       | Unique tool identifier (kebab-case, e.g., "discord-api")        |
| `entryPoint` | string | ✅       | Path to the tool implementation file (e.g., "./discord-api.js") |
| `schema`     | object | ✅       | Tool schema definition (see Schema Definition section)          |

---

## Creating Tools

### Tool Class Structure

Every tool must export a class instance with an `execute` method:

```javascript
class MyTool {
  // Optional: Define schema in the class (can also be in manifest)
  static schema = {
    title: 'My Tool',
    category: 'action',
    type: 'my-tool',
    // ... rest of schema
  };

  constructor() {
    this.name = 'my-tool';
  }

  /**
   * Execute the tool
   * @param {Object} params - Resolved parameters from the workflow node
   * @param {Object} inputData - Data from the previous node
   * @param {WorkflowEngine} workflowEngine - Reference to the workflow engine
   * @returns {Object} Output data for the next node
   */
  async execute(params, inputData, workflowEngine) {
    // Your implementation
    return {
      /* outputs */
    };
  }
}

export default new MyTool();
```

### Execute Method Parameters

| Parameter        | Type           | Description                                   |
| ---------------- | -------------- | --------------------------------------------- |
| `params`         | Object         | User-configured parameters (already resolved) |
| `inputData`      | Object         | Output from the previous node in the workflow |
| `workflowEngine` | WorkflowEngine | Access to workflow context, user ID, etc.     |

### Accessing Workflow Context

```javascript
async execute(params, inputData, workflowEngine) {
  // Get user ID
  const userId = workflowEngine.userId;

  // Get workflow ID
  const workflowId = workflowEngine.workflowId;

  // Access outputs from other nodes
  const previousOutput = workflowEngine.outputs['node-id'];

  // Access trigger data
  const triggerData = workflowEngine.currentTriggerData;

  return { /* outputs */ };
}
```

### Error Handling

```javascript
async execute(params, inputData, workflowEngine) {
  try {
    // Your logic
    const result = await someOperation();
    return { success: true, result };
  } catch (error) {
    // Return error in output (workflow continues)
    return {
      success: false,
      error: error.message
    };

    // OR throw to stop workflow execution
    // throw new Error(`Tool failed: ${error.message}`);
  }
}
```

---

## Schema Definition

The schema defines how your tool appears in the UI and what parameters it accepts.

### Complete Schema Example

```json
{
  "title": "Discord Send Message",
  "category": "action",
  "type": "discord-send-message",
  "icon": "discord",
  "description": "Send a message to a Discord channel",
  "documentation": "https://docs.example.com/discord",
  "authRequired": "apiKey",
  "authProvider": "discord",
  "parameters": {
    "channelId": {
      "type": "string",
      "inputType": "text",
      "description": "The Discord channel ID",
      "required": true
    },
    "message": {
      "type": "string",
      "inputType": "textarea",
      "description": "Message content to send",
      "required": true
    },
    "embedEnabled": {
      "type": "string",
      "inputType": "select",
      "options": ["Yes", "No"],
      "default": "No",
      "description": "Include an embed?"
    },
    "embedTitle": {
      "type": "string",
      "inputType": "text",
      "description": "Embed title",
      "conditional": {
        "field": "embedEnabled",
        "value": "Yes"
      }
    }
  },
  "outputs": {
    "success": {
      "type": "boolean",
      "description": "Whether the message was sent"
    },
    "messageId": {
      "type": "string",
      "description": "ID of the sent message"
    },
    "error": {
      "type": "string",
      "description": "Error message if failed"
    }
  }
}
```

### Schema Fields

| Field           | Type    | Required | Description                                                           |
| --------------- | ------- | -------- | --------------------------------------------------------------------- |
| `title`         | string  | ✅       | Display name in UI                                                    |
| `category`      | string  | ✅       | One of: `trigger`, `action`, `utility`, `widget`, `control`, `custom` |
| `type`          | string  | ✅       | Unique identifier (kebab-case)                                        |
| `icon`          | string  | ❌       | Icon name (FontAwesome or custom)                                     |
| `description`   | string  | ✅       | What the tool does                                                    |
| `documentation` | string  | ❌       | URL to documentation                                                  |
| `authRequired`  | string  | ❌       | `apiKey` or `oauth`                                                   |
| `authProvider`  | string  | ❌       | Provider name for auth                                                |
| `requiresPro`   | boolean | ❌       | Requires pro subscription                                             |
| `parameters`    | object  | ❌       | Input parameters                                                      |
| `outputs`       | object  | ❌       | Output fields                                                         |

### Parameter Types

| inputType      | Description            | Additional Options  |
| -------------- | ---------------------- | ------------------- |
| `text`         | Single-line text input | -                   |
| `textarea`     | Multi-line text input  | -                   |
| `number`       | Numeric input          | -                   |
| `select`       | Dropdown selection     | `options: string[]` |
| `checkbox`     | Multiple selection     | `options: string[]` |
| `password`     | Hidden text input      | -                   |
| `codearea`     | Code editor            | -                   |
| `time`         | Time picker (HH:MM)    | -                   |
| `readonly`     | Display-only field     | `value: string`     |
| `agent-select` | Agent selector         | -                   |

### Conditional Parameters

Show/hide parameters based on other values:

```json
{
  "embedTitle": {
    "type": "string",
    "inputType": "text",
    "description": "Embed title",
    "conditional": {
      "field": "embedEnabled",
      "value": "Yes"
    }
  }
}
```

Multiple values:

```json
{
  "conditional": {
    "field": "action",
    "value": ["CREATE", "UPDATE"]
  }
}
```

### Parameter Sizing

```json
{
  "minValue": {
    "type": "number",
    "inputType": "number",
    "inputSize": "half",
    "description": "Minimum value"
  },
  "maxValue": {
    "type": "number",
    "inputType": "number",
    "inputSize": "half",
    "description": "Maximum value"
  }
}
```

---

## Authentication

### Understanding Plugin Paths

**Important:** Plugins run from the user data directory (`%APPDATA%/AGNT/plugins/installed/`), not from the app bundle. To access core app modules like AuthManager, you must use the `APP_PATH` environment variable.

### Setting Up Path Resolution

Every plugin that needs authentication should include this boilerplate at the top:

```javascript
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron main process, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');
```

### API Key Authentication

For services that use API keys:

```json
{
  "authRequired": "apiKey",
  "authProvider": "discord"
}
```

Access in your tool:

```javascript
async execute(params, inputData, workflowEngine) {
  // Import AuthManager using APP_PATH for correct resolution
  const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
  const AuthManagerModule = await import(`file://${authManagerPath.replace(/\\/g, '/')}`);
  const AuthManager = AuthManagerModule.default;

  const apiKey = await AuthManager.getValidAccessToken(workflowEngine.userId, 'discord');

  if (!apiKey) {
    throw new Error('No valid access token found. Please reconnect to Discord in Settings.');
  }

  // Use apiKey for API calls
}
```

### OAuth Authentication

For services that use OAuth:

```json
{
  "authRequired": "oauth",
  "authProvider": "google"
}
```

Access in your tool:

```javascript
async execute(params, inputData, workflowEngine) {
  // Import AuthManager using APP_PATH for correct resolution
  const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
  const AuthManagerModule = await import(`file://${authManagerPath.replace(/\\/g, '/')}`);
  const AuthManager = AuthManagerModule.default;

  const accessToken = await AuthManager.getValidAccessToken(
    workflowEngine.userId,
    'google'
  );

  if (!accessToken) {
    throw new Error('No valid access token found. Please connect to Google in Settings.');
  }

  // Use accessToken for API calls
}
```

### Why `file://` Protocol?

The `file://` protocol with forward slashes is required for dynamic imports on Windows. The `.replace(/\\/g, '/')` converts Windows backslashes to forward slashes for URL compatibility.

### Supported Auth Providers

| Provider         | Type   | Description        |
| ---------------- | ------ | ------------------ |
| `openai`         | apiKey | OpenAI API         |
| `anthropic`      | apiKey | Anthropic API      |
| `google`         | oauth  | Google services    |
| `github`         | oauth  | GitHub API         |
| `slack`          | oauth  | Slack API          |
| `discord`        | apiKey | Discord Bot Token  |
| `twitter`        | oauth  | Twitter/X API      |
| `stripe`         | apiKey | Stripe API         |
| `notion`         | oauth  | Notion API         |
| `openweathermap` | apiKey | OpenWeatherMap API |

---

## Dependencies

### Declaring Dependencies

In your `manifest.json`:

```json
{
  "dependencies": {
    "axios": "^1.6.0",
    "discord.js": "^14.14.0",
    "lodash": "^4.17.21"
  }
}
```

Or in a separate `package.json`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My awesome AGNT plugin",
  "type": "module",
  "dependencies": {
    "axios": "^1.6.0"
  }
}
```

### Real Plugin Package.json Examples

**Discord Plugin:**

```json
{
  "name": "agnt-discord-plugin",
  "version": "1.0.0",
  "description": "Discord integration plugin for AGNT",
  "type": "module",
  "main": "discord-api.js",
  "dependencies": {
    "discord.js": "^14.16.3"
  }
}
```

**Notion Plugin:**

```json
{
  "name": "notion-plugin",
  "version": "1.1.0",
  "description": "Notion integration plugin for AGNT",
  "type": "module",
  "dependencies": {
    "@notionhq/client": "^2.2.15"
  }
}
```

**Google Sheets Plugin:**

```json
{
  "name": "google-sheets-plugin",
  "version": "1.0.0",
  "description": "Google Sheets integration plugin for AGNT",
  "type": "module",
  "dependencies": {
    "googleapis": "^144.0.0"
  }
}
```

### Using Dependencies

```javascript
// Dependencies are installed in the plugin's node_modules
import axios from 'axios';
import _ from 'lodash';

class MyTool {
  async execute(params, inputData, workflowEngine) {
    const response = await axios.get('https://api.example.com/data');
    const processed = _.map(response.data, (item) => item.name);
    return { result: processed };
  }
}
```

### Dependency Installation

Dependencies are automatically installed when:

- Plugin is installed from the marketplace
- Plugin is installed from a .tar.gz file
- Plugin is loaded at startup (if missing)

---

## Building & Packaging

### Development vs Production Paths

| Environment | Plugin Source Location                      | Installed Plugin Location                    |
| ----------- | ------------------------------------------- | -------------------------------------------- |
| Development | `desktop/backend/plugins/dev/`              | Same as source (loaded directly)             |
| Production  | N/A (distributed as .agnt files)            | `%APPDATA%/AGNT/plugins/installed/` (Win)    |
|             |                                             | `~/Library/Application Support/AGNT/plugins/installed/` (Mac) |
|             |                                             | `~/.config/AGNT/plugins/installed/` (Linux)  |

### Using the Build Script

```bash
# Navigate to the plugins directory (from project root)
cd desktop/backend/plugins

# Build a plugin from the dev folder
node build-plugin.js ./dev/my-plugin

# Or build from an absolute path
node build-plugin.js /path/to/my-plugin

# Output: plugin-builds/my-plugin.agnt
```

### Build Script Options

```bash
# Specify output directory
node build-plugin.js /path/to/my-plugin --output ./dist

# Include node_modules (not recommended)
node build-plugin.js /path/to/my-plugin --include-modules
```

### Manual Packaging

```bash
cd my-plugin
# .agnt files are gzipped tar archives
tar -czvf ../my-plugin.agnt .
```

### Package Contents

The `.agnt` file should contain:

- `manifest.json` (required)
- `*.js` files (tool implementations)
- `package.json` (if has dependencies)
- Any other required files

**Do NOT include:**

- `node_modules/` (installed automatically)
- `.git/`
- Test files
- Development files

### File Format

`.agnt` files are gzipped tar archives (same format as `.tar.gz`) with a custom extension for branding. This makes them:

- Easy to recognize as AGNT plugins
- Compatible with standard tar tools
- Simple to create and extract

---

## Installation Methods

### 1. Marketplace (UI)

1. Go to Settings → Integrations → Plugins
2. Click "Marketplace" tab
3. Find your plugin
4. Click "Install"

### 2. Manual File Upload (UI)

1. Go to Settings → Integrations → Plugins
2. Click "Marketplace" tab
3. Scroll to "Manual Installation"
4. Drag & drop your `.agnt` file

### 3. API Installation

```bash
# Install from registry
curl -X POST http://localhost:3333/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"name": "my-plugin", "version": "1.0.0"}'

# Install from file (base64)
curl -X POST http://localhost:3333/api/plugins/install-file \
  -H "Content-Type: application/json" \
  -d '{"name": "my-plugin", "fileData": "base64...", "fileName": "my-plugin.agnt"}'
```

### 4. Direct Installation (Development)

For **development**, copy your plugin folder to the dev directory:

```
desktop/backend/plugins/dev/my-plugin/
```

For **production**, copy to the user data plugins directory:

| Platform | Path                                                      |
| -------- | --------------------------------------------------------- |
| Windows  | `%APPDATA%\AGNT\plugins\installed\my-plugin\`             |
| macOS    | `~/Library/Application Support/AGNT/plugins/installed/my-plugin/` |
| Linux    | `~/.config/AGNT/plugins/installed/my-plugin/`             |

Then restart the server or call:

```bash
curl -X POST http://localhost:3333/api/plugins/reload
```

---

## API Reference

### Plugin Routes

| Method | Endpoint                    | Description            |
| ------ | --------------------------- | ---------------------- |
| GET    | `/api/plugins/installed`    | List installed plugins |
| GET    | `/api/plugins/marketplace`  | List available plugins |
| GET    | `/api/plugins/:name`        | Get plugin details     |
| POST   | `/api/plugins/install`      | Install from registry  |
| POST   | `/api/plugins/install-file` | Install from file      |
| DELETE | `/api/plugins/:name`        | Uninstall plugin       |
| POST   | `/api/plugins/reload`       | Reload all plugins     |

### Response Format

```json
{
  "success": true,
  "plugins": [
    {
      "name": "discord-plugin",
      "version": "1.0.0",
      "description": "Discord integration",
      "author": "AGNT Team",
      "tools": [
        {
          "type": "discord-api",
          "schema": {
            /* ... */
          }
        }
      ],
      "installedAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

## Best Practices

### 1. Naming Conventions

- Plugin name: `kebab-case` (e.g., `discord-plugin`)
- Tool type: `kebab-case` (e.g., `discord-send-message`)
- Use descriptive names that indicate functionality

### 2. Error Handling

```javascript
async execute(params, inputData, workflowEngine) {
  try {
    // Validate required params
    if (!params.channelId) {
      return { success: false, error: 'Channel ID is required' };
    }

    // Your logic
    const result = await this.doSomething(params);

    return { success: true, result };
  } catch (error) {
    console.error(`[${this.name}] Error:`, error);
    return {
      success: false,
      error: error.message || 'Unknown error occurred'
    };
  }
}
```

### 3. Logging

```javascript
async execute(params, inputData, workflowEngine) {
  console.log(`[${this.name}] Starting execution with params:`, params);

  // ... logic ...

  console.log(`[${this.name}] Completed successfully`);
  return result;
}
```

### 4. Documentation

- Include a README.md in your plugin
- Document all parameters clearly
- Provide usage examples
- List any prerequisites or setup steps

### 5. Version Management

- Follow semantic versioning (MAJOR.MINOR.PATCH)
- Document breaking changes
- Test upgrades thoroughly

### 6. Security

- Never hardcode API keys or secrets
- Use the AuthManager for credentials
- Validate and sanitize all inputs
- Be careful with user-provided code execution

---

## Troubleshooting

### Plugin Not Loading

1. Check manifest.json is valid JSON
2. Verify all required fields are present
3. Check server logs for errors
4. Ensure tool files exist and export correctly

### Dependencies Not Installing

1. Check package.json syntax
2. Verify dependency versions exist
3. Check network connectivity
4. Try manual `npm install` in plugin directory

### Tool Not Appearing in UI

1. Verify schema has correct category
2. Check type is unique
3. Reload plugins via API
4. Restart the server

### Execution Errors

1. Check server logs for stack traces
2. Verify parameter types match schema
3. Test with minimal parameters first
4. Add console.log statements for debugging

### AuthManager Import Errors

If you see `Cannot find module` or `ERR_MODULE_NOT_FOUND` for AuthManager:

1. **Wrong path pattern** - Don't use relative paths like `../../../src/services/auth/AuthManager.js`
2. **Missing APP_PATH** - Ensure you're using `process.env.APP_PATH` with a fallback
3. **Windows path issues** - Use `file://` protocol and replace backslashes:
   ```javascript
   const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
   await import(`file://${authManagerPath.replace(/\\/g, '/')}`);
   ```

### Path Resolution Issues

| Environment | APP_PATH Value | Plugin Location |
| ----------- | -------------- | --------------- |
| Development | Project root (e.g., `C:\...\desktop`) | `backend/plugins/dev/` |
| Production  | ASAR root (inside app bundle) | User data directory |

**Debug tip:** Add this to your plugin to see actual paths:
```javascript
console.log('[Plugin] APP_PATH:', APP_PATH);
console.log('[Plugin] __dirname:', __dirname);
console.log('[Plugin] Resolved auth path:', authManagerPath);
```

### Common Errors

| Error               | Cause                    | Solution                                 |
| ------------------- | ------------------------ | ---------------------------------------- |
| `Tool not found`    | Type mismatch            | Ensure manifest type matches file export |
| `Invalid schema`    | Schema validation failed | Check required schema fields             |
| `Module not found`  | Missing dependency       | Add to dependencies in manifest          |
| `Permission denied` | Auth issue               | Check authRequired/authProvider          |
| `ERR_MODULE_NOT_FOUND` | Wrong AuthManager path | Use APP_PATH + file:// protocol (see above) |
| `ENOENT` for plugin | Plugin not in user data  | Install via UI or copy to correct directory |

---

## Examples

### Simple API Tool

```javascript
// weather-api.js
import axios from 'axios';

class WeatherAPI {
  static schema = {
    title: 'Weather API',
    category: 'action',
    type: 'weather-api',
    icon: 'cloud',
    description: 'Get current weather for a location',
    parameters: {
      city: {
        type: 'string',
        inputType: 'text',
        description: 'City name',
      },
    },
    outputs: {
      temperature: { type: 'number', description: 'Temperature in Celsius' },
      conditions: { type: 'string', description: 'Weather conditions' },
      error: { type: 'string', description: 'Error message' },
    },
  };

  constructor() {
    this.name = 'weather-api';
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const response = await axios.get(`https://api.weatherapi.com/v1/current.json?q=${params.city}`);

      return {
        temperature: response.data.current.temp_c,
        conditions: response.data.current.condition.text,
      };
    } catch (error) {
      return { error: error.message };
    }
  }
}

export default new WeatherAPI();
```

### Tool with Authentication (Notion API)

```javascript
// notion-api.js
import { Client } from '@notionhq/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

class NotionAPI {
  constructor() {
    this.name = 'notion-api';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[NotionPlugin] Executing Notion API with params:', JSON.stringify(params, null, 2));

    try {
      // Import AuthManager using APP_PATH for correct resolution
      const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
      const AuthManagerModule = await import(`file://${authManagerPath.replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const accessToken = await AuthManager.getValidAccessToken(workflowEngine.userId, 'notion');
      if (!accessToken) {
        throw new Error('No valid access token found. Please connect to Notion in Settings.');
      }

      const notion = new Client({ auth: accessToken });
      const { operation } = params;

      switch (operation) {
        case 'search':
          return await this.search(notion, params);
        case 'getDatabases':
          return await this.getDatabases(notion, params);
        case 'queryDatabase':
          return await this.queryDatabase(notion, params);
        case 'getPage':
          return await this.getPage(notion, params);
        case 'createPage':
          return await this.createPage(notion, params);
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
    } catch (error) {
      console.error('[NotionPlugin] Error executing Notion API:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async search(notion, params) {
    const { query = '', filterType = 'all', pageSize = 10 } = params;

    const searchParams = {
      query,
      page_size: pageSize,
    };

    if (filterType !== 'all') {
      searchParams.filter = { property: 'object', value: filterType };
    }

    const response = await notion.search(searchParams);

    const results = response.results.map((item) => ({
      id: item.id,
      type: item.object,
      title: this.extractTitle(item),
      url: item.url,
      lastEdited: item.last_edited_time,
    }));

    return {
      success: true,
      results,
      count: results.length,
      hasMore: response.has_more,
      error: null,
    };
  }

  extractTitle(item) {
    if (item.title) {
      if (Array.isArray(item.title)) {
        return item.title.map((t) => t.plain_text).join('');
      }
    }
    if (item.properties) {
      const titleProp = Object.values(item.properties).find((p) => p.type === 'title');
      if (titleProp?.title) {
        return titleProp.title.map((t) => t.plain_text).join('');
      }
    }
    return 'Untitled';
  }
}

export default new NotionAPI();
```

### Trigger Tool (Discord Message Receiver)

```javascript
// discord-receiver.js
import { Client, GatewayIntentBits } from 'discord.js';
import EventEmitter from 'events';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

class DiscordReceiver extends EventEmitter {
  constructor() {
    super();
    this.name = 'receive-discord-message';
    this.client = null;
  }

  /**
   * Setup the trigger - called when workflow starts
   * Creates Discord client and subscribes to channel
   */
  async setup(engine, node) {
    console.log('[DiscordPlugin] Setting up Discord receiver trigger');

    if (!node.parameters || !node.parameters.channelId) {
      throw new Error('Discord trigger node is missing required channelId parameter');
    }

    try {
      // Import AuthManager using APP_PATH for correct resolution
      const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
      const AuthManagerModule = await import(`file://${authManagerPath.replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const accessToken = await AuthManager.getValidAccessToken(engine.userId, 'discord');
      if (!accessToken) {
        throw new Error('No valid Discord access token found. Please reconnect to Discord.');
      }

      // Create Discord client
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
      });

      await this.client.login(accessToken);
      console.log(`[DiscordPlugin] Discord bot connected for user ${engine.userId}`);

      // Store in engine receivers for cleanup
      engine.receivers.discord = this;

      // Listen for messages
      this.client.on('messageCreate', (message) => {
        // Ignore bot messages
        if (message.author.bot) return;

        // Only process messages from the subscribed channel
        if (message.channel.id === node.parameters.channelId) {
          const messageData = {
            content: message.content,
            author: message.author.username,
            authorId: message.author.id,
            channelId: message.channel.id,
            guildId: message.guild?.id,
            timestamp: message.createdTimestamp,
            attachments: Array.from(message.attachments.values()).map((a) => ({
              id: a.id,
              name: a.name,
              url: a.url,
              size: a.size,
            })),
          };

          // Trigger the workflow
          engine.processWorkflowTrigger(messageData);
        }
      });

      console.log(`[DiscordPlugin] Subscribed to channel ${node.parameters.channelId}`);
    } catch (error) {
      console.error('[DiscordPlugin] Error setting up Discord receiver:', error);
      throw error;
    }
  }

  /**
   * Validate incoming trigger data
   */
  validate(triggerData) {
    return 'content' in triggerData && 'author' in triggerData;
  }

  /**
   * Process the trigger data into outputs
   */
  async process(inputData, engine) {
    return {
      content: inputData.content,
      author: inputData.author,
      authorId: inputData.authorId,
      channelId: inputData.channelId,
      guildId: inputData.guildId,
      timestamp: inputData.timestamp,
      attachments: inputData.attachments || [],
      response: inputData,
    };
  }

  /**
   * Teardown - called when workflow stops
   */
  async teardown() {
    console.log('[DiscordPlugin] Tearing down Discord receiver');
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }
}

export default new DiscordReceiver();
```

### Polling Trigger Tool (Google Sheets New Row)

```javascript
// google-sheets-new-row.js
import EventEmitter from 'events';
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

class GoogleSheetsNewRow extends EventEmitter {
  constructor() {
    super();
    this.name = 'google-sheets-new-row';
    this.intervalId = null;
    this.lastRowCount = 0;
    this.isListening = false;
    this.spreadsheetId = null;
    this.sheetName = null;
    this.workflowEngine = null;
  }

  /**
   * Setup the trigger - called when workflow starts
   */
  async setup(engine, node) {
    console.log('[GoogleSheetsPlugin] Setting up Google Sheets New Row trigger');

    if (!node.parameters || !node.parameters.spreadsheetId || !node.parameters.sheetName) {
      throw new Error('Google Sheets trigger node is missing required parameters');
    }

    this.workflowEngine = engine;
    this.spreadsheetId = node.parameters.spreadsheetId;
    this.sheetName = node.parameters.sheetName;

    // Store in engine receivers for cleanup
    engine.receivers.sheets = this;

    // Start polling
    await this.start();

    console.log(`[GoogleSheetsPlugin] Monitoring ${this.spreadsheetId} - ${this.sheetName}`);
  }

  /**
   * Start polling for new rows
   */
  async start() {
    if (this.isListening) return;

    this.isListening = true;

    // Initialize the baseline row count
    await this.initializeLastRowCount();

    // Start polling every 30 seconds
    this.intervalId = setInterval(() => this.checkNewRows(), 30000);

    console.log(`[GoogleSheetsPlugin] Started polling for ${this.spreadsheetId} - ${this.sheetName}`);
  }

  /**
   * Get Google OAuth credentials
   */
  async getGoogleAuth() {
    try {
      // Import AuthManager using APP_PATH for correct resolution
      const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
      const AuthManagerModule = await import(`file://${authManagerPath.replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const userId = this.workflowEngine.userId;
      const accessToken = await AuthManager.getValidAccessToken(userId, 'google');

      if (!accessToken) {
        throw new Error('No valid access token found. User needs to authenticate with Google.');
      }

      const auth = new google.auth.OAuth2();
      auth.setCredentials({
        access_token: accessToken,
      });

      return auth;
    } catch (error) {
      console.error('[GoogleSheetsPlugin] Error getting Google auth:', error);
      throw error;
    }
  }

  /**
   * Check for new rows
   */
  async checkNewRows() {
    if (!this.isListening) return;

    try {
      const auth = await this.getGoogleAuth();
      const sheets = google.sheets({ version: 'v4', auth });

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.sheetName,
      });

      const rows = response.data.values || [];

      if (rows.length > this.lastRowCount) {
        // Get only the new rows
        const newRows = rows.slice(this.lastRowCount);

        console.log(`[GoogleSheetsPlugin] Detected ${newRows.length} new row(s)`);

        // Trigger workflow for each new row
        for (const row of newRows) {
          this.workflowEngine.processWorkflowTrigger({ newRow: row });
        }

        // Update the row count
        this.lastRowCount = rows.length;
      }
    } catch (error) {
      console.error(`[GoogleSheetsPlugin] Error checking for new rows:`, error);
    }
  }

  /**
   * Validate incoming trigger data
   */
  validate(triggerData) {
    return 'newRow' in triggerData;
  }

  /**
   * Process the trigger data into outputs
   */
  async process(inputData, engine) {
    return {
      newRow: inputData.newRow,
    };
  }

  /**
   * Teardown - called when workflow stops
   */
  async teardown() {
    console.log('[GoogleSheetsPlugin] Tearing down Google Sheets trigger');
    this.stop();
  }

  stop() {
    this.isListening = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export default new GoogleSheetsNewRow();
```

---

## Publishing to Marketplace

### 1. Prepare Your Plugin

- Ensure all tests pass
- Update version number
- Write comprehensive documentation
- Create a compelling description

### 2. Submit to Marketplace Registry

Add your plugin to `marketplace.json` (the **single source of truth** for plugin metadata):

```json
{
  "plugins": [
    {
      "name": "my-awesome-plugin",
      "displayName": "My Awesome Plugin",
      "version": "1.0.0",
      "description": "Does awesome things with your workflows",
      "author": "Your Name",
      "homepage": "https://github.com/you/my-awesome-plugin",
      "downloadUrl": "https://github.com/you/my-awesome-plugin/releases/download/v1.0.0/my-awesome-plugin.agnt",
      "size": 2500000,
      "tags": ["utility", "automation"],
      "category": "utility",
      "tools": [
        {
          "type": "my-tool",
          "schema": {
            "title": "My Tool",
            "description": "Brief description of what the tool does"
          }
        }
      ]
    }
  ]
}
```

### Marketplace Fields

| Field         | Type   | Required | Description                                                 |
| ------------- | ------ | -------- | ----------------------------------------------------------- |
| `name`        | string | ✅       | Unique plugin identifier (kebab-case)                       |
| `displayName` | string | ✅       | Human-readable name for UI display                          |
| `version`     | string | ✅       | Semantic version                                            |
| `description` | string | ✅       | Full description shown in marketplace and installed plugins |
| `author`      | string | ✅       | Plugin author name                                          |
| `homepage`    | string | ❌       | URL to plugin homepage/repo                                 |
| `downloadUrl` | string | ✅       | URL to download the .agnt package                           |
| `size`        | number | ✅       | Package size in bytes (shown in UI)                         |
| `tags`        | array  | ❌       | Search tags for the plugin                                  |
| `category`    | string | ❌       | Plugin category (e.g., "social", "utility", "ai")           |
| `tools`       | array  | ✅       | Array of tools with type and schema (title, description)    |

> **Important**: The `marketplace.json` is the single source of truth for all plugin metadata. When a plugin is installed, the UI displays data from `marketplace.json`, not from the plugin's `manifest.json`. This ensures consistency between the marketplace and installed views.

### 3. Host Your Plugin

Options:

- GitHub Releases
- NPM Registry
- Your own server
- AGNT Plugin Registry (coming soon)

---

## Support

- **Documentation**: https://docs.agnt.gg/plugins
- **Discord**: https://discord.gg/agnt
- **GitHub Issues**: https://github.com/agnt-gg/agnt/issues

---

_Happy plugin building! 🚀_
