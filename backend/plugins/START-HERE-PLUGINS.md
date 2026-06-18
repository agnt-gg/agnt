# Build an AGNT Plugin

This is the canonical starting point for building a plugin. **Stop looking
elsewhere** — everything you need to ship a working plugin is on this page.

You do **not** fork this repo. You build your plugin in its own folder anywhere
on your machine, compile it to a `.agnt` file, and install or publish that file.

---

## What you're making

```
my-plugin/                 ← lives ANYWHERE on disk (not inside the AGNT repo)
├── manifest.json          ← what the tool is + its inputs
├── index.js               ← what the tool does
└── package.json           ← "type": "module" + any deps
        │
        ▼  node build-plugin.js ./my-plugin
   my-plugin.agnt          ← the product. install it. publish it. done.
```

A plugin compiles to one portable `.agnt` file. That file is the entire
deliverable: install it locally to use it, or upload it to the marketplace to
share it. **You are finished when the `.agnt` builds and installs.**

---

## Golden path (copy-paste, ~5 minutes)

### 1. Make a folder — anywhere except inside this repo

```bash
mkdir my-weather-plugin && cd my-weather-plugin
```

> 📍 This folder is yours. It does **not** go in `backend/plugins/dev/` — that
> folder is only for plugins the AGNT team bundles into the app (see the
> contributor path). Building your own plugin requires zero changes to the AGNT
> repository.

### 2. `manifest.json` — declare the tool

Each tool needs a `type`, an `entryPoint` (the JS file), and a `schema` (how the
node appears in the UI and what inputs it takes).

```json
{
  "name": "my-weather-plugin",
  "version": "1.0.0",
  "description": "Get the current temperature for a city",
  "author": "Your Name",
  "tools": [
    {
      "type": "weather-get-current",
      "entryPoint": "index.js",
      "schema": {
        "title": "Get Current Weather",
        "type": "weather-get-current",
        "category": "action",
        "icon": "cloud",
        "description": "Get the current temperature for a city",
        "parameters": {
          "city": {
            "type": "string",
            "inputType": "text",
            "description": "City name, e.g. 'Austin'",
            "required": true
          }
        },
        "outputs": {
          "success": { "type": "boolean" },
          "result":  { "type": "object" },
          "error":   { "type": "string" }
        }
      }
    }
  ]
}
```

### 3. `index.js` — implement the tool

The contract is always `async execute(params, inputData, workflowEngine)`.
Return `{ success, result, error }`.

```javascript
export default class WeatherGetCurrent {
  async execute(params, inputData, workflowEngine) {
    try {
      const { city } = params;
      if (!city) return { success: false, error: 'city is required' };

      const res = await fetch(
        `https://wttr.in/${encodeURIComponent(city)}?format=j1`
      );
      const data = await res.json();
      const temp = data.current_condition?.[0]?.temp_C;

      return { success: true, result: { city, tempC: Number(temp) } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}
```

### 4. `package.json`

```json
{
  "name": "my-weather-plugin",
  "version": "1.0.0",
  "type": "module"
}
```

### 5. Build it → produces your `.agnt`

Run the build script and point it at your folder. The path can be **absolute,
relative, or `~`-based** — your source stays wherever it lives:

```bash
# from anywhere, using the script in this repo:
node /path/to/agnt/backend/plugins/build-plugin.js ~/my-weather-plugin
# → backend/plugins/plugin-builds/my-weather-plugin.agnt
```

The output `.agnt` is named from your manifest's `name` field. (A bare name with
no path, e.g. `node build-plugin.js discord-plugin`, is reserved for plugins
that live in `backend/plugins/dev/` — the contributor path.)

✅ **Checkpoint:** a `my-weather-plugin.agnt` file now exists in
`plugin-builds/`. If it does, your plugin compiled.

### 6. Install it

Settings → Plugins → **Install from file** → choose `my-weather-plugin.agnt`.

✅ **Checkpoint:** "Get Current Weather" now appears in the workflow node
picker. **You're done.** Use it like any built-in node.

---

## Share it: publish to the marketplace

The same `.agnt` file is what you publish. From Settings → Plugins →
**Publish to Marketplace**, upload your `.agnt`. No PR, no repo changes — other
users install it the same way you did in step 6.

> The marketplace is the distribution channel for community and third-party
> plugins. If your plugin wraps a third-party or commercial service, this is the
> correct and only path — such plugins are not bundled into the core app.

---

## Adding credentials (API keys, OAuth)

If your tool needs a secret, **never hardcode it and never read the server's
ambient environment.** Declare auth in the tool's `schema` and let AGNT's
AuthManager supply a per-user token at run time:

```json
"authRequired": "apiKey",
"authProvider": "openweather"
```

The resolved credential is delivered to your `execute()` scoped to the
workflow's user. Full pattern, including OAuth providers and the minimal-env
rule for spawned processes → [PLUGIN-REFERENCE.md § Authentication](PLUGIN-REFERENCE.md#6-authentication).

---

## Where to go next

- 📖 **All parameter types, conditional fields, output shapes, icons** →
  [PLUGIN-REFERENCE.md](PLUGIN-REFERENCE.md)
- 🔐 **Auth, AuthManager, spawning processes safely** →
  [PLUGIN-REFERENCE.md § Authentication](PLUGIN-REFERENCE.md#6-authentication)
- 🧪 **A real, hardened example** — the Crabbox plugin shows credentials via
  AuthManager, a minimal-env spawn allowlist, input sanitization, and remote
  resource cleanup → [`dev/crabbox-plugin/`](dev/crabbox-plugin/)
- 🔵 **Want it bundled into AGNT itself instead?** That's a different, rarer
  process → [CONTRIBUTING-CORE-PLUGINS.md](CONTRIBUTING-CORE-PLUGINS.md)

---

## Definition of done ✅

- [ ] Source lives in its own folder (not inside the AGNT repo)
- [ ] `node build-plugin.js <your-folder>` produced a `.agnt`
- [ ] Installing the `.agnt` makes your tool appear in the node picker
- [ ] (To share) the `.agnt` is uploaded to the marketplace

If all four are checked, you've successfully built and shipped an AGNT plugin.
You never needed to touch this repository.
