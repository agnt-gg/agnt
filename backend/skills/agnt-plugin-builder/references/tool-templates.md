# Tool Code Templates

Copy-paste ES-module templates for AGNT tool implementations. Pick the one that matches the plugin's auth and category, then adapt the body.

All templates follow the ironclad rules:
- ES modules (`import`/`export`)
- Default-export an **instance**, not the class
- `this.name` equals the tool's `type` in the manifest
- Errors returned as `{ error: "..." }`, not thrown

---

## Template A — No-auth action tool

Simplest possible tool. Use for local logic, public APIs, utilities.

```javascript
// my-tool.js
class MyTool {
  constructor() {
    this.name = 'my-tool'; // must match manifest tool.type
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const { input } = params;

      // ...your logic...
      const result = input.toUpperCase();

      return { result, success: true };
    } catch (error) {
      console.error(`[${this.name}] Error:`, error);
      return { error: error.message, success: false };
    }
  }
}

export default new MyTool();
```

---

## Template B — Action tool with OAuth (AuthManager pattern)

Uses a built-in or registered OAuth provider. The AuthManager handles token refresh automatically.

```javascript
// my-oauth-tool.js
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// APP_PATH resolves to the AGNT installation root (4 levels up from plugin file)
// In prod: <userdata>/AGNT/plugins/installed/<plugin-name>/<tool>.js
// In dev:  <repo>/backend/plugins/dev/<plugin-name>/<tool>.js
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

class MyOAuthTool {
  constructor() {
    this.name = 'my-oauth-tool';
  }

  async execute(params, inputData, workflowEngine) {
    try {
      // Dynamic import of AuthManager — works cross-platform thanks to normalize
      const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
      const authManagerUrl = 'file://' + authManagerPath.replace(/\\/g, '/');
      const { default: AuthManager } = await import(authManagerUrl);

      const userId = workflowEngine?.userId;
      if (!userId) throw new Error('No user context — cannot fetch auth token');

      const token = await AuthManager.getValidAccessToken(userId, 'my-provider');
      if (!token) {
        return {
          success: false,
          error: 'No valid access token. Please reconnect the my-provider account in Settings.'
        };
      }

      // ...call the API with the token...
      const response = await axios.get('https://api.example.com/me', {
        headers: { Authorization: `Bearer ${token}` }
      });

      return { success: true, data: response.data };
    } catch (error) {
      console.error(`[${this.name}] Error:`, error);
      return { success: false, error: error.message };
    }
  }
}

export default new MyOAuthTool();
```

Key notes:
- `APP_PATH` uses the same "4 levels up" path that works in both dev and installed locations.
- The `file://` URL + backslash-replace is mandatory on Windows — ESM dynamic imports reject Windows-style paths.
- Always return a friendly error when the token is missing — the user needs to know to reconnect.

---

## Template C — Action tool with API key

For services where users supply a key once (stored via AGNT's auth system under a provider slug).

```javascript
// my-apikey-tool.js
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

class MyApiKeyTool {
  constructor() {
    this.name = 'my-apikey-tool';
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
      const { default: AuthManager } = await import('file://' + authManagerPath.replace(/\\/g, '/'));

      const apiKey = await AuthManager.getValidAccessToken(workflowEngine.userId, 'my-provider');
      if (!apiKey) {
        return { success: false, error: 'No API key stored for my-provider. Add one in Settings.' };
      }

      const response = await axios.post('https://api.example.com/endpoint', params.payload, {
        headers: { 'X-API-Key': apiKey }
      });

      return { success: true, data: response.data };
    } catch (error) {
      console.error(`[${this.name}] Error:`, error);
      return { success: false, error: error.message };
    }
  }
}

export default new MyApiKeyTool();
```

Simpler alternative: skip AuthManager and just add a `password`-type parameter named `apiKey` to the manifest, then read `params.apiKey` directly. Good for prototyping.

---

## Template D — Trigger tool (EventEmitter pattern)

Triggers start workflows when external events happen (polling an API, listening on a webhook, watching a file). Category must be `trigger` in the manifest.

```javascript
// my-trigger.js
import { EventEmitter } from 'events';

class MyTrigger extends EventEmitter {
  constructor() {
    super();
    this.name = 'my-trigger';
    this.intervalId = null;
    this.isListening = false;
    this.workflowEngine = null;
  }

  /**
   * Called once when a workflow using this trigger starts.
   */
  async setup(engine, node) {
    console.log(`[${this.name}] Setting up`);

    if (!node.parameters || !node.parameters.resourceId) {
      throw new Error(`${this.name} is missing required parameters`);
    }

    this.workflowEngine = engine;
    this.resourceId = node.parameters.resourceId;
    this.pollIntervalMs = (node.parameters.pollIntervalSeconds || 30) * 1000;

    // Register in engine receivers so teardown can find us
    engine.receivers[this.name] = this;

    await this.start();
    console.log(`[${this.name}] Monitoring ${this.resourceId}`);
  }

  async start() {
    if (this.isListening) return;
    this.isListening = true;

    const poll = async () => {
      try {
        // Check for the external event...
        const hasNewData = await this.checkForChanges();
        if (hasNewData) {
          // Emit 'trigger' with the payload — workflow engine picks this up
          this.emit('trigger', { resourceId: this.resourceId, timestamp: new Date().toISOString() });
        }
      } catch (err) {
        console.error(`[${this.name}] Poll error:`, err);
      }
    };

    await poll(); // initial check
    this.intervalId = setInterval(poll, this.pollIntervalMs);
  }

  /**
   * Validates trigger payload before firing the workflow.
   * Return false to skip this trigger event.
   */
  validate(triggerData) {
    return Boolean(triggerData?.resourceId);
  }

  /**
   * Processes incoming inputData from the engine (for chained triggers).
   * For pure polling triggers, just return inputData unchanged.
   */
  async process(inputData, engine) {
    return inputData;
  }

  async teardown() {
    console.log(`[${this.name}] Tearing down`);
    this.isListening = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async checkForChanges() {
    // ...your detection logic...
    return false;
  }
}

export default new MyTrigger();
```

Pattern used by `google-sheets-new-row` and other polling triggers. For webhook-style triggers, replace `setInterval` with an HTTP listener registration.

---

## Template E — Multi-action "API dispatcher"

For wrapping a whole API in a single tool (à la `dropbox-api`, `github-api`). Pair with the multi-action manifest pattern in `manifest-schema.md`.

```javascript
// my-api.js
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

class MyApi {
  constructor() {
    this.name = 'my-api';
    this.baseUrl = 'https://api.example.com/v1';
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const token = await this.#getToken(workflowEngine.userId);
      const client = axios.create({
        baseURL: this.baseUrl,
        headers: { Authorization: `Bearer ${token}` }
      });

      switch (params.action) {
        case 'LIST':    return await this.#list(client, params);
        case 'GET':     return await this.#get(client, params);
        case 'CREATE':  return await this.#create(client, params);
        case 'UPDATE':  return await this.#update(client, params);
        case 'DELETE':  return await this.#delete(client, params);
        default:
          return { success: false, error: `Unknown action: ${params.action}` };
      }
    } catch (error) {
      console.error(`[${this.name}] Error:`, error);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  async #getToken(userId) {
    const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
    const { default: AuthManager } = await import('file://' + authManagerPath.replace(/\\/g, '/'));
    const token = await AuthManager.getValidAccessToken(userId, 'my-provider');
    if (!token) throw new Error('No valid token. Please reconnect in Settings.');
    return token;
  }

  async #list(client, { path }) {
    const res = await client.get(path || '/');
    return { success: true, data: res.data };
  }

  async #get(client, { path }) {
    const res = await client.get(path);
    return { success: true, data: res.data };
  }

  async #create(client, { path, content }) {
    const res = await client.post(path, content);
    return { success: true, data: res.data };
  }

  async #update(client, { path, content }) {
    const res = await client.patch(path, content);
    return { success: true, data: res.data };
  }

  async #delete(client, { path }) {
    const res = await client.delete(path);
    return { success: true, data: res.data };
  }
}

export default new MyApi();
```

Why this pattern rocks:
- **One tool, many verbs** → users pick the action from a dropdown; other params show/hide conditionally.
- **Private methods (`#name`)** keep the public `execute` interface clean.
- **Centralized token fetching** — add caching or refresh logic in one place.
- **Graceful error unwrapping** — returns the API's `message` field when present, falls back to the JS error.

---

## Template F — Utility tool (no external calls)

For pure data transforms. No auth, no network, just input → output.

```javascript
// my-util.js
class MyUtil {
  constructor() {
    this.name = 'my-util';
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const { text, mode } = params;

      let result;
      switch (mode) {
        case 'upper':   result = text.toUpperCase(); break;
        case 'lower':   result = text.toLowerCase(); break;
        case 'reverse': result = text.split('').reverse().join(''); break;
        default:        return { error: `Unknown mode: ${mode}` };
      }

      return { result, length: result.length };
    } catch (error) {
      return { error: error.message };
    }
  }
}

export default new MyUtil();
```

Use category `utility` in the manifest. Perfect for fast CPU-only ops — they run instantly with no network latency.

---

## Adaptation checklist

When adapting a template to a new plugin:

1. ✅ Rename the class and the `this.name` to match your manifest's tool `type`.
2. ✅ Update `authProvider` slug throughout (if using auth).
3. ✅ Map every parameter in the manifest to a destructure in `execute()`.
4. ✅ Return an object whose keys match every `output` declared in the manifest.
5. ✅ Add a friendly error message for the "not authenticated" case.
6. ✅ Log errors to console with the `[${this.name}]` prefix for easy debugging.
7. ✅ If using deps (axios, etc.), add them to `package.json` and run `npm install` before building.
