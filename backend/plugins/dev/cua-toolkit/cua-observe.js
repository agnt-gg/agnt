// cua-observe.js — read-only perception. Cua Driver 0.19.x.
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
import { asBool, asInt, resolveDriverPath, snapshotWindow, notInstalledResult, ensureReady, verifyState, desktopState, zoomRegion } from './lib/driver.js';

const img = (b64, alt, mime = 'image/png') =>
  `<img src="data:${mime};base64,${b64}" alt="${alt}" style="max-width:100%;border-radius:8px;border:1px solid #2a2a3a;" />`;

class CuaObserve {
  constructor() { this.name = 'cua-observe'; }

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
              ? 'Desktop capture is locked for this session. That is the driver\'s auto-scope policy, not a bug: exhaust the window ladder first, then run cua-session action="escalate" confirm=true (permanent for that session id).'
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
          hint: 'Desktop scope has no element tree. Act with screen-absolute pixels: cua-input scope="desktop" x/y (no pid/windowId).',
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
              ? 'That window is minimized, so it has no rendered content to crop — GDI returns an all-black bitmap and the driver refuses rather than hand you a black image. Restore it first (cua-input action="bring_to_front").'
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
        return { success: false, error: 'pid and windowId are required (get them from cua-windows).' };
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
          ? 'This window appears MINIMIZED: the accessibility walk returned zero elements AND screenshot capture failed. A minimized window cannot be observed at all — restore it with cua-input action="bring_to_front" (it does not need to be focused, only rendered).'
          : snap.degraded
            ? `Degraded observation${snap.degradedReason ? ` (${snap.degradedReason})` : ''} — the accessibility tree is empty, so this is a non-AX surface. Act by pixel off the screenshot in this response.`
            : null,
        hint: 'To act: pass an element\'s `token` to cua-input (action="click" elementToken=... confirm=true), then confirm with mode="verify". Tokens go stale after the next snapshot of this window — observe, act, re-observe.',
      };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }
}

export default new CuaObserve();
