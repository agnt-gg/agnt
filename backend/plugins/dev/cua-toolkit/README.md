# Cua Computer-Use Toolkit (AGNT plugin)

Autonomous desktop computer-use for AGNT, powered by the [Cua Driver](https://github.com/trycua/cua) (`trycua/cua`, MIT).

The driver speaks MCP over stdio **and** exposes a one-shot CLI. This plugin bridges AGNT → the CLI, so AGNT agents can see windows, read accessibility trees + screenshots, and drive the desktop **in the background without stealing your cursor or focus** (Cua's "no-foreground contract").

## Tools

| Tool | Category | What it does |
|------|----------|--------------|
| `cua-setup` | utility | Install / doctor / serve / stop / status / version. **Run first.** |
| `cua-windows` | utility | Read-only: list windows → `{pid, windowId, title, app}`. |
| `cua-observe` | utility | Read-only: window accessibility tree (elements w/ `index`) + inline screenshot. |
| `cua-input` | action | Primitive: `click` (by elementIndex), `type`, `hotkey`, `launch_app`. `confirm=true` gated. |
| `cua-act` | action | Autonomous loop scaffold: observe → returns plan envelope for the agent to reason+drive. `dryRun` default. |

## The autonomous loop (AGNT-native vision)

`cua-act` / `cua-observe` return the accessibility tree (set-of-mark: every element has an `index`) **plus** the screenshot. AGNT's own vision reasons over both and calls `cua-input action=click elementIndex=N`. The loop is transparent and interruptible — the agent stays the reasoner.

## Windows setup notes

1. Install: `cua-setup action=install confirm=true` (runs `irm …install.ps1 | iex`). Binary lands at `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin\cua-driver.exe`.
2. **Open a fresh session** if `--version` doesn't resolve (PATH update needs a new shell).
3. Start the daemon: `cua-setup action=serve confirm=true` — **required** for element-indexed clicks (the per-pid element cache is in-process).
4. **Session 0 trap**: if `cua-windows` returns empty, run `cua-setup action=doctor` — window tools only work in an interactive logon session, not Session 0 (services/SSH). Register autostart if driving headless.

## Safety

- Every *acting* tool (`cua-input`, `cua-act` live) requires `confirm=true`.
- `cua-act` defaults to `dryRun=true` (observe-only).
- The driver operates the **real host**, not a sandbox — grant UI Automation / desktop-session access with intent.
