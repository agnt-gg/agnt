# Diagnostics & Fatal Policy

AGNT writes process diagnostics (JSONL logs + crash dumps) under the data root:

| Run mode | Typical path |
|----------|----------------|
| Electron (macOS) | `~/Library/Application Support/AGNT/diagnostics/` |
| Electron (Windows) | `%APPDATA%\AGNT\diagnostics\` |
| Electron (Linux) | `~/.config/AGNT/diagnostics/` |
| Docker / `AGNT_HOME` | `$AGNT_HOME/.agnt/data/diagnostics/` or PathManager root |

Crash records land in `diagnostics/crashes/*.json` (ring buffer + system snapshot).

## Fatal policy (`AGNT_FATAL_POLICY`)

Controls what happens after `uncaughtException` / `unhandledRejection` once a crash is recorded:

| Value | Behavior |
|-------|----------|
| **`exit`** | Dump (if not deduped), then exit with code 1 so a supervisor can respawn |
| **`stay`** | Dump (if not deduped), keep running |

### Defaults

| Process | Default | Why |
|---------|---------|-----|
| **Workflow worker** (`IS_WORKFLOW_PROCESS=true`) | **`exit`** | Parent `WorkflowProcessBridge` restarts the child. Staying alive after a broken pipe used to storm crash files. |
| **Backend** (Express) | **`stay`** | Compatibility; set `AGNT_FATAL_POLICY=exit` if you want hard fail + Electron supervisor respawn. |
| **Electron main** | installed separately with **`stay`** | Exit is owned by Electron lifecycle. |

Override always wins when set:

```bash
# Force exit after fatals (backend + workers)
AGNT_FATAL_POLICY=exit

# Force stay (not recommended for workflow workers)
AGNT_FATAL_POLICY=stay
```

## Broken pipe (EPIPE) handling

When a **parent process closes stdout/stderr/IPC**, child writes can throw:

- `EPIPE` / “broken pipe”
- `ERR_STREAM_DESTROYED`
- some `EIO` cases

These are treated as **benign**:

- **No** multi-hundred-KB crash dump
- Workflow workers **exit cleanly** so the bridge can restart
- stdout/stderr have error guards so closed pipes don’t become uncaughtException storms

Real application bugs still dump (once) and follow `fatalPolicy`.

## Crash dump dedupe

Identical fatals (same reason + code + message) within **60 seconds** write **one** crash file. Further occurrences log a short “suppressed duplicate” line to stderr instead of filling disk.

## Cleaning up after a storm

If an older build already wrote many crash files:

```bash
# macOS Electron example
rm -rf ~/Library/Application\ Support/AGNT/diagnostics/crashes/*

# Docker / AGNT_HOME example
rm -rf "${AGNT_HOME:-$HOME}/.agnt/data/diagnostics/crashes/"*
```

Leave `diagnostics/` itself (JSONL logs may still be useful).

## Related code

- `backend/src/diagnostics/install.js` — handlers, EPIPE, dedupe  
- `backend/src/diagnostics/bootstrap.js` — backend/workflow defaults  
- `backend/src/workflow/WorkflowProcess.js` — IPC EPIPE → clean exit  
- Tests: `backend/src/diagnostics/diagnostics.test.js`  

## See also

- Hybrid desktop remote backend: [QUICKSTART_HYBRID.md](QUICKSTART_HYBRID.md)  
- Self-hosting: [SELF_HOSTING.md](SELF_HOSTING.md)  
