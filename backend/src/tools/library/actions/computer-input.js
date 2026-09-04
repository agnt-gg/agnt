// computer-input.js — primitive input on real windows. Cua Driver 0.19.x.
//
// ADDRESSING. Element actions need the element_token (preferred; it carries
// snapshot + window) or element_index + snapshot_id from the CURRENT
// get_window_state snapshot — the driver FAILS CLOSED on a bare index with a
// `stale_element_token` refusal. Pixel actions (window-local screenshot x/y)
// need no snapshot.
//
// DELIVERY LADDER. background is the MANDATORY first attempt, not a hint: it
// never fronts, never raises, never warps the cursor. Escalate to foreground
// ONLY after the driver itself says background is impossible. Fronting on a
// guess because a target "looks like Electron" is a bug, not a shortcut.
//
// OUTCOMES. Exit code 0 does NOT mean the action landed — 0.19 reports both
// success and refusal with exit 0 and different JSON envelopes. All of that is
// normalized in lib/driver.js readOutcome(). Read `effect`, and remember that
// effect:"unverifiable" is the driver declining to overclaim, NOT a failure.
import BaseAction from '../BaseAction.js';
import {
  asBool, asInt, resolveDriverPath, notInstalledResult, ensureReady,
  callTool, invokeMenu, clipboardRead, clipboardWrite, setWindowFrame,
} from '../../../services/computerUse/driver.js';

const DELIVERY_AWARE = new Set(['click', 'double_click', 'right_click', 'type', 'press_key', 'scroll', 'hotkey', 'paste_text']);

class ComputerInput extends BaseAction {
  static schema = {
    "title": "Computer Input (Click / Type / Menu / Keys / Clipboard)",
    "category": "action",
    "type": "computer-input",
    "icon": "connect",
    "description": "Primitive input on a real window with background delivery — no cursor warp, no focus steal, no window raise. Element actions target elements via elementToken from the LATEST computer-observe snapshot (preferred) or elementIndex+snapshotId, or window-local x/y pixels for canvas surfaces. Highlights: invoke_menu resolves a native menu path through the accessibility API and fails closed instead of clicking blind; paste_text writes the clipboard and sends Ctrl+V, which reaches editors exposing no ValuePattern (Windows 11 Notepad); set_window_frame moves/resizes with verified read-back. Every response reports the driver's closed action facts (effect/route/escalation) — note that effect=unverifiable means the driver will not overclaim, NOT that the action failed. Requires confirm=true.",
    "parameters": {
      "action": {
        "type": "string",
        "inputType": "select",
        "required": true,
        "options": [
          "click",
          "double_click",
          "right_click",
          "type",
          "paste_text",
          "press_key",
          "hotkey",
          "scroll",
          "set_value",
          "drag",
          "invoke_menu",
          "clipboard_read",
          "clipboard_write",
          "set_window_frame",
          "launch_app",
          "bring_to_front",
          "kill_app"
        ],
        "default": "click",
        "description": "click/double_click/right_click=element or pixel click; type=insert text (element-addressed routes through UIA ValuePattern, required for XAML/WinUI3 apps); paste_text=clipboard + Ctrl+V, the reliable path for editors that refuse programmatic text; press_key=one key; hotkey=combination like ctrl+s; scroll=direction+amount; set_value=atomic whole-value write (dropdowns, checkboxes, sliders); drag=x,y→x2,y2; invoke_menu=native menu path, never a blind click; clipboard_read/clipboard_write; set_window_frame=move/resize one window; launch_app=open an app, URL, path or AUMID without stealing focus; bring_to_front=persistent focus proxy (also restores a minimized window); kill_app=terminate (only processes this driver launched)."
      },
      "pid": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "Target pid (required for most actions; from computer-windows)."
      },
      "windowId": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "Target window id. Pass it whenever the app owns more than one window — the driver refuses with ambiguous_window_target rather than guessing."
      },
      "session": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "Session id from computer-session: gives this action the run's cursor overlay and capture policy."
      },
      "elementToken": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "Per-snapshot element handle from computer-observe elements[].token — the PREFERRED way to target an element. Goes stale after the next snapshot of that window."
      },
      "elementIndex": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "Element index from computer-observe. Requires snapshotId alongside it — the driver fails closed on bare indices. Prefer elementToken."
      },
      "snapshotId": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "Snapshot handle from computer-observe (required with elementIndex)."
      },
      "text": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "Text to type or paste; key name for press_key; \"ctrl+s\" for hotkey; \"File > Save As\" for invoke_menu; app name / AUMID / path / URL for launch_app; clipboard contents for clipboard_write."
      },
      "menuPath": {
        "type": "array",
        "inputType": "text",
        "required": false,
        "description": "invoke_menu, structured form: [\"File\",\"Save As...\"]. Labels are case-sensitive after trimming and must be immediate children at each level."
      },
      "keys": {
        "type": "array",
        "inputType": "text",
        "required": false,
        "description": "hotkey, structured form: [\"ctrl\",\"shift\",\"t\"]. Modifiers first, exactly one non-modifier last."
      },
      "modifiers": {
        "type": "array",
        "inputType": "text",
        "required": false,
        "description": "press_key: modifier names held during the key (ctrl/shift/alt/win)."
      },
      "value": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "Value to write (action=set_value)."
      },
      "x": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "Window-local screenshot pixel X (pixel click, type/hotkey focus point, drag start, window frame X)."
      },
      "y": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "Window-local screenshot pixel Y."
      },
      "x2": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "Drag end X."
      },
      "y2": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "Drag end Y."
      },
      "width": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "set_window_frame: new width."
      },
      "height": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "set_window_frame: new height."
      },
      "direction": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "down",
          "up",
          "left",
          "right"
        ],
        "default": "down",
        "description": "Scroll direction."
      },
      "amount": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "default": 3,
        "description": "Scroll ticks 1-50."
      },
      "by": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "line",
          "page"
        ],
        "default": "line",
        "description": "Scroll granularity."
      },
      "scope": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "window",
          "desktop"
        ],
        "default": "window",
        "description": "desktop sends the action with screen-absolute coordinates and no pid/windowId — only valid in an escalated or desktop-scope session."
      },
      "restoreClipboard": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "false",
          "true"
        ],
        "default": "false",
        "description": "action=paste_text: put the user's previous clipboard text back after pasting."
      },
      "deliveryMode": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "background",
          "foreground"
        ],
        "description": "Leave unset. background (the default) never fronts, raises or warps the cursor. Pass foreground ONLY after the driver itself reported that background delivery cannot land — fronting on a guess steals the user's focus and is a bug, not a shortcut."
      },
      "confirm": {
        "type": "string",
        "inputType": "select",
        "required": true,
        "options": [
          "false",
          "true"
        ],
        "default": "false",
        "description": "Safety gate. Must be true to dispatch real input to your desktop."
      }
    },
    "outputs": {
      "success": {
        "type": "boolean",
        "description": "True when the action was dispatched and not refused."
      },
      "dispatched": {
        "type": "boolean",
        "description": "Whether real input was sent."
      },
      "action": {
        "type": "string",
        "description": "Echoed action."
      },
      "target": {
        "type": "object",
        "description": "{ pid, windowId } targeted."
      },
      "effect": {
        "type": "string",
        "description": "confirmed | partial | unverifiable | suspected_noop | refused. IMPORTANT: unverifiable means the driver cannot PROVE the effect — it is not a failure. Verify with computer-observe mode=verify."
      },
      "route": {
        "type": "string",
        "description": "accessibility | synthetic_events | global_input | dom | trusted_input — which channel delivered the input."
      },
      "deliveryMode": {
        "type": "string",
        "description": "background or foreground, as actually used."
      },
      "refused": {
        "type": "boolean",
        "description": "True when the driver deliberately did not deliver."
      },
      "code": {
        "type": "string",
        "description": "Closed refusal code, e.g. stale_element_token, ambiguous_window_target, menu_path_unavailable, desktop_escalation_required."
      },
      "escalation": {
        "type": "string",
        "description": "The driver's instruction for what to try next: pixel | foreground | page | session. Never auto-retried."
      },
      "escalationReason": {
        "type": "string",
        "description": "Why the escalation was suggested."
      },
      "clipboardText": {
        "type": "string",
        "description": "Clipboard contents (action=clipboard_read)."
      },
      "clipboardReplaced": {
        "type": "boolean",
        "description": "True when paste_text overwrote the user's clipboard."
      },
      "clipboardRestored": {
        "type": "boolean",
        "description": "True when the previous clipboard text was put back."
      },
      "launchedPid": {
        "type": "number",
        "description": "pid of the app that was launched (action=launch_app)."
      },
      "windows": {
        "type": "array",
        "description": "Windows the launched app already owns."
      },
      "landedOnTarget": {
        "type": "boolean",
        "description": "action=bring_to_front: whether Windows actually allowed the foreground swap."
      },
      "menuPath": {
        "type": "array",
        "description": "Menu path that was resolved."
      },
      "result": {
        "type": "object",
        "description": "Parsed driver response."
      },
      "raw": {
        "type": "string",
        "description": "Raw driver output (debugging aid, truncated)."
      },
      "summary": {
        "type": "string",
        "description": "One-line human-readable outcome."
      },
      "hint": {
        "type": "string",
        "description": "Concrete next step derived from the driver's own verdict."
      },
      "error": {
        "type": "string",
        "description": "Error message when success=false."
      }
    }
  };

  constructor() { super('computer-input'); }

  async execute(params) {
    const action = String(params?.action || 'click').toLowerCase();
    const confirm = asBool(params?.confirm);
    const num = (v) => (v != null && v !== '' ? Number(v) : null);
    const int = (v) => (v != null && v !== '' ? Number.parseInt(v, 10) : null);

    const pid = int(params?.pid);
    const windowId = int(params?.windowId);
    const elementIndex = int(params?.elementIndex);
    const elementToken = String(params?.elementToken || '').trim() || null;
    const snapshotId = String(params?.snapshotId || '').trim() || null;
    const session = String(params?.session || '').trim() || null;
    const text = params?.text != null ? String(params.text) : '';
    const value = params?.value != null ? String(params.value) : '';
    const x = num(params?.x); const y = num(params?.y);
    const x2 = num(params?.x2); const y2 = num(params?.y2);
    const width = num(params?.width); const height = num(params?.height);
    const direction = String(params?.direction || 'down').toLowerCase();
    const amount = asInt(params?.amount, 3, 1, 50);
    const scope = String(params?.scope || '').toLowerCase() === 'desktop' ? 'desktop' : null;
    const deliveryMode = ['background', 'foreground'].includes(String(params?.deliveryMode)) ? String(params.deliveryMode) : null;

    if (!confirm) {
      return { success: false, dispatched: false, error: 'Refusing to dispatch input to your desktop without confirm=true.' };
    }

    const resolved = resolveDriverPath();
    if (!resolved.found && !resolved.onPath) return notInstalledResult();
    const boot = await ensureReady({ allowInstall: false });
    if (!boot.ready) return { ...notInstalledResult(), bootstrap: boot.steps };

    // token > index+snapshot > pixel. Throws rather than guessing.
    const addressing = ({ allowNone = false } = {}) => {
      const a = {};
      if (elementToken) a.element_token = elementToken;
      else if (elementIndex != null && !Number.isNaN(elementIndex)) {
        if (!snapshotId) throw new Error('elementIndex requires snapshotId (the driver fails closed on bare indices). Prefer elementToken from computer-observe.');
        a.element_index = elementIndex;
        a.snapshot_id = snapshotId;
        if (windowId != null) a.window_id = windowId;
      } else if (x != null && y != null) { a.x = x; a.y = y; }
      else if (!allowNone) throw new Error('Provide elementToken (preferred), elementIndex+snapshotId, or x+y.');
      return a;
    };
    const base = () => {
      const b = {};
      if (pid != null) b.pid = pid;
      if (session) b.session = session;
      if (scope) b.scope = scope;
      return b;
    };

    const finish = (o, extra = {}) => ({
      success: o.ok,
      dispatched: o.ok,
      action,
      target: pid != null ? { pid, windowId } : null,
      session: session || undefined,
      elementToken: elementToken || undefined,
      elementIndex: elementIndex ?? undefined,
      // The closed 0.19 action facts. These describe the ACTUATOR, not whether
      // the user's task succeeded — always verify from fresh state.
      effect: o.effect,
      route: o.route,
      deliveryMode: o.deliveryMode,
      // `success` means DISPATCHED WITHOUT REFUSAL. `proven` means the driver
      // has actual evidence the effect occurred. They are different questions
      // and conflating them is how a silent no-op gets reported as done:
      // measured on Win11 Notepad, an element-addressed type_text returns
      // effect:"unverifiable" and changes nothing at all. Verify anything that
      // matters (computer-observe mode="verify").
      proven: o.effect === 'confirmed',
      refused: o.refused,
      code: o.code,
      escalation: o.escalation,
      escalationReason: o.escalationReason,
      result: o.json,
      raw: o.raw,
      summary: o.summary,
      error: o.ok ? null : o.summary,
      hint: this.hintFor(o, action),
      ...extra,
    });

    try {
      switch (action) {
        case 'click':
        case 'double_click':
        case 'right_click': {
          const tool = action === 'double_click' ? 'double_click' : action === 'right_click' ? 'right_click' : 'click';
          const arg = { ...base(), ...addressing() };
          if (deliveryMode) arg.delivery_mode = deliveryMode;
          return finish(await callTool(tool, arg, { timeoutMs: 30000 }));
        }

        case 'type': {
          if (!text) return { success: false, error: 'action="type" requires text.' };
          const arg = { ...base(), text, ...addressing({ allowNone: true }) };
          // window_id disambiguates when a pid owns several windows — without
          // it the driver refuses with `ambiguous_window_target` (measured).
          if (windowId != null && arg.element_token == null) arg.window_id = windowId;
          if (deliveryMode) arg.delivery_mode = deliveryMode;
          return finish(await callTool('type_text', arg, { timeoutMs: 45000 }));
        }

        // THE VALUEPATTERN WORKAROUND. Some editors (Win11 Store Notepad's text
        // area is the reference case) implement NO UIA ValuePattern, so
        // type_text cannot take the accessibility route and falls back to
        // synthetic events that need foreground focus. Measured on 0.19.3:
        // that combination is unfixable through type_text. But the clipboard is
        // a system service every editor honours, so writing the text and
        // sending Ctrl+V reaches those surfaces with no focus steal.
        // Cost: it replaces the user's clipboard. We say so rather than hide it.
        case 'paste_text': {
          if (!text) return { success: false, error: 'action="paste_text" requires text.' };
          const prior = await clipboardRead({ includeText: true, session });
          const priorText = prior.json?.text ?? null;
          const w = await clipboardWrite({ text, session });
          if (!w.ok) return finish(w, { clipboardRestored: false });
          const arg = { ...base(), keys: ['ctrl', 'v'] };
          if (windowId != null) arg.window_id = windowId;
          if (x != null && y != null) { arg.x = x; arg.y = y; }
          if (deliveryMode) arg.delivery_mode = deliveryMode;
          const o = await callTool('hotkey', arg, { timeoutMs: 30000 });
          let restored = false;
          if (asBool(params?.restoreClipboard) && priorText != null) {
            const rb = await clipboardWrite({ text: priorText, session });
            restored = rb.ok;
          }
          return finish(o, {
            pastedChars: text.length,
            clipboardReplaced: true,
            clipboardRestored: restored,
            note: restored
              ? 'Clipboard was restored to its previous text.'
              : 'Your clipboard now holds the pasted text. Pass restoreClipboard=true to put the old contents back.',
          });
        }

        case 'press_key': {
          if (!text) return { success: false, error: 'action="press_key" requires text = a key name (return, tab, escape, up, down, f5, a, 1...). Use action="hotkey" for combinations.' };
          const arg = { ...base(), key: text };
          if (windowId != null) arg.window_id = windowId;
          const addr = addressing({ allowNone: true });
          if (addr.element_token) arg.element_token = addr.element_token;
          else if (addr.x != null) { arg.x = addr.x; arg.y = addr.y; }
          if (Array.isArray(params?.modifiers) && params.modifiers.length) arg.modifiers = params.modifiers;
          if (deliveryMode) arg.delivery_mode = deliveryMode;
          return finish(await callTool('press_key', arg, { timeoutMs: 30000 }));
        }

        case 'hotkey': {
          const keys = Array.isArray(params?.keys) && params.keys.length
            ? params.keys.map((k) => String(k).trim()).filter(Boolean)
            : String(text || '').split(/[+,\s]+/).map((k) => k.trim()).filter(Boolean);
          if (keys.length < 2) return { success: false, error: 'action="hotkey" requires at least two keys, e.g. text="ctrl+s".' };
          const arg = { ...base(), keys };
          if (windowId != null) arg.window_id = windowId;
          if (x != null && y != null) { arg.x = x; arg.y = y; }
          if (deliveryMode) arg.delivery_mode = deliveryMode;
          return finish(await callTool('hotkey', arg, { timeoutMs: 30000 }));
        }

        case 'scroll': {
          if (!['up', 'down', 'left', 'right'].includes(direction)) {
            return { success: false, error: 'action="scroll" requires direction up|down|left|right.' };
          }
          const arg = { ...base(), direction, amount };
          if (params?.by === 'page') arg.by = 'page';
          if (windowId != null) arg.window_id = windowId;
          if (x != null && y != null) { arg.x = x; arg.y = y; }
          if (deliveryMode) arg.delivery_mode = deliveryMode;
          return finish(await callTool('scroll', arg, { timeoutMs: 30000 }));
        }

        case 'set_value': {
          if (!value && !text) return { success: false, error: 'action="set_value" requires value.' };
          if (pid == null) return { success: false, error: 'action="set_value" requires pid.' };
          return finish(await callTool('set_value', { ...base(), value: value || text, ...addressing() }, { timeoutMs: 30000 }));
        }

        case 'drag': {
          if (pid == null || x == null || y == null || x2 == null || y2 == null) {
            return { success: false, error: 'action="drag" requires pid, x, y (start) and x2, y2 (end) in window-local screenshot pixels.' };
          }
          const arg = { ...base(), from_x: x, from_y: y, to_x: x2, to_y: y2 };
          if (windowId != null) arg.window_id = windowId;
          if (deliveryMode) arg.delivery_mode = deliveryMode;
          return finish(await callTool('drag', arg, { timeoutMs: 30000 }));
        }

        // Native menu path — resolved one live level at a time through the
        // accessibility API. Fails closed on missing/ambiguous/disabled
        // segments and NEVER falls back to pixels.
        case 'invoke_menu': {
          const menuPath = Array.isArray(params?.menuPath) && params.menuPath.length
            ? params.menuPath
            : String(text || '').split('>').map((s) => s.trim()).filter(Boolean);
          if (!menuPath.length) return { success: false, error: 'action="invoke_menu" requires menuPath (array) or text like "File > Save As". Labels are case-sensitive after trimming.' };
          if (pid == null || windowId == null) return { success: false, error: 'action="invoke_menu" requires pid and windowId.' };
          return finish(await invokeMenu(pid, windowId, menuPath, { session }), { menuPath });
        }

        case 'clipboard_write': {
          if (!text) return { success: false, error: 'action="clipboard_write" requires text.' };
          return finish(await clipboardWrite({ text, session }));
        }

        case 'clipboard_read': {
          const o = await clipboardRead({ includeText: true, session });
          return finish(o, { clipboardText: o.json?.text ?? null, clipboardTypes: o.json?.types ?? null });
        }

        case 'set_window_frame': {
          if (pid == null || windowId == null || x == null || y == null || width == null || height == null) {
            return { success: false, error: 'action="set_window_frame" requires pid, windowId, x, y, width, height (desktop coordinates from computer-windows bounds).' };
          }
          return finish(await setWindowFrame(pid, windowId, x, y, width, height, { session }));
        }

        // LAUNCH. start_minimized is deliberately NOT exposed: measured on
        // 0.19.3, a minimized window returns an EMPTY accessibility tree
        // (degraded, 0 elements) and screenshot capture fails outright, so an
        // observe→act loop is blind against it. SW_SHOWNOACTIVATE (the default)
        // already gives a visible-but-never-focused window, which is what
        // "runs in the background" actually needs.
        case 'launch_app': {
          if (!text) return { success: false, error: 'action="launch_app" requires text — an app name, an AUMID like "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", a full .exe path, or a URL.' };
          const arg = {};
          if (session) arg.session = session;
          if (/^https?:\/\//i.test(text)) arg.urls = [text];
          else if (text.includes('!')) arg.aumid = text;
          else if (/[\\/]/.test(text) || /\.exe$/i.test(text)) arg.path = text;
          else arg.name = text;
          const o = await callTool('launch_app', arg, { timeoutMs: 60000 });
          const j = o.json || {};
          return finish(o, {
            launchedPid: j.pid ?? null,
            windows: Array.isArray(j.windows) ? j.windows.map((w) => ({ windowId: w.window_id, title: w.title, bounds: w.bounds, onScreen: w.is_on_screen })) : [],
          });
        }

        case 'bring_to_front': {
          if (pid == null) return { success: false, error: 'action="bring_to_front" requires pid.' };
          const arg = { ...base() };
          if (windowId != null) arg.window_id = windowId;
          const o = await callTool('bring_to_front', arg, { timeoutMs: 20000 });
          return finish(o, { landedOnTarget: o.json?.landed_on_target ?? null });
        }

        case 'kill_app': {
          if (pid == null) return { success: false, error: 'action="kill_app" requires pid.' };
          return finish(await callTool('kill_app', { ...base() }, { timeoutMs: 20000 }));
        }

        default:
          return { success: false, error: `Unknown action: ${action}. Valid: click, double_click, right_click, type, paste_text, press_key, hotkey, scroll, set_value, drag, invoke_menu, clipboard_read, clipboard_write, set_window_frame, launch_app, bring_to_front, kill_app.` };
      }
    } catch (e) {
      return { success: false, action, error: e?.message || String(e) };
    }
  }

  /** Turn the driver's own escalation instruction into the caller's next move. */
  hintFor(o, action) {
    // MEASURED against driver 0.19.3: a token from a superseded snapshot comes
    // back as `invalid_element_token`, NOT `stale_element_token`. Keying the
    // hint on the documented name alone left the real refusal with no next
    // move, and the fake driver in the tests hid it by emitting the wrong code.
    if (o.code === 'stale_element_token' || o.code === 'invalid_element_token' || /stale|invalid element/i.test(o.message || '')) {
      return 'The element handle is stale. Take a fresh computer-observe snapshot and retry with the new token — every snapshot of a window replaces the previous one.';
    }
    if (o.code === 'ambiguous_window_target') {
      return 'That pid owns more than one window, so the driver refused rather than guess. Pass windowId explicitly (computer-windows lists them).';
    }
    if (o.code === 'menu_path_unavailable') {
      return 'No menu segment matched. Labels are case-sensitive and must be immediate children; run computer-observe to read the real menu labels first.';
    }
    if (o.code === 'foreign_process_termination_denied') {
      return 'The driver only terminates processes it launched itself. Close the app from its own UI (hotkey alt+f4) or relaunch it through computer-input action="launch_app" if you need ownership.';
    }
    if (o.code === 'desktop_escalation_required') {
      return 'This session is still window-scoped. Exhaust the window ladder first, then computer-session action="escalate" confirm=true — escalation is permanent for that session id.';
    }
    if (o.escalation === 'foreground') {
      return 'The driver says background delivery cannot land here. Retry this SAME action with deliveryMode="foreground" — it briefly fronts the target and restores your previous window afterwards.';
    }
    if (o.escalation === 'pixel' || o.escalation === 'px') {
      return 'The accessibility route could not prove the effect. Re-observe and act by pixel (x/y read off the screenshot) instead of by element.';
    }
    if (o.effect === 'unverifiable') {
      // Measured on the Windows 11 Notepad editor: an element-addressed
      // type_text reports exactly this and inserts NOTHING, while the same
      // text sent to the field's pixel centre lands first time, in the
      // background. So for text entry the escalation is concrete, not vague.
      return (action === 'type' || action === 'set_value')
        ? 'Dispatched, but UNPROVEN — and on XAML/WinUI3/Electron editors an element-addressed write can be a silent no-op. Check with computer-observe mode="verify"; if it did not land, retry as a PIXEL write: same action with x/y at the field\'s centre (read off the screenshot). That reaches the renderer and still needs no foreground.'
        : 'Dispatched, but the driver cannot prove the effect — that is normal for this route and NOT a failure. Confirm with computer-observe mode="verify" rather than assuming either way.';
    }
    if (o.effect === 'suspected_noop') {
      return 'The driver believes nothing changed. Do not repeat the identical action — pick a different element, or escalate delivery.';
    }
    if (o.ok && action !== 'clipboard_read') {
      return 'Re-observe to verify from fresh state; element tokens from before this action are now stale.';
    }
    return null;
  }
}

export default new ComputerInput();
