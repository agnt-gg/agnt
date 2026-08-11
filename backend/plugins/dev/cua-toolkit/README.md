# Cua Computer-Use Toolkit (AGNT plugin)

Background desktop computer-use for AGNT, powered by the [Cua Driver](https://github.com/trycua/cua) (`trycua/cua`, MIT). Verified **live against driver 0.19.3** — the "computer-use 2.0" line.

Agents drive real Windows applications **without touching your mouse and without stealing focus**. Input routes through the accessibility layer (UIA Invoke / ValuePattern) rather than through the OS input queue, so nothing warps your cursor, raises a window, or flashes the taskbar — while the driver paints its *own* session-coloured cursor overlay so you can still watch the work happen.

## Tools

| Tool | Category | What it does |
|------|----------|--------------|
| `cua-setup` | utility | Install / update / doctor / **health** / **permissions** / **config** / **tools** / serve / stop. `ensure` = one-call bootstrap. |
| `cua-session` | utility | **New.** Declare a run identity: agent cursor overlay + capture policy. Escalate to desktop scope explicitly. |
| `cua-windows` | utility | Open windows *and* (`include=apps`) installed/running applications with a ready-to-use `launchPath`. |
| `cua-observe` | utility | `window` (elements + tokens + tree + screenshot) · **`verify`** (deterministic predicates) · **`zoom`** (native-res crop) · **`desktop`** (full display). |
| `cua-input` | action | click / type / **paste_text** / press_key / hotkey / scroll / set_value / drag / **invoke_menu** / **clipboard** / **set_window_frame** / launch_app / bring_to_front / kill_app. |
| `cua-act` | action | Autonomous observe→reason→act→**measure** loop with a real success gate. |

## What changed in v0.5.0

### 1. Sessions and the agent cursor
Every `cua-act` run now declares a driver session. That buys a colour-coded cursor overlay animated to each target (your physical pointer never moves) and a capture policy: `auto` scope starts window-only and keeps desktop-wide capture **locked** until you escalate on purpose. Escalation is **permanent** for that session id — the driver's design, not ours, which is why it is `confirm`-gated. The session is ended in a `finally` block so an abort can't strand a cursor on screen.

### 2. The closed outcome contract — and the trap inside it
0.19 answers every action with `{ effect, route, delivery, escalation }`, and **a refusal still exits 0**. There are three envelopes in the wild, all measured here:

```jsonc
{ "effect": "unverifiable", "route": "accessibility", "delivery": { "mode": "background" } }
{ "status": "refused", "refusal": { "code": "stale_element_token", "message": "…" } }
{ "effect": "refused", "code": "ambiguous_window_target", "pid": 52672 }
```

> **`effect: "unverifiable"` is NOT a failure.** A measured click on the Calculator's `Seven` button returned exactly that — and `verify_state` then proved the display read `Display is 7`. The driver is declining to overclaim, not reporting a no-op. Treat it as failure and a working agent gives up; treat it as success and a broken one keeps going. The only correct answer is to **measure**.

The old version regex-matched raw text for `delivery_failed`, which cannot tell these three apart. `lib/driver.js` now normalises all of them in one place.

### 3. Verification replaces vibes
The weakest link in any screenshot loop is the model grading its own homework. `cua-observe mode="verify"` evaluates real structured state and returns `satisfied` / `unsatisfied` / **`unknown`** — and **unknown never counts as success**.

`cua-act` uses this two ways: the model may attach `"expect"` to any step and get told the truth about it, and if you pass **`successContains`**, a claim of `done` is **rejected** until the driver can prove it. That single parameter is the difference between "the agent said it worked" and "it worked".

### 4. Native menus instead of blind clicks
`invoke_menu` resolves an application menu path one live level at a time through the accessibility API — `ExpandCollapse` at each hop, `Invoke`/`SelectionItem` at the leaf — and **fails closed** on missing, ambiguous or disabled segments. It never falls back to pixels. Clicking through menus by coordinate is how agents open the wrong thing.

### 5. Windows 11 Notepad is no longer a dead end
v0.4.1 shipped a table saying the Store Notepad editor **cannot be typed into in the background** and that this was "not fixable from here". That conclusion was drawn from one rung of the ladder. Walking all six against the real editor (`projects/cua-tests/notepad-ladder.mjs`) says otherwise:

| Rung | Lands? | Reported honestly? |
|---|---|---|
| `set_value` by element token | ✘ | ✔ refuses — no ValuePattern |
| `type` by element token (ax) | ✘ **silent no-op** | `effect: unverifiable` — unproven, not "done" |
| **`type` by pixel (focus-then-type)** | **✔ in the background** | ✔ |
| `type` by pixel + foreground | ✔ | ✔ |
| `paste_text` by pixel | ✘ | ✔ |
| `paste_text` by pixel + foreground | ✔ | ✔ |

**The pixel form of `type` works, in the background, with no focus steal.** The accessibility route is what fails here, not background delivery — and the two had been conflated. `cua-act` now carries this ladder as an explicit rule: if an element-addressed write comes back unproven and the postcondition is unsatisfied, it switches to the pixel form instead of retrying the no-op.

`paste_text` remains for long text and awkward characters. It replaces your clipboard, says so, and `restoreClipboard=true` puts the old contents back.

### 6. `success` and `proven` are different questions
Rung 2 above is the whole reason: it dispatches cleanly, reports `effect: "unverifiable"`, and inserts nothing. So every `cua-input` response now carries **both** `success` (dispatched, not refused) and **`proven`** (`effect === "confirmed"` — the driver has real evidence). Anything that matters gets verified, not assumed.

## Measured gotchas (learned the hard way, encoded in the code)

| Finding | Consequence |
|---|---|
| **An accessibility tree can advertise an action the element does not implement.** Notepad's editor lists `actions=[set_value,scroll]`; `set_value` then refuses with "does not implement ValuePattern". | Never treat the tree as a capability contract. Try, read the outcome, verify. |
| **A driver failure can arrive as plain text with exit code 0** — e.g. `Failed to activate packaged app …(0x80073CF1)`, or a hotkey refusal that names no error word at all. | `readOutcome()` treats an unparseable response as a FAILURE unless it is explicitly affirmative. An earlier build tried a list of error words instead and shipped two phantom successes in one afternoon. |
| **A minimized window cannot be observed at all.** `get_window_state` returns `degraded`, **0 elements**, and screenshot capture *fails*; `zoom` refuses because GDI hands back an all-black bitmap. | `start_minimized` is deliberately **not** exposed on `launch_app`. Plain `SW_SHOWNOACTIVATE` already gives a visible-but-never-focused window, which is what "runs in the background" actually needs. `cua-act` detects the trap and restores the window rather than flailing blind. |
| Two windows on one pid → `ambiguous_window_target`, refused rather than guessed. | Always pass `windowId` for keyboard actions. |
| `kill_app` refuses processes this runtime did not launch (`foreign_process_termination_denied`). | Close foreign apps via their own UI (`hotkey alt+f4`). |
| `get_desktop_state` under a fresh `auto` session → `desktop_escalation_required`. | Finish the window ladder, then escalate deliberately. |
| `zoom` returns a field named `screenshot_png_b64` whose `mime_type` says **jpeg**. | Trust `mime_type`, not the field name. |
| Element tokens are per-snapshot and fail closed once superseded. | Observe → act → re-observe. Never reuse a token across turns. |

## The delivery ladder

`background` is the **mandatory first attempt**, not a preference:

1. Background accessibility action (element token) — backgroundable, z-order independent, the only driver-verifiable rung.
2. Background pixel action — off the screenshot in the same response.
3. **Foreground** — only after the driver itself reports background cannot land.
4. Desktop scope — explicit, permanent, last.

Passing `deliveryMode:"foreground"` preemptively because a target "looks like" Electron is a bug, not a shortcut: it steals the focus the whole design exists to protect. The tools never do it on their own, and `cua-act` only does it when the driver's own `escalation` says so.

## Deliberately not wrapped

Driver 0.19 also ships a `browser_*` CDP family (9 tools). It is **intentionally not exposed here**: AGNT already drives browsers through its own native Browser Agent, and a second browser-control surface would mean two owners of one capability, drifting apart. Desktop apps are this plugin's job. `cua-setup action="tools"` lists the full driver surface if you want to see everything available.

## Setup

1. One call: `cua-setup action=ensure confirm=true` — installs if missing, starts the daemon, health-checks, reports available updates.
2. Update anytime: `cua-setup action=update confirm=true`.
3. **Session 0 trap**: if `cua-windows` returns empty, run `cua-setup action=doctor`. Window tools only work in an interactive logon session; the installer registers a logon autostart task.
4. Run exactly **one** daemon. The element/snapshot cache is per-daemon and in-process — two daemons racing `\\.\pipe\cua-driver` turn a valid handle into a silent cache miss.

## Safety

- Every *acting* tool (`cua-input`, `cua-act`) requires `confirm=true`; `cua-act dryRun=true` previews without dispatching.
- Session escalation to desktop scope requires its own `confirm=true` because it is irreversible for that session id.
- The driver operates the **real host**, not a sandbox. Grant desktop access with intent.
- The LLM bridge runs loopback-only against the local AGNT backend with a short-lived internal token; reasoning uses your own selected provider, so nothing is sent to a third party you did not choose.
