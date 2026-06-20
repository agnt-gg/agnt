// cua-input.js — low-level primitive input: click / type / hotkey / launch_app.
import { asBool, resolveDriverPath, runDriver, parseDriverJson, notInstalledResult } from './lib/driver.js';

class CuaInput {
  constructor() { this.name = 'cua-input'; }

  async execute(params) {
    const action = String(params?.action || 'click').toLowerCase();
    const confirm = asBool(params?.confirm);
    const pid = params?.pid != null ? Number.parseInt(params.pid, 10) : null;
    const windowId = params?.windowId != null ? Number.parseInt(params.windowId, 10) : null;
    const elementIndex = params?.elementIndex != null ? Number.parseInt(params.elementIndex, 10) : null;
    const text = params?.text != null ? String(params.text) : '';

    if (!confirm) {
      return { success: false, dispatched: false, error: 'Refusing to dispatch input to your desktop without confirm=true.' };
    }

    const resolved = resolveDriverPath();
    if (!resolved.found && !resolved.onPath) return notInstalledResult();

    // Validate per-action requirements.
    const needsTarget = ['click', 'type', 'hotkey'];
    if (needsTarget.includes(action) && (Number.isNaN(pid) || Number.isNaN(windowId) || pid == null || windowId == null)) {
      return { success: false, error: `action="${action}" requires pid and windowId.` };
    }

    try {
      let sub, arg;
      switch (action) {
        case 'click':
          if (elementIndex == null || Number.isNaN(elementIndex)) {
            return { success: false, error: 'action="click" requires elementIndex (from cua-observe).' };
          }
          sub = 'click';
          arg = { pid, window_id: windowId, element_index: elementIndex };
          break;
        case 'type':
          if (!text) return { success: false, error: 'action="type" requires text.' };
          sub = 'type_text';
          arg = { pid, window_id: windowId, text };
          break;
        case 'hotkey':
          if (!text) return { success: false, error: 'action="hotkey" requires text (e.g. "ctrl+s").' };
          sub = 'hotkey';
          arg = { pid, window_id: windowId, keys: text.split(/[+, ]+/).map(k => k.trim()).filter(Boolean) };
          break;
        case 'launch_app':
          if (!text) return { success: false, error: 'action="launch_app" requires text (app name or bundle id).' };
          sub = 'launch_app';
          // Cua takes bundle_id on macOS; pass through both for cross-platform best-effort.
          arg = { bundle_id: text, app: text, name: text };
          break;
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }

      const r = await runDriver(sub, arg, { timeoutMs: 20000 });
      if (r.error === 'not_installed') return notInstalledResult();
      const result = parseDriverJson(r.stdout);
      return {
        success: r.ok,
        dispatched: r.ok,
        action,
        target: needsTarget.includes(action) ? { pid, windowId } : null,
        elementIndex: action === 'click' ? elementIndex : undefined,
        text: ['type', 'hotkey', 'launch_app'].includes(action) ? text : undefined,
        result,
        raw: r.stdout || r.stderr,
        error: r.ok ? null : (r.stderr || r.error),
        hint: r.ok ? 'Re-run cua-observe to see the updated window state and verify the effect.' : null,
      };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }
}

export default new CuaInput();
