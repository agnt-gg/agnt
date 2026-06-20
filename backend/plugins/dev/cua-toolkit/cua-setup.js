// cua-setup.js — install, verify, and manage the Cua Driver daemon.
import {
  asBool, resolveDriverPath, runDriver, detectSession0,
  ensureReady, isInstalled, installDriver, startDaemon, isDaemonRunning,
} from './lib/driver.js';

class CuaSetup {
  constructor() { this.name = 'cua-setup'; }

  async execute(params) {
    const action = String(params?.action || 'status').toLowerCase();
    const confirm = asBool(params?.confirm);
    const resolved = resolveDriverPath();

    try {
      switch (action) {
        // ── one-call bootstrap: install (if needed) → daemon → doctor ──────────
        case 'ensure': {
          if (!confirm) return { success: false, error: 'Refusing to auto-bootstrap (may install software) without confirm=true.' };
          const boot = await ensureReady({ allowInstall: true });
          if (!boot.ready) {
            return { success: false, installed: boot.installed, error: boot.error, steps: boot.steps, installerTail: boot.installerTail };
          }
          // Health probe + Session-0 check so the single call reports true readiness.
          const doc = await runDriver('doctor', null, { timeoutMs: 20000 });
          const docText = `${doc.stdout}\n${doc.stderr}`;
          const session0 = detectSession0(docText);
          const ver = await runDriver('--version', null, { timeoutMs: 8000 });
          return {
            success: !session0,
            installed: true,
            version: ver.ok ? ver.stdout.trim() : null,
            daemonRunning: boot.daemonRunning,
            session0Warning: session0,
            steps: boot.steps,
            report: doc.stdout || doc.stderr,
            hint: session0
              ? '⚠️ Ready EXCEPT Session 0 — window tools will be empty. Run AGNT from an interactive logon (or register cua-driver autostart).'
              : '✅ Cua is installed, daemon up, interactive session OK. Call cua-windows to see your desktop.',
          };
        }

        case 'version': {
          if (!resolved.found && !resolved.onPath) return { success: false, installed: false, error: 'cua-driver not found.' };
          const r = await runDriver('--version');
          return { success: r.ok, installed: r.ok, version: (r.stdout || '').trim() || null, raw: r.stdout, error: r.ok ? null : (r.stderr || r.error) };
        }

        case 'status': {
          const installed = isInstalled();
          const ver = installed ? await runDriver('--version', null, { timeoutMs: 8000 }) : { ok: false, stdout: '' };
          let daemon = null;
          if (installed) {
            const running = await isDaemonRunning();
            daemon = { running };
          }
          return {
            success: true,
            installed,
            binaryPath: resolved.path,
            version: ver.ok ? ver.stdout.trim() : null,
            daemon,
            hint: installed
              ? (daemon?.running ? 'Installed and daemon running. Ready to observe/act.' : 'Installed but daemon down. Tools will auto-start it, or run action="serve".')
              : 'Not installed. Run action="ensure" (confirm=true) for one-shot install+start.',
          };
        }

        case 'doctor': {
          const r = await runDriver('doctor', null, { timeoutMs: 20000 });
          const text = `${r.stdout}\n${r.stderr}`;
          const session0 = detectSession0(text);
          return {
            success: r.ok || !!r.stdout,
            installed: r.ok || !!r.stdout,
            report: r.stdout || r.stderr,
            session0Warning: session0,
            session0Hint: session0
              ? '⚠️ Driver is in Session 0 (no interactive desktop). Window tools will return EMPTY. Run AGNT from an interactive logon, or register the autostart task: cua-driver autostart enable && cua-driver autostart kick'
              : null,
            error: r.ok ? null : (r.error === 'not_installed' ? 'Not installed.' : null),
          };
        }

        case 'install': {
          if (!confirm) return { success: false, error: 'Refusing to run installer without confirm=true.' };
          const ins = await installDriver();
          const ok = isInstalled();
          const ver = ok ? await runDriver('--version', null, { timeoutMs: 10000 }) : { ok: false, stdout: '' };
          return {
            success: ok,
            installed: ok,
            version: ver.ok ? ver.stdout.trim() : null,
            installerOutput: ins.output.slice(-4000),
            error: ok ? null : 'Installer ran but binary did not resolve. (Resolver uses the absolute install path, so a new terminal should NOT be needed — check installer output.)',
          };
        }

        case 'serve': {
          if (!confirm) return { success: false, error: 'Refusing to start daemon without confirm=true.' };
          if (!isInstalled()) return { success: false, error: 'Not installed. Run action="ensure" (confirm=true) first.' };
          await startDaemon();
          const running = await isDaemonRunning();
          return { success: running, daemonStarted: running, hint: running ? 'Daemon up. Element-indexed clicks will now persist their cache.' : 'Started serve but status did not confirm running — check action="doctor".' };
        }

        case 'stop': {
          if (!confirm) return { success: false, error: 'Refusing to stop daemon without confirm=true.' };
          const r = await runDriver('stop', null, { timeoutMs: 8000 });
          return { success: r.ok, stopped: r.ok, raw: r.stdout || r.stderr };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }
}

export default new CuaSetup();
