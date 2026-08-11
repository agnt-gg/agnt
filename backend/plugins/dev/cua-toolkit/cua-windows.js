// cua-windows.js — read-only discovery of what is on this machine.
//
// Two different questions, two different driver tools, one place to ask:
//   include="windows" (default) — list_windows: every OPEN top-level window,
//        with bounds and on-screen state. The answer to "what can I drive?"
//   include="apps"              — list_apps: every app INSTALLED as well as
//        running, with a launch_path you can hand straight to
//        cua-input action="launch_app". The answer to "is X installed?"
//   include="both"
import { resolveDriverPath, runDriver, parseDriverJson, notInstalledResult, ensureReady, listApps } from './lib/driver.js';

class CuaWindows {
  constructor() { this.name = 'cua-windows'; }

  async execute(params) {
    const filter = String(params?.filter || '').trim().toLowerCase();
    const include = ['windows', 'apps', 'both'].includes(String(params?.include)) ? String(params.include) : 'windows';
    const runningOnly = String(params?.runningOnly ?? 'true') !== 'false';

    const resolved = resolveDriverPath();
    if (!resolved.found && !resolved.onPath) return notInstalledResult();

    // Self-heal: bring the daemon up. Auto-INSTALL stays explicit via cua-setup.
    const boot = await ensureReady({ allowInstall: false });
    if (!boot.ready) return { ...notInstalledResult(), bootstrap: boot.steps };

    const matches = (...fields) => !filter || fields.some((f) => String(f || '').toLowerCase().includes(filter));

    try {
      const out = { success: true, bootstrap: boot.steps };

      if (include === 'windows' || include === 'both') {
        const r = await runDriver('list_windows', {}, { timeoutMs: 20000 });
        if (r.error === 'not_installed') return notInstalledResult();
        if (!r.ok && !r.stdout) {
          return { success: false, error: r.stderr || r.error || 'list_windows failed', raw: r.stdout };
        }
        const parsed = parseDriverJson(r.stdout);
        const rows = Array.isArray(parsed) ? parsed : (parsed?.windows || parsed?._legacy_windows || []);
        let windows = rows.map((w) => ({
          pid: w.pid ?? w.process_id ?? null,
          windowId: w.window_id ?? w.windowId ?? w.id ?? null,
          title: w.title ?? w.name ?? '',
          app: w.app_name ?? w.app ?? w.bundle_id ?? w.process ?? '',
          bounds: w.bounds ?? null,
          onScreen: w.is_on_screen ?? null,
          zIndex: w.z_index ?? null,
        })).filter((w) => matches(w.title, w.app));
        out.count = windows.length;
        out.windows = windows;
        // A window that is off-screen is usually minimized — and a minimized
        // window CANNOT be observed (empty tree, screenshot capture fails).
        // Surfacing it here saves a wasted observe round-trip.
        out.minimizedCount = windows.filter((w) => w.onScreen === false).length;
        out.warning = windows.length === 0
          ? 'No windows returned. On Windows this usually means the driver is in Session 0 (non-interactive). Run cua-setup action="doctor" to confirm — window tools only work in an interactive logon session.'
          : null;
      }

      if (include === 'apps' || include === 'both') {
        const a = await listApps();
        let apps = (a.apps || []).map((p) => ({
          name: p.name ?? '',
          pid: p.running ? (p.pid ?? null) : null,
          running: p.running === true,
          active: p.active === true,
          kind: p.kind ?? null,
          launchPath: p.launch_path ?? p.bundle_id ?? null,
          lastUsed: p.last_used ?? null,
        })).filter((p) => matches(p.name, p.launchPath));
        if (runningOnly && include === 'apps') apps = apps.filter((p) => p.running);
        out.appCount = apps.length;
        out.apps = apps;
        out.runningAppCount = apps.filter((p) => p.running).length;
      }

      out.hint = include === 'apps'
        ? 'Pass an app\'s launchPath (or name/AUMID) to cua-input action="launch_app". Set runningOnly=false to see everything installed, not just what is open.'
        : 'Use a window\'s pid + windowId with cua-observe, then cua-input to drive it — or hand both to cua-act with a natural-language goal.';
      return out;
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }
}

export default new CuaWindows();
