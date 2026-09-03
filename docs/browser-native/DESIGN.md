# Browser + Computer Use, native — design (fix/browser-native)

## Thesis
The praised agents (OpenClaw browser, Codex computer use) win on the LOOP, not the model:
fewer round trips, richer verbs, self-debuggable, blockers reported not guessed.
AGNT already has the right core (`browserActDriver`: AX tree + @refs over CDP, the calling
agent is the loop). This branch closes the loop gaps and makes computer use built-in.

## One driver, every surface
`performBrowserAction(userId, cdpUrl, verb)` is surface-agnostic. The three surfaces differ
ONLY in how `cdpUrl` is resolved (`ai-browser-act.resolveSurface`):

| Surface | Where | cdpUrl comes from |
|---|---|---|
| Browser widget (INSIDE AGNT) | workspaces / canvas turns | `browserSurfaces` registry ← Electron `CdpBridge` |
| Launched hidden Chromium (OUTSIDE, AGNT-owned) | main chat, agent chat, workflows | `browserFallbackSurface` |
| User's own Chrome (OUTSIDE, signed-in) | any | `--remote-debugging-port` attach (future; same driver) |

So every driver improvement lands on main chat, agent chat and workspaces at once. Tests cover
the driver against a protocol-faithful fake AND a real Chromium; the surface tests cover the
three resolution paths.

## Driver upgrades (all session-scoped CDP → work through CdpBridge unchanged)
1. **Inline page state.** `navigate` returns a compact snapshot. Any verb that changes the URL
   returns `navigated:true` + a fresh snapshot. `[new]` marks refs not present last snapshot.
2. **Verbs:** `wait` (selector | text | url | ms), `select` (native `<select>` by value/label),
   `hover`, `press` chords (`Control+Shift+T`, letters, F-keys), `dialog` (accept/dismiss/prompt).
3. **Tabs:** `tabs`, `open`, `focus`, `close`. A click that spawns a tab reports `newTab`.
   Single-tab surfaces (widget bridge) say so instead of failing obscurely.
4. **Observability:** `console`, `errors`, `requests` from bounded ring buffers (200 each).
5. **Dialog safety:** a pending JS dialog is detected by event; verbs report `blockedByDialog`
   instead of timing out on a hung `Runtime.evaluate`.
6. **Untrusted content:** snapshot / read / console / requests are fenced as web content.
7. **URL policy:** `file:`, `javascript:`, `chrome:` refused. Private networks ALLOWED (dev servers
   are the #1 use case). Workflow-templated URLs already carry the HTTP node's risk class.
8. **Loop guard:** same (verb, params, result) 3× in a row → refused with a "stop and report" hint.

## Computer use — built in, not a plugin
Port of the measured `cua-toolkit` plugin (driver 0.19.3) into `library/utilities` +
`library/actions` as `computer-*` tools, shared helpers in `services/computerUse/driver.js`.
NOT ported: `cua-act` (nested model loop). Same reasoning as browsers: the calling agent is the
loop — `computer-observe` → `computer-input` → `computer-observe mode=verify`.
Types are `computer-*` so an installed `cua-toolkit` does not collide; the plugin becomes redundant.
`AGNT_CUA_DRIVER_PATH` env override lets tests run against a fake driver binary.

## Verification gates
- `browserActDriver.test.js` (fake CDP server, protocol-shaped) — every verb, staleness, dialogs,
  tabs, loop guard, buffers.
- `browserActDriver.live.test.js` — real Chromium via `browserFallbackSurface` against a local
  fixture page (dialogs, select, target=_blank, console.error, failing fetch). Skips without Chromium.
- `computerUse/driver.test.js` — outcome contract against a fake `cua-driver` script.
- Surface tests: widget / launched / canvas-race resolution for chat, agent, workspace contexts.
- Independent stress review by other agents before anything is proposed for main.
