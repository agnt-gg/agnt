// cua-act.js — high-level autonomous loop scaffold.
import { asBool, asInt, resolveDriverPath, runDriver, parseDriverJson, notInstalledResult, ensureReady } from './lib/driver.js';

function normalizeState(state) {
  const treeMarkdown = state.tree_markdown || state.markdown || '';
  const rawElements = state.elements || state.tree || state.ax || [];
  const structured = (Array.isArray(rawElements) ? rawElements : []).map((el, i) => ({
    index: el.element_index ?? el.index ?? i,
    role: el.role ?? el.type ?? '',
    name: el.name ?? el.label ?? el.title ?? '',
    value: el.value ?? '',
  })).filter((e) => e.role || e.name);
  const markdownElements = [...String(treeMarkdown).matchAll(/\[element_index\s+(\d+)\]([^\n]*)/gi)]
    .map((m) => ({ index: Number(m[1]), role: 'element', name: m[2].trim(), value: '' }));
  return {
    elements: structured.length ? structured : markdownElements,
    treeMarkdown,
    screenshotB64: state.screenshot || state.image || state.screenshot_base64 || state.screenshot_png_b64 || null,
  };
}

class CuaAct {
  constructor() { this.name = 'cua-act'; }

  async execute(params) {
    const goal = String(params?.goal || '').trim();
    const pid = Number.parseInt(params?.pid, 10);
    const windowId = Number.parseInt(params?.windowId, 10);
    const maxSteps = asInt(params?.maxSteps, 8, 1, 50);
    const dryRun = params?.dryRun == null ? true : asBool(params.dryRun);
    const confirm = asBool(params?.confirm);

    if (!goal) return { success: false, error: 'goal is required.' };
    if (Number.isNaN(pid) || Number.isNaN(windowId)) {
      return { success: false, error: 'pid and windowId are required (from cua-windows).' };
    }

    const resolved = resolveDriverPath();
    if (!resolved.found && !resolved.onPath) return notInstalledResult();

    const boot = await ensureReady({ allowInstall: false });
    if (!boot.ready) return { ...notInstalledResult(), bootstrap: boot.steps };

    try {
      const r = await runDriver('get_window_state', { pid, window_id: windowId, capture_mode: 'som' }, { timeoutMs: 20000 });
      if (r.error === 'not_installed') return notInstalledResult();
      const state = parseDriverJson(r.stdout) || {};
      const { elements, treeMarkdown, screenshotB64 } = normalizeState(state);

      let imageHtml = null;
      if (typeof screenshotB64 === 'string' && screenshotB64.length > 100) {
        const src = screenshotB64.startsWith('data:') ? screenshotB64 : `data:image/png;base64,${screenshotB64}`;
        imageHtml = `<img src="${src}" alt="Cua act observe (goal: ${goal.slice(0, 60)})" style="max-width:100%;border-radius:8px;border:1px solid #2a2a3a;" />`;
      }

      const planEnvelope = {
        goal,
        target: { pid, windowId },
        maxSteps,
        mode: dryRun ? 'dry-run (no input will be dispatched)' : (confirm ? 'live (input allowed via cua-input)' : 'blocked (set confirm=true to allow live input)'),
        elementsAvailable: elements.length,
        instructionsForAgent: [
          '1. Examine `elements`, `treeMarkdown`, and the screenshot in imageHtml.',
          '2. Decide the SINGLE next action that best advances the goal.',
          '3. If live mode, call cua-input (action=click+elementIndex, or type/hotkey) with confirm=true.',
          '4. Call cua-act again with the same goal to observe the new state and verify progress.',
          '5. Stop when the goal is visibly achieved or maxSteps is reached.',
        ],
      };

      return {
        success: true,
        goal,
        pid,
        windowId,
        dryRun,
        canExecute: !dryRun && confirm,
        elementCount: elements.length,
        elements,
        treeMarkdown,
        hasScreenshot: !!screenshotB64,
        imageHtml,
        plan: planEnvelope,
        bootstrap: boot.steps,
        note: dryRun
          ? 'DRY RUN: observed state only, no input dispatched. Review elements + screenshot, then re-run with dryRun=false confirm=true to enable live driving.'
          : (confirm ? 'LIVE: agent may now dispatch input via cua-input, re-observing via cua-act after each step.' : 'BLOCKED: set confirm=true to allow live input.'),
      };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }
}

export default new CuaAct();
