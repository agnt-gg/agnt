---
name: agnt-plugin-builder
description: "End-to-end workflow for creating, building, installing, and hot-reloading AGNT plugins entirely from chat. Use this skill whenever the user asks to 'build a plugin', 'create an AGNT plugin', 'add a new tool to AGNT', 'integrate X with AGNT' (where X is an API or service), 'make a plugin for [service]', or wants to extend AGNT with custom workflow nodes, triggers, or integrations. Also trigger when the user mentions editing, updating, rebuilding, or reinstalling an existing plugin, or says things like 'turn this API into an AGNT tool', 'wrap this endpoint as a plugin', or 'add [service] to my AGNT workflows'. Covers scaffolding the dev folder, writing manifest.json + ES-module tool code, running build-plugin.js, installing via /api/plugins/install-file, and reloading via /api/plugins/reload — all from a single chat session with zero manual terminal work."
allowed-tools: Read Write Edit Bash
---

# AGNT Plugin Builder

End-to-end procedure for creating, building, installing, and hot-reloading AGNT plugins **entirely from chat** — no IDE, no manual zipping, no app restart.

## Why this skill exists

AGNT plugins are self-contained tool bundles (`.agnt` files = gzipped tar archives) that extend AGNT with custom workflow nodes. The official process is well-documented but involves ~6 coordinated steps across the filesystem and HTTP API. This skill encodes the exact sequence so any request like *"build me a plugin that does X"* can be completed in one flow.

---

## Canonical paths (Windows)

These paths are fixed on the user's machine. Use them verbatim.

| Purpose | Path |
|---|---|
| Plugin dev folder (plugins MUST live here to build) | `C:\Users\Studio\Documents\DevelopmentProjects\AGNT\repos\agnt-pro\backend\plugins\dev\<plugin-name>\` |
| Build script | `C:\Users\Studio\Documents\DevelopmentProjects\AGNT\repos\agnt-pro\backend\plugins\build-plugin.js` |
| Built `.agnt` output | `C:\Users\Studio\Documents\DevelopmentProjects\AGNT\repos\agnt-pro\backend\plugins\plugin-builds\<plugin-name>.agnt` |
| Installed runtime location | `C:\Users\Studio\AppData\Roaming\AGNT\plugins\installed\<plugin-name>\` |
| AGNT API base | `http://localhost:3333/api` |

On macOS/Linux, swap the user-data path for `~/Library/Application Support/AGNT/...` or `~/.config/AGNT/...` respectively.

---

## Plugin anatomy (the minimum viable plugin)

```
<plugin-name>/
├── manifest.json      ← metadata + tool schemas (required)
├── package.json       ← deps; MUST include "type": "module"
└── <tool-name>.js     ← ES module, default-exports an instance
```

After `npm install` a `node_modules/` folder joins them and gets bundled into the `.agnt`.

### `manifest.json` essentials

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What it does",
  "author": "AGNT User",
  "icon": "sparkles",
  "tools": [
    {
      "type": "my-tool",
      "entryPoint": "./my-tool.js",
      "schema": {
        "title": "My Tool",
        "category": "action",
        "type": "my-tool",
        "icon": "sparkles",
        "description": "Human-facing description shown in the node picker",
        "parameters": { /* see references/manifest-schema.md */ },
        "outputs":    { /* key → {type, description} */ }
      }
    }
  ]
}
```

Rules that matter:
- `name` and tool `type` are **kebab-case**, and each tool `type` must be unique across the whole AGNT instance.
- `category` is one of `action | trigger | utility | widget | control | custom`. 90% of plugins are `action`.
- The top-level `type` in the tool object and the `type` inside `schema` must match.
- `entryPoint` is relative to the manifest (use `./file.js`).

For the full schema (parameter input types, conditional visibility, auth modes, output shapes), read `references/manifest-schema.md`.

### `package.json` essentials

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "my-tool.js",
  "dependencies": { "axios": "^1.7.0" }
}
```

`"type": "module"` is non-negotiable — AGNT loads plugins as ES modules. The build script auto-patches this if missing, but include it explicitly to avoid surprise.

### Tool code essentials

Every action tool follows this shape:

```javascript
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

class MyTool {
  constructor() { this.name = 'my-tool'; }  // must equal manifest tool.type

  async execute(params, inputData, workflowEngine) {
    try {
      // ...your logic...
      return { /* keys matching schema.outputs */ };
    } catch (error) {
      console.error(`[${this.name}] Error:`, error);
      return { error: error.message };
    }
  }
}

export default new MyTool();   // ← instance, not the class
```

Ironclad rules:
1. **ES modules only** (`import`/`export`). No `require`.
2. **Default-export an instance**, not the class. AGNT calls `.execute()` on it directly.
3. `this.name` in the constructor must equal the tool's `type` in the manifest.
4. For triggers (category `trigger`), extend `EventEmitter` and implement `setup`, `validate`, `process`, `teardown` — see `references/tool-templates.md`.
5. Return errors as `{ error: "..." }` rather than throwing, so downstream nodes see the failure gracefully.

For auth-enabled tools and trigger skeletons, read `references/tool-templates.md`.

---

## The 6-step build pipeline

This is the exact sequence to run for every new plugin. Each step is small and independently verifiable, so stop and debug at any step that fails rather than pushing through.

### Step 1 — Scaffold the plugin folder

Create the folder and write all three files using `file_operations`:

```
mkdir → C:\Users\Studio\...\backend\plugins\dev\<plugin-name>
write → manifest.json
write → package.json
write → <tool-name>.js
```

Always write JSON with `JSON.stringify(obj, null, 2)` to guarantee valid syntax (no trailing commas, proper quoting).

### Step 2 — Install dependencies (skip if none)

If the plugin has no npm deps, skip this step entirely — it saves ~30-60 seconds per build.

Otherwise, from `execute_javascript_code`:

```javascript
const { execSync } = require('child_process');
execSync('npm install --production', {
  cwd: 'C:\\Users\\Studio\\...\\backend\\plugins\\dev\\<plugin-name>',
  stdio: 'inherit'
});
```

`--production` skips devDependencies, keeping the `.agnt` bundle small.

### Step 3 — Build the `.agnt` package

Run the official build script, passing **only the plugin name** (not a path — the script joins it to its internal `PLUGINS_DIR = <plugins>/dev`):

```javascript
execSync('node build-plugin.js <plugin-name>', {
  cwd: 'C:\\Users\\Studio\\...\\backend\\plugins',
  stdio: 'inherit'
});
```

Success produces `plugin-builds/<plugin-name>.agnt`. The build script validates the manifest, auto-fixes missing `"type": "module"`, runs `npm install` if needed, and gzipped-tars the folder.

### Step 4 — Install via the API

Read the `.agnt` file as base64 and POST to `/api/plugins/install-file`:

```javascript
const fs = require('fs');
const buf = fs.readFileSync('C:\\Users\\Studio\\...\\plugin-builds\\<plugin-name>.agnt');
const fileData = buf.toString('base64');

const API = 'http://localhost:3333/api';
const res = await fetch(API + '/plugins/install-file', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + process.env.AGNT_AUTH_TOKEN,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: '<plugin-name>',
    fileName: '<plugin-name>.agnt',
    fileData
  })
});
console.log(await res.json());
```

This extracts the archive into the user-data plugins folder.

### Step 5 — Hot-reload the plugin registry

```javascript
await fetch(API + '/plugins/reload', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + process.env.AGNT_AUTH_TOKEN }
});
```

New tools are immediately available to workflows, agents, and the node picker UI. No app restart required.

### Step 6 — Verify

```javascript
const { plugins } = await (await fetch(API + '/plugins/installed', {
  headers: { 'Authorization': 'Bearer ' + process.env.AGNT_AUTH_TOKEN }
})).json();
// Confirm <plugin-name> appears with enabled: true and tools listed
```

If the plugin shows up but the tool doesn't fire when used, inspect the AGNT backend console — it logs `[PluginManager]` errors at load time that usually reveal the issue (bad export, missing dep, path error).

---

## Decision tree: which auth mode?

| User situation | Manifest `authRequired` | Tool code |
|---|---|---|
| Public API or local-only logic | **omit** | No AuthManager import |
| User supplies an API key for a custom service | `"apiKey"` + `authProvider: "<name>"` | `AuthManager.getValidAccessToken(userId, '<name>')` |
| OAuth provider (Google, GitHub, Notion, Slack, etc.) | `"oauth"` + `authProvider: "<name>"` | Same pattern |

Built-in providers already registered in AGNT: `openai`, `anthropic`, `google`, `github`, `slack`, `discord`, `twitter`, `stripe`, `notion`, `openweathermap`. For a brand-new API-key provider, either register the provider first or just add a `password` input parameter to the tool and read it from `params` directly — simplest route for one-off keys.

See `references/tool-templates.md` for the exact AuthManager dynamic-import snippet (it requires `file://` + backslash normalization on Windows).

---

## Alternative: AI-generated plugins (faster for boilerplate)

When the user wants a simple REST-wrapper plugin and doesn't care about fine details, the built-in generator can be faster.

**Important:** `POST /api/plugins/generate` is a **Server-Sent Events (SSE)** endpoint with `Content-Type: text/event-stream`, **not** a normal JSON endpoint. It emits these events:

- `progress`
- `manifest`
- `code`
- `package`
- `complete`
- `error`

That means the client must:

1. Open the generate request and consume the SSE stream
2. Collect the generated `manifest`, `code`, and `package` payloads
3. Wait for `complete`
4. Send the collected artifacts to `POST /api/plugins/build-generated`
5. Call `POST /api/plugins/reload`

Pseudo-flow:

```javascript
// 1. Open SSE stream to /plugins/generate
//    Collect events: manifest, code, package
//    Wait for complete

// 2. Build + install in one shot using the collected artifacts
await fetch(API + '/plugins/build-generated', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + process.env.AGNT_AUTH_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    manifest,
    toolCode,
    packageJson,
    installAfterBuild: true
  })
});

// 3. Reload
await fetch(API + '/plugins/reload', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + process.env.AGNT_AUTH_TOKEN }
});
```

If you include code here, label it as SSE-aware or pseudo-code so future readers do not mistake `/plugins/generate` for a plain `fetch(...).json()` endpoint.

Use the manual 6-step pipeline for anything non-trivial — you get full control over the code and can iterate quickly when something breaks.

---

## Editing an existing plugin

To modify an installed plugin, start from its source (which lives in `dev/`):

1. Read the files from `<plugins>/dev/<plugin-name>/` (or fetch via `GET /api/plugins/installed/<name>/source` if only the installed copy exists).
2. Edit in place.
3. Re-run steps 3-6 (build → install → reload → verify). The install-file endpoint overwrites cleanly.

To remove a plugin: `DELETE /api/plugins/:name`, then `POST /api/plugins/reload`.

---

## Common pitfalls (and the fixes)

| Pitfall | Fix |
|---|---|
| Using `require` | Use `import`; declare `"type": "module"` in package.json |
| Exporting the class | `export default new ClassName()` — an instance |
| Relative path to AuthManager | Use `APP_PATH` + `file://` + backslash normalization |
| Plugin folder outside `dev/` | Build script will fail — always create in `dev/` |
| Bloated `.agnt` | Use `npm install --production` |
| Tool `type` mismatch (manifest vs. `this.name`) | Keep them identical, kebab-case |
| Invalid JSON in manifest | Always write via `JSON.stringify(obj, null, 2)` |
| UI doesn't show new tool | Hit `POST /api/plugins/reload` — forgetting this is the #1 "it didn't work" cause |
| Windows backslashes in `file://` URLs | `filePath.replace(/\\/g, '/')` before prefixing with `file://` |

---

## Smoke-test plugin: `echo-plugin`

When verifying the pipeline itself (e.g., after an AGNT update, or when debugging a broken build), scaffold this trivial no-deps plugin as a canary. It takes under a minute end-to-end and proves that scaffold → build → install → reload all work.

```
echo-plugin/
├── manifest.json   (one action tool, no auth, one string input "text")
├── package.json    ("type": "module", no dependencies)
└── echo.js         (returns { reversed: params.text.split('').reverse().join('') })
```

If this succeeds, the pipeline is healthy. If it fails, the problem is environmental, not a plugin-code issue.

---

## Reference files

Load these only as needed — the main SKILL.md above is sufficient for ~80% of plugins.

- **`references/manifest-schema.md`** — Full manifest/schema reference: every tool category, every input type (`text`, `textarea`, `select`, `checkbox`, `codearea`, `password`, `agent-select`, etc.), conditional parameter visibility, output shapes, icon names, built-in auth providers. Read when the user's plugin has complex UI (multi-action select with conditional fields, dynamic parameter visibility, typed outputs).
- **`references/tool-templates.md`** — Copy-paste ES-module templates: basic action tool, action tool with OAuth, action tool with API key, trigger tool (EventEmitter pattern with setup/validate/process/teardown), utility tool. Read at scaffold time and adapt.

---

## Verification checklist

Before declaring a plugin done, confirm:

1. ✅ `GET /api/plugins/installed` shows the plugin with `enabled: true`.
2. ✅ All declared tools appear in the response with their schemas intact.
3. ✅ A minimal test workflow or agent that uses the tool executes successfully end-to-end.
4. ✅ Error paths return `{ error: "..." }` — no uncaught throws.
5. ✅ If auth is required, a disconnected state produces a clear, actionable error message ("Reconnect in Settings").
