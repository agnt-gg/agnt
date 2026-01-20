# AGNT Lite Mode - Developer Guide

## Overview

AGNT Lite Mode is a Docker-only feature that disables Chromium-based browser automation to reduce the image size by ~53% (from 1.3GB to 620MB).

When `AGNT_LITE_MODE=true`, the application should gracefully disable browser automation features and provide clear error messages to users attempting to use these features.

## Environment Variable

**Variable:** `AGNT_LITE_MODE`
**Type:** Boolean (string "true" or "false")
**Default:** `false` (full mode)
**Set in:** Dockerfile.lite, docker-compose.lite.yml

## Checking Lite Mode in Code

### Backend (Node.js)

AGNT provides a helper utility for checking lite mode:

```javascript
// Import the lite mode helper
import { isLiteMode, getLiteModeError, withBrowserCheck } from '../utils/liteModeHelper.js';

// Simple check
if (isLiteMode()) {
  console.log('AGNT running in LITE MODE - Browser features disabled');
}

// Get standardized error response
const error = getLiteModeError('Web scraping');
// Returns: { success: false, result: null, error: "Web scraping is not available..." }
```

The helper is located at `backend/src/utils/liteModeHelper.js` and provides:
- `isLiteMode()` - Check if running in lite mode
- `requiresBrowser(featureName)` - Check if a feature needs browser
- `getLiteModeError(featureName)` - Get standardized error message
- `withBrowserCheck(fn, featureName)` - Wrap function with lite mode check
- `getSystemInfo()` - Get system info including lite mode status
- `logLiteModeStatus()` - Log pretty startup banner

### Example: Puppeteer/Playwright Tool Handler

**Option 1: Using the helper utility (Recommended)**

```javascript
// backend/src/tools/library/browser/puppeteer-tool.js
import { isLiteMode, getLiteModeError } from '../../../utils/liteModeHelper.js';
import puppeteer from 'puppeteer';

class PuppeteerTool {
  async execute(params, inputData, workflowEngine) {
    // Check if running in lite mode using helper
    if (isLiteMode()) {
      return getLiteModeError('Browser automation');
    }

    // Normal puppeteer code...
    try {
      const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
      });
      // ... rest of implementation
    } catch (error) {
      return {
        success: false,
        result: null,
        error: error.message
      };
    }
  }
}

export default new PuppeteerTool();
```

**Option 2: Using wrapper function**

```javascript
import { withBrowserCheck } from '../../../utils/liteModeHelper.js';

class PuppeteerTool {
  constructor() {
    // Wrap execute method with browser check
    this.execute = withBrowserCheck(this._execute.bind(this), 'Browser automation');
  }

  async _execute(params, inputData, workflowEngine) {
    // This only runs if NOT in lite mode
    const browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
    });
    // ... rest of implementation
  }
}

export default new PuppeteerTool();
```

### Example: Tool Registry Check

```javascript
// backend/src/services/orchestrator/toolRegistry.js
import PluginManager from '../../plugins/PluginManager.js';

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.isLiteMode = process.env.AGNT_LITE_MODE === 'true';
  }

  registerTool(tool) {
    // Skip browser-based tools in lite mode
    if (this.isLiteMode && this.isBrowserTool(tool)) {
      console.warn(`Skipping browser tool "${tool.name}" - LITE MODE enabled`);
      return false;
    }

    this.tools.set(tool.type, tool);
    return true;
  }

  isBrowserTool(tool) {
    // Check if tool requires browser
    const browserToolTypes = [
      'puppeteer',
      'playwright',
      'web-scraper',
      'screenshot',
      'html-to-pdf'
    ];

    return browserToolTypes.some(type =>
      tool.type.includes(type) ||
      tool.category === 'browser-automation'
    );
  }

  getTool(type) {
    const tool = this.tools.get(type);

    if (!tool && this.isLiteMode) {
      throw new Error(
        `Tool "${type}" not available. This may be a browser automation tool. ` +
        `AGNT is running in Lite Mode without browser support. ` +
        `Use the full Docker image or native installation for browser features.`
      );
    }

    return tool;
  }
}

export default new ToolRegistry();
```

## Frontend Integration

The backend should expose the lite mode status via an API endpoint so the frontend can adjust the UI accordingly.

### Backend API Endpoint

```javascript
// backend/server.js
app.get('/api/system/info', (req, res) => {
  res.json({
    version: packageJson.version,
    liteMode: process.env.AGNT_LITE_MODE === 'true',
    features: {
      browserAutomation: process.env.AGNT_LITE_MODE !== 'true',
      aiAgents: true,
      workflows: true,
      plugins: true
    }
  });
});
```

### Frontend UI Adjustments

```javascript
// frontend/src/services/SystemService.js
export async function getSystemInfo() {
  const response = await fetch('/api/system/info');
  return response.json();
}

// frontend/src/components/ToolSelector.vue
<template>
  <div class="tool-selector">
    <div v-for="tool in availableTools" :key="tool.id">
      <div class="tool-card" :class="{ disabled: isToolDisabled(tool) }">
        <h3>{{ tool.name }}</h3>
        <p v-if="isToolDisabled(tool)" class="warning">
          ⚠️ Not available in Lite Mode
        </p>
      </div>
    </div>
  </div>
</template>

<script>
import { getSystemInfo } from '@/services/SystemService';

export default {
  data() {
    return {
      systemInfo: null,
      tools: []
    };
  },
  async mounted() {
    this.systemInfo = await getSystemInfo();
  },
  methods: {
    isToolDisabled(tool) {
      // Disable browser tools in lite mode
      if (this.systemInfo?.liteMode && tool.category === 'browser-automation') {
        return true;
      }
      return false;
    }
  }
};
</script>
```

## Features Disabled in Lite Mode

When `AGNT_LITE_MODE=true`, the following features should be disabled or show graceful error messages:

### Browser Automation Tools
- ❌ Puppeteer web scraping
- ❌ Playwright automation
- ❌ Screenshot capture (via browser)
- ❌ HTML to PDF conversion (via browser)
- ❌ Form auto-fill
- ❌ Web testing/E2E tests with browser

### Available Features (Still Work)
- ✅ All AI agent workflows
- ✅ API integrations (REST, GraphQL)
- ✅ Plugin system
- ✅ Image processing (via sharp/canvas)
- ✅ PDF reading (via pdfreader)
- ✅ Document processing
- ✅ Email automation
- ✅ Webhooks
- ✅ Data transformations

## Error Messages

Provide clear, actionable error messages when users attempt to use browser features in lite mode:

### Good Error Message ✅
```
Browser automation is not available in AGNT Lite Mode.

To use this feature, you have two options:
1. Switch to the full Docker image:
   docker-compose -f docker-compose.yml up -d
2. Use the native AGNT installation (Electron app)

Learn more: https://agnt.gg/docs/lite-mode
```

### Bad Error Message ❌
```
Error: Chromium not found
```

## Plugin Development

Plugin developers should check for lite mode and handle it appropriately:

```javascript
// backend/plugins/dev/my-browser-plugin/manifest.json
{
  "name": "my-browser-plugin",
  "version": "1.0.0",
  "requiresBrowser": true,  // Mark plugin as requiring browser
  "tools": [...]
}

// backend/plugins/dev/my-browser-plugin/browser-tool.js
class BrowserTool {
  constructor() {
    this.name = 'browser-tool';
    this.requiresBrowser = true;
  }

  async execute(params, inputData, workflowEngine) {
    // Check lite mode
    if (process.env.AGNT_LITE_MODE === 'true') {
      return {
        success: false,
        error: 'This plugin requires browser support (Chromium). Not available in Lite Mode.'
      };
    }

    // Normal implementation...
  }
}
```

## Testing Both Modes

### Test Full Mode
```bash
docker-compose up -d
docker exec -it agnt node -e "console.log('Lite Mode:', process.env.AGNT_LITE_MODE)"
# Output: Lite Mode: undefined (or false)
```

### Test Lite Mode
```bash
docker-compose -f docker-compose.lite.yml up -d
docker exec -it agnt-lite node -e "console.log('Lite Mode:', process.env.AGNT_LITE_MODE)"
# Output: Lite Mode: true
```

## Startup Banner

Display a clear message on startup using the helper:

```javascript
// backend/server.js
import { logLiteModeStatus, getSystemInfo } from './src/utils/liteModeHelper.js';

console.log('=== AGNT Starting ===');
console.log(`Version: ${packageJson.version}`);
console.log(`Node: ${process.version}`);
console.log(`Port: ${config.port}`);

// Display lite mode status with pretty banner
logLiteModeStatus();

// Get full system info
const systemInfo = getSystemInfo();
console.log('Features:', systemInfo.features);
console.log('====================');
```

This will display:
```
=== AGNT Starting ===
Version: 0.3.7
Node: v20.11.0
Port: 3333

╔════════════════════════════════════════╗
║   ⚡ AGNT LITE MODE ENABLED ⚡        ║
╟────────────────────────────────────────╢
║  Browser automation: DISABLED          ║
║  Image size: ~620MB (vs 1.3GB full)    ║
║  All other features: ENABLED           ║
╚════════════════════════════════════════╝

Features: {
  browserAutomation: false,
  aiAgents: true,
  workflows: true,
  plugins: true,
  imageProcessing: true,
  apiIntegrations: true
}
====================
```

## Documentation

Users should be informed about lite mode:

1. **Docker Hub / Registry Description**: Clearly state which image variant they're using
2. **First-run UI**: Show a banner in the web UI if in lite mode
3. **Tool Tooltips**: Add "(Requires Full Mode)" to browser tools
4. **Settings Page**: Display current mode and link to switch

## Summary

**Environment Variable:** `AGNT_LITE_MODE=true`

**Developer Checklist:**
- [ ] Check `process.env.AGNT_LITE_MODE` before using Puppeteer/Playwright
- [ ] Return clear error messages when browser features are attempted
- [ ] Mark browser-dependent tools with `requiresBrowser: true`
- [ ] Expose lite mode status via API for frontend
- [ ] Disable/hide browser tools in UI when in lite mode
- [ ] Show startup banner indicating current mode
- [ ] Update plugin documentation for browser dependencies

By following these guidelines, AGNT will gracefully handle both full and lite modes, providing a great user experience regardless of which Docker image variant is being used.
