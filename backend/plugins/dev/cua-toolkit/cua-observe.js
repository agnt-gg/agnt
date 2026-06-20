// cua-observe.js — read-only window state: accessibility tree + optional screenshot.
import { asBool, resolveDriverPath, runDriver, parseDriverJson, notInstalledResult, ensureReady } from './lib/driver.js';

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

class CuaObserve {
  constructor() { this.name = 'cua-observe'; }

  async execute(params) {
    const pid = Number.parseInt(params?.pid, 10);
    const windowId = Number.parseInt(params?.windowId, 10);
    const captureMode = ['som', 'ax', 'vision'].includes(String(params?.captureMode)) ? String(params.captureMode) : 'som';
    const showImage = params?.showImage == null ? true : asBool(params.showImage);

    if (Number.isNaN(pid) || Number.isNaN(windowId)) {
      return { success: false, error: 'pid and windowId are required (get them from cua-windows).' };
    }

    const resolved = resolveDriverPath();
    if (!resolved.found && !resolved.onPath) return notInstalledResult();

    const boot = await ensureReady({ allowInstall: false });
    if (!boot.ready) return { ...notInstalledResult(), bootstrap: boot.steps };

    try {
      const arg = { pid, window_id: windowId, capture_mode: captureMode };
      const r = await runDriver('get_window_state', arg, { timeoutMs: 20000 });
      if (r.error === 'not_installed') return notInstalledResult();
      if (!r.ok && !r.stdout) return { success: false, error: r.stderr || r.error || 'get_window_state failed' };

      const state = parseDriverJson(r.stdout) || {};
      const { elements, treeMarkdown, screenshotB64 } = normalizeState(state);

      let imageHtml = null;
      if (showImage && captureMode !== 'ax' && typeof screenshotB64 === 'string' && screenshotB64.length > 100) {
        const src = screenshotB64.startsWith('data:') ? screenshotB64 : `data:image/png;base64,${screenshotB64}`;
        imageHtml = `<img src="${src}" alt="Cua window capture (pid ${pid}, window ${windowId})" style="max-width:100%;border-radius:8px;border:1px solid #2a2a3a;" />`;
      }

      return {
        success: true,
        pid,
        windowId,
        captureMode,
        elementCount: elements.length,
        elements,
        treeMarkdown,
        hasScreenshot: !!screenshotB64,
        imageHtml,
        bootstrap: boot.steps,
        hint: 'To act: pick an element by its `index` and call cua-input action="click" elementIndex=<index> (confirm=true), or use cua-act with a natural-language goal.',
        rawKeys: Object.keys(state),
      };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }
}

export default new CuaObserve();
