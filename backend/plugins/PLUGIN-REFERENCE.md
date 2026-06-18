# AGNT Plugin Reference

> 📖 This is a **lookup reference**, not a starting point. If you're building
> your first plugin, start at [START-HERE-PLUGINS.md](START-HERE-PLUGINS.md) and
> come back here when you need a specific detail.

## Contents

1. [Manifest fields](#1-manifest-fields)
2. [The execute contract](#2-the-execute-contract)
3. [Parameter types](#3-parameter-types)
4. [Conditional parameters](#4-conditional-parameters)
5. [Output shape](#5-output-shape)
6. [Authentication](#6-authentication)
7. [Safely spawning processes](#7-safely-spawning-processes)
8. [Building & the .agnt artifact](#8-building--the-agnt-artifact)
9. [Dev vs. installed paths](#9-dev-vs-installed-paths)

---

## 1. Manifest fields

A `manifest.json` declares the plugin and the tool(s) it provides.

| Field | Required | Notes |
|---|---|---|
| `name` | ✅ | kebab-case, unique. Also becomes the built `<name>.agnt` filename. |
| `version` | ✅ | semver `MAJOR.MINOR.PATCH`. |
| `description` | ✅ | One line. |
| `author` | ✅ | Your real name/handle. |
| `tools[]` | ✅ | One or more tool definitions (see below). |

Each entry in `tools[]` (validated by `build-plugin.js`):

| Field | Required | Notes |
|---|---|---|
| `type` | ✅ | Unique tool id, e.g. `discord-send-message`. House style: `<service>-<verb>` or `<service>-api`. |
| `entryPoint` | ✅ | The JS file implementing the tool, e.g. `index.js`. (The build fails if this is missing or the file doesn't exist.) |
| `schema` | ✅* | The UI/contract object (title, category, icon, parameters, outputs). *Build emits a warning if absent, but the orchestrator cannot surface the tool without it — treat it as required.* |

The `schema` object holds the user-facing definition:

| schema key | Notes |
|---|---|
| `title` | Human label in the node picker. |
| `type` | Mirror of the tool `type`. |
| `category` | `action` \| `trigger` \| `logic` (etc). |
| `icon` | Icon key. |
| `description` | One line. |
| `parameters` | Object of input definitions (see §3). |
| `outputs` | Output schema (see §5). |
| `authRequired` / `authProvider` | See §6. |
| `documentation` | Optional URL. |

> Optional ecosystem-asset arrays (`agents`, `workflows`, `skills`, `widgets`)
> are also supported and validated — each entry needs a `slug` and a file
> reference (`definition`/`source`).

---

## 2. The execute contract

The `entryPoint` file default-exports a class with an `execute` method. The
signature is **always**:

```javascript
export default class MyTool {
  /**
   * @param {Object} params         - resolved parameters from the workflow node
   * @param {Object} inputData      - data from the previous node
   * @param {WorkflowEngine} workflowEngine - engine ref (userId, auth, etc.)
   * @returns {Object} output data for the next node
   */
  async execute(params, inputData, workflowEngine) {
    return { success: true, result: /* ... */ };
  }
}
```

`workflowEngine` exposes per-run context (including the executing user) and is
how resolved credentials reach your tool — do not read ambient process state for
identity or secrets.

---

## 3. Parameter types

Defined inside `schema.parameters`.

| inputType    | UI                     | Extra keys          |
|--------------|------------------------|---------------------|
| `text`       | Single-line text       | -                   |
| `textarea`   | Multi-line text        | -                   |
| `select`     | Dropdown               | `options: string[]` |
| `checkbox`   | **Multiple** selection | `options: string[]` |
| `password`   | Hidden input           | -                   |
| `codearea`   | Code editor            | -                   |
| `time`       | Time picker (HH:MM)    | -                   |
| `readonly`   | Display-only           | `value: string`     |
| `agent-select` | Agent selector       | -                   |

> 💡 **Boolean toggle?** Use `select` with `["Yes","No"]`, not `checkbox`.
> `checkbox` is for *multi*-selection. (House style across all bundled plugins.)

Common per-parameter keys: `type`, `inputType`, `description`, `required`,
`default`, `options`, `conditional`.

---

## 4. Conditional parameters

Show a field only when another field has a given value:

```json
"embedTitle": {
  "type": "string",
  "inputType": "text",
  "description": "Embed title",
  "conditional": { "field": "embedEnabled", "value": "Yes" }
}
```

`value` may also be an array to match any of several values.

---

## 5. Output shape

Tools return a consistent object so downstream nodes can branch on success.
Declare it in `schema.outputs`:

```json
"outputs": {
  "success": { "type": "boolean" },
  "result":  { "type": "object" },
  "error":   { "type": "string" }
}
```

Return `{ success: true, result }` on success and
`{ success: false, error }` on failure — never throw raw across the node
boundary if you can return a structured error instead.

---

## 6. Authentication

Declare in the tool `schema`:

```json
"authRequired": "apiKey",   // or "oauth2"
"authProvider": "discord"
```

AGNT resolves a valid, **per-user** credential via AuthManager and hands it to
your `execute()`. Rules:

- ❌ Never hardcode keys. ❌ Never read the server's ambient env for secrets.
- ✅ The token is scoped to the workflow's user — correct on shared/multi-user
  instances.

Users connect providers in **Settings → Integrations**. For OAuth providers,
AuthManager handles refresh; your tool always receives a valid access token.

---

## 7. Safely spawning processes

If your tool shells out to a CLI:

- **Binary path from `process.env.<X>_BIN` / server config only — never a
  workflow parameter.** Resolve to an absolute path before spawn. Workflow
  inputs are user/agent-controlled; a configurable binary is host RCE.
- **Minimal env allowlist** (`PATH`, `HOME`, `USERPROFILE`, temp dirs, your
  `<X>_*` vars). Never pass `process.env` — it leaks server secrets to the child.
- **Sanitize positional args** — reject values that begin with `-` (flag
  injection) or contain `..`/path separators (traversal).
- **Use `shell: false`** and pass argv arrays, never a concatenated string.
- **Clean up** any remote/leased resource on timeout or failure; escalate
  SIGTERM → SIGKILL after a grace period; use a sane default timeout.

The `dev/crabbox-plugin/` source is a worked example of all of the above.

---

## 8. Building & the .agnt artifact

```bash
node build-plugin.js <path-to-your-plugin-folder>   # → plugin-builds/<name>.agnt
```

`build-plugin.js` accepts either a **folder name inside `./dev`** (the
contributor path) or a **path to a plugin folder anywhere on disk** (absolute,
relative, or `~`-based — for your own plugins). The output filename comes from
the manifest `name`.

The `.agnt` is a portable, gzipped tar bundle with dependencies pre-installed:
install it via **Settings → Plugins → Install from file**, or publish it to the
**marketplace**. Dependencies are installed automatically at build time and
bundled — the end user needs no npm/Node toolchain.

> **Never commit `.agnt` files to the repo** — they're generated outputs, and
> `backend/plugins/plugin-builds/` is gitignored.

---

## 9. Dev vs. installed paths

| | Source | Installed location |
|---|---|---|
| Your own plugin | anywhere on disk | `%APPDATA%/AGNT/plugins/installed/` (Win), `~/Library/Application Support/AGNT/plugins/installed/` (macOS), `~/.config/AGNT/plugins/installed/` (Linux) |
| Bundled default (contributor) | `backend/plugins/dev/` | shipped inside the app build |

> `backend/plugins/dev/` is the **core repo's staging area for bundled
> plugins** — only relevant on the contributor path. Your own plugins live
> wherever you like; `build-plugin.js` takes the folder path as an argument.
