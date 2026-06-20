// cua-windows.js — read-only enumeration of desktop windows.
import { resolveDriverPath, runDriver, parseDriverJson, notInstalledResult, ensureReady } from './lib/driver.js';

class CuaWindows {
  constructor() { this.name = 'cua-windows'; }

  async execute(params) {
    const filter = String(params?.filter || '').trim().toLowerCase();
    const resolved = resolveDriverPath();
    if (!resolved.found && !resolved.onPath) return notInstalledResult();

    // Self-heal: ensure the daemon is up (does NOT auto-install — that stays explicit via cua-setup ensure).
    const boot = await ensureReady({ allowInstall: false });
    if (!boot.ready) return { ...notInstalledResult(), bootstrap: boot.steps };

    try {
      const r = await runDriver('list_windows', {}, { timeoutMs: 15000 });
      if (r.error === 'not_installed') return notInstalledResult();
      if (!r.ok && !r.stdout) {
        return { success: false, error: r.stderr || r.error || 'list_windows failed', raw: r.stdout };
      }

      const parsed = parseDriverJson(r.stdout);
      let windows = Array.isArray(parsed) ? parsed : (parsed?.windows || []);

      windows = windows.map((w) => ({
        pid: w.pid ?? w.process_id ?? null,
        windowId: w.window_id ?? w.windowId ?? w.id ?? null,
        title: w.title ?? w.name ?? '',
        app: w.app ?? w.app_name ?? w.bundle_id ?? w.process ?? '',
        raw: w,
      }));

      if (filter) {
        windows = windows.filter((w) =>
          `${w.title}`.toLowerCase().includes(filter) || `${w.app}`.toLowerCase().includes(filter));
      }

      const empty = windows.length === 0;
      return {
        success: true,
        count: windows.length,
        windows,
        bootstrap: boot.steps,
        warning: empty
          ? 'No windows returned. On Windows this usually means the driver is in Session 0 (non-interactive). Run cua-setup action="doctor" to confirm, and ensure AGNT runs in your interactive logon.'
          : null,
        hint: empty ? null : 'Use a window\'s pid + windowId with cua-observe to read its elements, then cua-input/cua-act to drive it.',
      };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }
}

export default new CuaWindows();
