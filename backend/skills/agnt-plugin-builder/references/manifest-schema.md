# Manifest & Schema Reference

Deep-dive reference for everything you can put in a plugin's `manifest.json`. Load this when scaffolding a plugin with complex UI (multi-action select fields, conditional visibility, rich outputs) or when you need to match the styling of existing AGNT plugins exactly.

---

## Top-level manifest fields

| Field | Required | Notes |
|---|---|---|
| `name` | ✅ | kebab-case, unique across AGNT. Usually `<service>-plugin` or `<service>-api`. |
| `version` | ✅ | SemVer (`1.0.0`). |
| `description` | ✅ | One-sentence summary shown in the plugin list. |
| `author` | ✅ | Free-form. `"AGNT Team"`, `"AGNT User"`, or a real name. |
| `icon` | ✅ | Icon slug (see icon section below). |
| `homepage` | — | GitHub URL or docs URL. |
| `displayName` | — | Pretty name shown in UI. Falls back to `name`. |
| `tools` | ✅ | Array of one or more tool definitions (see next section). |

---

## Tool definition shape

Each entry in the `tools` array:

```json
{
  "type": "my-tool",
  "entryPoint": "./my-tool.js",
  "schema": { /* see below */ }
}
```

- `type` must be kebab-case, globally unique across ALL installed plugins (conflicts silently break loading).
- `entryPoint` is relative to the manifest, always `./filename.js`.
- `schema` is the heart of the tool — it drives both the runtime dispatch and the UI.

---

## Schema fields

```json
{
  "title": "Dropbox API",
  "category": "action",
  "type": "dropbox-api",
  "icon": "dropbox",
  "description": "Human-facing description shown in the node picker and tooltip",
  "documentation": "https://docs.example.com/mytool",
  "authRequired": "oauth",
  "authProvider": "dropbox",
  "parameters": { /* see below */ },
  "outputs":    { /* see below */ }
}
```

### `category` — one of:

| Category | Use for | Example |
|---|---|---|
| `action` | 90% of plugins. A step that performs work. | `dropbox-api`, `weather-api`, `discord-send-message` |
| `trigger` | Starts a workflow when something happens externally. EventEmitter pattern. | `google-sheets-new-row`, `webhook-received` |
| `utility` | Pure data transforms or helpers (no external calls). | `calculator`, `json-parser` |
| `widget` | Dashboard visualization node. | Custom charts/displays |
| `control` | Flow-control node (if/switch/loop). | Rare in plugins — mostly built-in |
| `custom` | Anything that doesn't fit the above. | Fallback |

### `authRequired` — omit entirely OR set to:

| Value | Meaning |
|---|---|
| `"oauth"` | User must have connected `authProvider` via OAuth in Settings. |
| `"apiKey"` | User must have stored an API key for `authProvider`. |
| `"basic"` | HTTP basic auth via AuthManager (rare). |

When set, `authProvider` **must** also be set to the provider slug.

**Built-in provider slugs:** `openai`, `anthropic`, `google`, `github`, `slack`, `discord`, `twitter`, `stripe`, `notion`, `openweathermap`, `dropbox`, `gmail` (for Google workspace), `spotify`, `elevenlabs`.

For one-off API keys with no existing provider, skip `authRequired` and just add a `password`-type parameter — the user pastes the key per node. Simpler but less reusable.

---

## Parameters

Parameters are an **object**, not an array — the key is the param name used in code via `params.<key>`.

### Parameter fields

```json
{
  "type": "string",           // string | number | boolean | object | array
  "inputType": "text",         // UI widget — see table below
  "description": "Shown as help text under the input",
  "placeholder": "e.g. /Documents/foo.txt",
  "required": true,
  "default": "some value",
  "options": ["a", "b"],       // for select/checkbox
  "minimum": 1, "maximum": 100, // for number
  "inputSize": "half",         // "half" renders side-by-side with siblings
  "conditional": { "field": "action", "value": "UPLOAD_FILE" }
}
```

### All `inputType` values

| inputType | Renders | Use for |
|---|---|---|
| `text` | Single-line text input | Short strings, IDs, URLs |
| `textarea` | Multi-line text area | Messages, HTML, long content |
| `number` | Number input with min/max | Counts, amounts, limits |
| `select` | Dropdown (requires `options`) | Choosing an action mode, enums |
| `checkbox` | Checkbox list (requires `options`) | Multi-select flags |
| `password` | Masked text input | API keys entered per-node |
| `codearea` | Monaco editor with syntax highlighting | JSON payloads, code snippets |
| `time` | Time picker | Schedule times |
| `readonly` | Non-editable display (requires `value`) | Documentation/labels inside the form |
| `agent-select` | Dropdown of the user's AGNT agents | Tools that delegate to an agent |

### Conditional visibility

Hide/show a parameter based on another param's current value. The referenced field must be defined earlier in the same `parameters` object.

```json
"content": {
  "type": "string",
  "inputType": "textarea",
  "description": "File content",
  "conditional": { "field": "action", "value": "UPLOAD_FILE" }
}
```

The `value` can also be an **array** — shown when the parent matches ANY of them:

```json
"conditional": { "field": "action", "value": ["UPLOAD_FILE", "UPDATE_FILE"] }
```

### The "multi-action tool" pattern

A single tool that handles many related actions (like `dropbox-api`, `google-sheets-api`, `github-api`) uses a top-level `action` select with all other params conditional on it:

```json
"parameters": {
  "action": {
    "type": "string",
    "inputType": "select",
    "options": ["LIST", "CREATE", "UPDATE", "DELETE"],
    "required": true,
    "description": "Operation to perform"
  },
  "id": {
    "type": "string",
    "inputType": "text",
    "description": "Record ID",
    "conditional": { "field": "action", "value": ["UPDATE", "DELETE"] }
  },
  "data": {
    "type": "string",
    "inputType": "codearea",
    "description": "JSON payload",
    "conditional": { "field": "action", "value": ["CREATE", "UPDATE"] }
  }
}
```

In the tool code: `switch (params.action) { case 'LIST': ... }`.

---

## Outputs

Outputs document the shape of what the tool returns — used for autocomplete in downstream nodes and for AI agents to know what's available.

```json
"outputs": {
  "success": { "type": "boolean", "description": "Whether the operation succeeded" },
  "data":    { "type": "object",  "description": "The API response body" },
  "error":   { "type": "string",  "description": "Error message if failed" }
}
```

`type` values: `string | number | boolean | object | array`.

**Best practice:** Always include an `error` output so downstream nodes can branch on failure without inspecting `.error` implicitly.

---

## Icon names

Icons are rendered by the frontend from a shared icon library. Common/verified values from existing plugins:

`sparkles`, `magic`, `bolt`, `dice`, `table`, `cloud`, `mail`, `message`, `chat`, `code`, `file`, `folder`, `image`, `music`, `video`, `calculator`, `search`, `globe`, `link`, `lock`, `key`, `database`, `terminal`, `api`, `webhook`, `rss`, `calendar`, `clock`, `chart`, `graph`, `shopping-cart`, `credit-card`, `wallet`, `bitcoin`, `ethereum`, `github`, `gitlab`, `dropbox`, `discord`, `slack`, `twitter`, `notion`, `stripe`, `spotify`, `youtube`, `twitch`.

When unsure, use `sparkles` as a safe default. The icon will fall back gracefully if not recognized.

---

## Full example — multi-action auth plugin

This is `dropbox-api` distilled — a canonical real-world manifest with OAuth, multi-action select, conditional params, and typed outputs.

```json
{
  "name": "example-plugin",
  "version": "1.0.0",
  "description": "Example plugin with multi-action OAuth tool",
  "author": "AGNT User",
  "icon": "dropbox",
  "tools": [
    {
      "type": "example-api",
      "entryPoint": "./example-api.js",
      "schema": {
        "title": "Example API",
        "category": "action",
        "type": "example-api",
        "icon": "dropbox",
        "description": "Interact with Example service",
        "authRequired": "oauth",
        "authProvider": "example",
        "parameters": {
          "action": {
            "type": "string",
            "inputType": "select",
            "options": ["LIST", "GET", "CREATE", "DELETE"],
            "required": true,
            "description": "Operation to perform"
          },
          "path": {
            "type": "string",
            "inputType": "text",
            "required": true,
            "description": "Resource path",
            "placeholder": "/folder/item"
          },
          "content": {
            "type": "string",
            "inputType": "textarea",
            "description": "Content to create",
            "conditional": { "field": "action", "value": "CREATE" }
          }
        },
        "outputs": {
          "success": { "type": "boolean", "description": "Whether the operation succeeded" },
          "data":    { "type": "object",  "description": "Response payload" },
          "error":   { "type": "string",  "description": "Error message if failed" }
        }
      }
    }
  ]
}
```
