// computer-observe.js — read-only perception. Cua Driver 0.19.x.
//
// PERCEPTION IS NO LONGER A MODE CHOICE. get_window_state always returns BOTH
// the accessibility tree AND a screenshot; `capture_mode` is deprecated and
// ignored upstream. The old som/ax/vision knob now maps onto include_screenshot
// (a PERF knob, not a modality): ax = tree only (cheap), anything else = both.
// The ax-vs-pixel decision belongs at ACTION time, not here.
//
// Four things this tool can observe:
//   mode="window"  (default) one app window: elements + tokens + tree + shot
//   mode="desktop"           full display, true screen pixels — desktop-scope
//                            sessions only (refused otherwise, by design)
//   mode="zoom"              native-resolution crop, to read small text
//   mode="verify"            DETERMINISTIC predicates — the honest way to ask
//                            "did it actually work?"
//
// Why mode="verify" matters more than it looks: a successful action often
// reports only effect:"unverifiable" because the driver refuses to overclaim.
// Measured on Calculator — a click returned effect:"unverifiable", and a
// verify_state predicate then proved the display read "Display is 7". Asking
// the model to eyeball a screenshot is a guess; this is a measurement.
import BaseAction from '../BaseAction.js';
import { asBool, asInt, resolveDriverPath, snapshotWindow, notInstalledResult, ensureReady, verifyState, desktopState, zoomRegion } from '../../../services/computerUse/driver.js';

const img = (b64, alt, mime = 'image/png') =>
  `<img src="data:${mime};base64,${b64}" alt="${alt}" style="max-width:100%;border-radius:8px;border:1px solid #2a2a3a;" />`;

class ComputerObserve extends BaseAction {
  static schema = {
    "title": "Computer Observe (Window / Desktop / Zoom / Verify)",
    "category": "utility",
    "type": "computer-observe",
    "icon": "image",
    "description": "Read-only perception, four ways. mode=window (default): one app window — structured elements each carrying a per-snapshot element token, plus accessibility-tree markdown, plus a screenshot rendered inline (you always get BOTH; there is no capture mode to pick). mode=verify: DETERMINISTIC postcondition check against real window state — the honest way to ask \"did that actually work?\", because a successful action often reports only effect=unverifiable. mode=zoom: native-resolution crop for reading small text. mode=desktop: full-display capture (desktop-scope sessions only). Element tokens go STALE after the next snapshot of the same window — observe, act, re-observe.",
    "parameters": {
      "mode": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "window",
          "verify",
          "zoom",
          "desktop"
        ],
        "default": "window",
        "description": "window=elements + tree + screenshot; verify=measure predicates against real state (needs expect or expectLabel); zoom=full-resolution crop (needs x1,y1,x2,y2); desktop=whole-screen capture, requires an escalated or desktop-scope session."
      },
      "pid": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "Target process id (from computer-windows). Required for every mode except desktop."
      },
      "windowId": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "Target window id (from computer-windows). Required for every mode except desktop."
      },
      "session": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "Session id from computer-session, so this observation shares the run's cursor and capture policy."
      },
      "expectLabel": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "mode=verify shorthand: passes when some element's label contains this text (e.g. \"Display is 7\"). Covers most checks."
      },
      "expect": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "mode=verify, full form: JSON array of 1-8 predicates AND-ed together, e.g. [{\"element\":{\"selector\":{\"role\":\"Button\",\"label_contains\":\"Save\"},\"enabled\":true}}]. Note element.exists only accepts true — absence cannot be proven."
      },
      "stableSamples": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "default": 1,
        "description": "mode=verify: consecutive satisfied samples required before returning success (1-5). Raise it for UI that flickers mid-update."
      },
      "timeoutMs": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "default": 4000,
        "description": "mode=verify: bounded wait for the predicate to become true (0-10000). 0 takes a single sample."
      },
      "x1": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "mode=zoom: left edge, in the same pixel space as the mode=window screenshot."
      },
      "y1": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "mode=zoom: top edge."
      },
      "x2": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "mode=zoom: right edge. Region max width 500px; 20% padding is added on every side automatically."
      },
      "y2": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "mode=zoom: bottom edge."
      },
      "query": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "mode=window: case-insensitive substring that projects the tree to matching elements plus their ancestors, preserving indices and tokens. Essential for huge Electron/browser trees."
      },
      "maxElements": {
        "type": "number",
        "inputType": "number",
        "required": false,
        "description": "mode=window: cap on UIA nodes walked (default 5000). Lower it for 10k+ element web apps to bound output size."
      },
      "treeOnly": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "false",
          "true"
        ],
        "default": "false",
        "description": "mode=window: skip the screen grab and return the tree only. A PERFORMANCE knob for re-indexing before an element action — not a modality choice."
      },
      "showImage": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "true",
          "false"
        ],
        "default": "true",
        "description": "Render the captured image inline in chat."
      },
      "captureMode": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "som",
          "ax",
          "vision"
        ],
        "description": "DEPRECATED, kept so older calls keep working. The driver always returns tree AND screenshot; only 'ax' still means anything here (maps to treeOnly)."
      }
    },
    "outputs": {
      "success": {
        "type": "boolean",
        "description": "True when the observation succeeded — for mode=verify, true only when the predicates are SATISFIED."
      },
      "mode": {
        "type": "string",
        "description": "Which observation was performed."
      },
      "pid": {
        "type": "number",
        "description": "Observed pid."
      },
      "windowId": {
        "type": "number",
        "description": "Observed window id."
      },
      "snapshotId": {
        "type": "string",
        "description": "Per-snapshot handle (s########). Needed alongside elementIndex; element tokens embed it already."
      },
      "elementCount": {
        "type": "number",
        "description": "Interactive elements returned."
      },
      "totalElementCount": {
        "type": "number",
        "description": "Total elements before query projection / truncation."
      },
      "elementsComplete": {
        "type": "boolean",
        "description": "False when the walk was truncated by maxElements."
      },
      "elements": {
        "type": "array",
        "description": "{ index, token, role, label, value, enabled, selected, frame:{x,y,w,h}, parentIndex, depth }. Pass token to computer-input as elementToken."
      },
      "treeMarkdown": {
        "type": "string",
        "description": "Human-readable accessibility tree with element index markers."
      },
      "hasScreenshot": {
        "type": "boolean",
        "description": "Whether an image was captured."
      },
      "imageHtml": {
        "type": "string",
        "description": "Inline <img> with the capture embedded as a data URL."
      },
      "degraded": {
        "type": "boolean",
        "description": "True when the accessibility walk came back empty — a non-AX surface (Electron, canvas). Act by pixel off the screenshot in the same response."
      },
      "degradedReason": {
        "type": "string",
        "description": "Why the observation was degraded."
      },
      "escalation": {
        "type": "string",
        "description": "The driver's own recommendation when observation was imperfect, usually 'px'."
      },
      "status": {
        "type": "string",
        "description": "mode=verify: satisfied | unsatisfied | unknown. UNKNOWN NEVER IMPLIES SUCCESS."
      },
      "satisfied": {
        "type": "boolean",
        "description": "mode=verify: whether every predicate held."
      },
      "stable": {
        "type": "boolean",
        "description": "mode=verify: whether the result held across the required consecutive samples."
      },
      "predicates": {
        "type": "array",
        "description": "mode=verify: per-predicate { index, status, unknownReason, observed } — observed shows the real element the driver found."
      },
      "samples": {
        "type": "number",
        "description": "mode=verify: samples taken."
      },
      "elapsedMs": {
        "type": "number",
        "description": "mode=verify: time spent measuring."
      },
      "screenSize": {
        "type": "object",
        "description": "mode=desktop: true screen size, so screen-absolute pixel picks land exactly."
      },
      "region": {
        "type": "object",
        "description": "mode=zoom: the region that was cropped."
      },
      "warning": {
        "type": "string",
        "description": "Set when the window is minimized (unobservable) or the surface is degraded."
      },
      "hint": {
        "type": "string",
        "description": "Suggested next step."
      },
      "bootstrap": {
        "type": "array",
        "description": "Self-heal steps run to bring the daemon up."
      }
    }
  };

  constructor() { super('computer-observe'); }

  async execute(params) {
    const legacyCapture = String(params?.captureMode || '');
    const mode = ['window', 'desktop', 'zoom', 'verify'].includes(String(params?.mode)) ? String(params.mode) : 'window';
    const pid = params?.pid != null && params?.pid !== '' ? Number.parseInt(params.pid, 10) : null;
    const windowId = params?.windowId != null && params?.windowId !== '' ? Number.parseInt(params.windowId, 10) : null;
    const session = String(params?.session || '').trim() || null;
    const showImage = params?.showImage == null ? true : asBool(params.showImage);
    const query = String(params?.query || '').trim() || null;
    const maxElements = params?.maxElements != null && params?.maxElements !== '' ? asInt(params.maxElements, 5000, 1, 20000) : null;

    const resolved = resolveDriverPath();
    if (!resolved.found && !resolved.onPath) return notInstalledResult();
    const boot = await ensureReady({ allowInstall: false });
    if (!boot.ready) return { ...notInstalledResult(), bootstrap: boot.steps };

    try {
      // ── DESKTOP ────────────────────────────────────────────────────────────
      if (mode === 'desktop') {
        const d = await desktopState({ session });
        if (!d.ok) {
          return {
            success: false, mode,
            code: d.code,
            error: d.code === 'desktop_escalation_required'
              ? 'Desktop capture is locked for this session. That is the driver\'s auto-scope policy, not a bug: exhaust the window ladder first, then run computer-session action="escalate" confirm=true (permanent for that session id).'
              : `get_desktop_state failed${d.code ? ` (${d.code})` : ''}.`,
            hint: 'For one app, mode="window" works without any escalation and is strictly better — it gives you addressable elements, not just pixels.',
            bootstrap: boot.steps,
          };
        }
        return {
          success: true, mode,
          effectiveScope: d.effectiveScope,
          screenSize: d.screenSize,
          hasScreenshot: true,
          imageHtml: showImage ? img(d.screenshotB64, 'Full desktop capture') : null,
          hint: 'Desktop scope has no element tree. Act with screen-absolute pixels: computer-input scope="desktop" x/y (no pid/windowId).',
          bootstrap: boot.steps,
        };
      }

      // ── ZOOM ───────────────────────────────────────────────────────────────
      if (mode === 'zoom') {
        if (pid == null || windowId == null) return { success: false, error: 'mode="zoom" requires pid and windowId.' };
        const [x1, y1, x2, y2] = [params?.x1, params?.y1, params?.x2, params?.y2].map((v) => Number(v));
        if ([x1, y1, x2, y2].some((v) => Number.isNaN(v))) {
          return { success: false, error: 'mode="zoom" requires x1, y1, x2, y2 in the same pixel space as the mode="window" screenshot. Max region width 500px; 20% padding is added automatically.' };
        }
        const z = await zoomRegion(pid, windowId, x1, y1, x2, y2);
        if (!z.ok) {
          return {
            success: false, mode, error: z.error,
            hint: /minimi[sz]ed/i.test(z.error || '')
              ? 'That window is minimized, so it has no rendered content to crop — GDI returns an all-black bitmap and the driver refuses rather than hand you a black image. Restore it first (computer-input action="bring_to_front").'
              : null,
          };
        }
        return {
          success: true, mode, pid, windowId,
          region: { x1, y1, x2, y2 },
          width: z.width, height: z.height, mime: z.mime,
          imageHtml: showImage && z.b64 ? img(z.b64, `Zoom ${x1},${y1}-${x2},${y2}`, z.mime) : null,
          hint: 'Coordinates you read off this crop can be used directly — pass fromZoom-style x/y back through a pixel click only after re-observing; otherwise use element tokens.',
          bootstrap: boot.steps,
        };
      }

      // ── VERIFY ─────────────────────────────────────────────────────────────
      if (mode === 'verify') {
        if (pid == null || windowId == null) return { success: false, error: 'mode="verify" requires pid and windowId.' };
        let expect = params?.expect;
        if (typeof expect === 'string') { try { expect = JSON.parse(expect); } catch { expect = null; } }
        // Convenience: expectLabel is the 90% case, spelled in one field.
        if (!expect && params?.expectLabel) {
          expect = [{ element: { selector: { label_contains: String(params.expectLabel) }, exists: true } }];
        }
        if (!expect) {
          return {
            success: false,
            error: 'mode="verify" requires expect (array of predicates) or expectLabel (shorthand for "an element whose label contains this exists").',
            example: '{"expectLabel":"Display is 7"}  or  {"expect":[{"element":{"selector":{"role":"Button","label_contains":"Save"},"enabled":true}}]}',
          };
        }
        const v = await verifyState(pid, windowId, expect, {
          session,
          timeoutMs: asInt(params?.timeoutMs, 4000, 0, 10000),
          stableSamples: asInt(params?.stableSamples, 1, 1, 5),
        });
        return {
          success: v.satisfied,
          mode, pid, windowId,
          status: v.status,
          satisfied: v.satisfied,
          stable: v.stable,
          samples: v.samples,
          elapsedMs: v.elapsedMs,
          predicates: v.predicates,
          code: v.code,
          // "unknown" is deliberately NOT success. The driver is conservative:
          // absence cannot be proven unless the search domain is exhaustive.
          note: v.satisfied
            ? '✅ Verified against real window state.'
            : v.status === 'unknown'
              ? '⚠️ UNKNOWN — the driver could not evaluate this, which never implies success. Common causes: the window is minimized (no trusted tree), or the selector matches nothing observable.'
              : '❌ Not satisfied.',
          bootstrap: boot.steps,
        };
      }

      // ── WINDOW (default) ───────────────────────────────────────────────────
      if (pid == null || windowId == null) {
        return { success: false, error: 'pid and windowId are required (get them from computer-windows).' };
      }
      const cheap = legacyCapture === 'ax' || asBool(params?.treeOnly);
      const snap = await snapshotWindow(pid, windowId, {
        includeScreenshot: !cheap,
        query,
        maxElements: maxElements || null,
        session,
      });
      if (!snap.ok) {
        if (snap.error === 'not_installed') return notInstalledResult();
        return { success: false, error: snap.error };
      }

      const minimizedTrap = snap.degraded && snap.totalElementCount === 0 && !snap.screenshotB64;

      return {
        success: true,
        mode: 'window',
        pid,
        windowId,
        session: session || undefined,
        snapshotId: snap.snapshotId,
        elementCount: snap.elements.length,
        totalElementCount: snap.totalElementCount,
        elementsComplete: snap.elementsComplete,
        elements: snap.elements,
        treeMarkdown: snap.treeMarkdown,
        hasScreenshot: !!snap.screenshotB64,
        degraded: snap.degraded,
        degradedReason: snap.degradedReason,
        escalation: snap.escalation,
        escalationReason: snap.escalationReason,
        screenshotError: snap.screenshotError,
        imageHtml: showImage && snap.screenshotB64 && snap.screenshotB64.length > 100
          ? img(snap.screenshotB64, `Cua window capture (pid ${pid}, window ${windowId})`)
          : null,
        bootstrap: boot.steps,
        warning: minimizedTrap
          ? 'This window appears MINIMIZED: the accessibility walk returned zero elements AND screenshot capture failed. A minimized window cannot be observed at all — restore it with computer-input action="bring_to_front" (it does not need to be focused, only rendered).'
          : snap.degraded
            ? `Degraded observation${snap.degradedReason ? ` (${snap.degradedReason})` : ''} — the accessibility tree is empty, so this is a non-AX surface. Act by pixel off the screenshot in this response.`
            : null,
        hint: 'To act: pass an element\'s `token` to computer-input (action="click" elementToken=... confirm=true), then confirm with mode="verify". Tokens go stale after the next snapshot of this window — observe, act, re-observe.',
      };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }
}

export default new ComputerObserve();
