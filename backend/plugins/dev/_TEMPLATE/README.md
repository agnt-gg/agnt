# <Plugin Name>

<One sentence: what the tool does in a workflow.>

> 📦 This is a plugin. You build it to a portable `.agnt` and install or publish
> it — **no AGNT repo changes required.** New here? Start at
> [../../START-HERE-PLUGINS.md](../../START-HERE-PLUGINS.md).

## What it does

- Tool `type`: `<tool-type>`
- Inputs: `<param>` (...), ...
- Outputs: `{ success, result, error }`

## Setup

<Any CLI to install, account to create, etc. Omit if none.>

## Credentials

Connect in **Settings → Integrations** (`authProvider: <provider>`). The token
is supplied per-run via AuthManager, scoped to your user. The plugin never uses
the server's ambient environment.

## Build & publish

```bash
node build-plugin.js ./<plugin-folder>   # → <plugin-folder>.agnt
```

Install the `.agnt` (Settings → Plugins → Install from file) or upload it to the
marketplace to share. No repo changes required.

## Security notes

<Binary resolution from env/config, env allowlist, input sanitization, remote
resource cleanup — if your plugin spawns processes or leases resources. Omit if
not applicable. See ../../PLUGIN-REFERENCE.md § Safely spawning processes.>
