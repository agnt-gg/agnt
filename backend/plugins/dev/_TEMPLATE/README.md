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

Connect **<Service>** in **Settings → Connections** (`authProvider: <provider>`).
The sign-in is <a shared AGNT sign-in | declared in this plugin's `manifest.auth`>,
so anyone who installs the plugin can connect it. The key or token reaches the
tool as `params.__auth.token`, scoped to the user. The plugin holds no secret and
never uses the server's ambient environment.

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
