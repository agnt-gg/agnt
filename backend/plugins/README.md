# AGNT Plugin System

The plugin system allows tools to be loaded dynamically with their own isolated dependencies. Plugins are distributed as `.agnt` files (gzipped tar archives) with all dependencies pre-bundled.

## Key Features

- **No npm/Node.js required on user machine** - Dependencies are pre-bundled
- **VSCode/Figma-style distribution** - Download pre-built packages from marketplace
- **Isolated dependencies** - Each plugin has its own `node_modules`
- **Hot reload** - Install/uninstall without restarting
- **Cross-platform** - Pure JS plugins work everywhere

## Directory Structure

```
backend/plugins/
├── dev/                    # Plugin development workspace (SOURCE)
│   └── my-plugin/
│       ├── manifest.json
│       ├── package.json
│       ├── my-tool.js
│       └── node_modules/   # Installed during build
├── plugin-builds/          # Built .agnt files (DISTRIBUTION)
│   └── my-plugin.agnt
├── build-plugin.js         # Build single plugin
├── build-all-plugins.js    # Build all plugins
├── marketplace.json        # Plugin metadata for marketplace
└── README.md
```

**User Data (runtime):**
```
%APPDATA%/AGNT/plugins/     # Windows
~/Library/Application Support/AGNT/plugins/  # macOS
~/.config/AGNT/plugins/     # Linux
├── installed/              # Extracted plugins
│   └── my-plugin/
├── registry.json           # Installed plugins registry
└── .temp/                  # Temporary downloads
```

## Building Plugins

### Build a Single Plugin

```bash
cd desktop/backend/plugins
node build-plugin.js <plugin-name>
```

Example:
```bash
node build-plugin.js discord-plugin
```

This will:
1. Validate the plugin structure
2. Run `npm install --production` if node_modules missing
3. Package everything into `plugin-builds/discord-plugin.agnt`

### Build All Plugins

```bash
cd desktop/backend/plugins
node build-all-plugins.js
```

This builds all plugins in `dev/` folder at once.

### What Gets Packaged

The build script includes:
- `manifest.json` (required)
- `package.json` (if exists)
- All `.js` files
- `node_modules/` (with all dependencies)

It excludes:
- `.git/`
- `.DS_Store`
- `.npm-cache/`
- `package-lock.json`

## Creating a New Plugin

### 1. Create Plugin Directory

```bash
cd desktop/backend/plugins/dev
mkdir my-plugin
cd my-plugin
```

### 2. Create manifest.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My awesome plugin",
  "author": "Your Name",
  "icon": "custom",
  "tools": [
    {
      "type": "my-tool",
      "entryPoint": "./my-tool.js",
      "schema": {
        "title": "My Tool",
        "category": "action",
        "type": "my-tool",
        "icon": "custom",
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

### 3. Create package.json (if you have dependencies)

```json
{
  "name": "agnt-my-plugin",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "axios": "^1.7.0"
  }
}
```

### 4. Create Tool Implementation

```javascript
// my-tool.js
import axios from 'axios';

class MyTool {
  constructor() {
    this.name = 'my-tool';
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const response = await axios.get('https://api.example.com/data', {
        params: { input: params.input }
      });

      return {
        success: true,
        result: response.data,
        error: null,
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: error.message,
      };
    }
  }
}

export default new MyTool();
```

### 5. Build the Plugin

```bash
cd desktop/backend/plugins
node build-plugin.js my-plugin
```

Output: `plugin-builds/my-plugin.agnt`

### 6. Test Locally

The plugin will be automatically installed when the app starts (if it's a bundled plugin in `plugin-builds/`).

Or install manually via API:
```bash
curl -X POST http://localhost:3333/api/plugins/install-file \
  -H "Content-Type: application/json" \
  -d '{"name": "my-plugin", "fileData": "<base64>", "fileName": "my-plugin.agnt"}'
```

### 7. Distribute

- **Marketplace**: Upload to https://agnt.gg/plugins/publish
- **Direct share**: Send the `.agnt` file

## API Endpoints

### List Installed Plugins
```
GET /api/plugins/installed
```

### Get Plugin Details
```
GET /api/plugins/installed/:name
```

### Browse Marketplace
```
GET /api/plugins/marketplace
```

### Install from Marketplace
```
POST /api/plugins/install
Body: { "name": "discord-plugin", "version": "latest" }
```

### Install from File
```
POST /api/plugins/install-file
Body: { "name": "my-plugin", "fileData": "<base64>", "fileName": "my-plugin.agnt" }
```

### Uninstall Plugin
```
DELETE /api/plugins/:name
```

### Get Plugin Tools
```
GET /api/plugins/tools
```

### Reload Plugins
```
POST /api/plugins/reload
```

## Plugin Manifest Schema

| Field       | Type   | Required | Description               |
| ----------- | ------ | -------- | ------------------------- |
| name        | string | Yes      | Unique plugin identifier  |
| version     | string | Yes      | Semantic version          |
| description | string | No       | Plugin description        |
| author      | string | No       | Plugin author             |
| icon        | string | No       | Icon identifier           |
| tools       | array  | Yes      | Array of tool definitions |

### Tool Definition

| Field      | Type   | Required | Description                                   |
| ---------- | ------ | -------- | --------------------------------------------- |
| type       | string | Yes      | Unique tool type identifier                   |
| entryPoint | string | Yes      | Path to tool JS file (relative to plugin dir) |
| schema     | object | Yes      | Tool schema (same format as toolLibrary.json) |

## Workflow: Dev to Distribution

```
1. Develop in dev/my-plugin/
       ↓
2. node build-plugin.js my-plugin
       ↓
3. plugin-builds/my-plugin.agnt (commit to git)
       ↓
4. electron-builder packages app
       ↓
5. User runs app → plugins extracted to AppData
```

## Troubleshooting

### Plugin not loading
- Check that `manifest.json` is valid JSON
- Ensure `entryPoint` path is correct
- Check server logs for error messages

### Build fails
- Ensure `manifest.json` exists in the plugin directory
- Check that `package.json` has valid JSON syntax
- Run `npm install` manually to see dependency errors

### Tool not appearing in UI
- Verify schema is valid (check ToolRegistry logs)
- Call `POST /api/plugins/reload` to refresh
- Check that the plugin was installed successfully

### Native module issues (cross-platform)
- Native modules (sharp, better-sqlite3, etc.) are platform-specific
- Avoid native deps in plugins when possible
- If needed, user must install from marketplace (rebuilds for their platform)

## Security Considerations

- Plugins run with full Node.js permissions
- Only install plugins from trusted sources
- Review plugin code before installing
- Marketplace plugins are reviewed before publishing
