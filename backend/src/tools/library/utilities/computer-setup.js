// computer-setup.js — install, verify, and manage the Cua Driver daemon.
import BaseAction from '../BaseAction.js';
import {
  asBool, resolveDriverPath, runDriver, detectSession0, parseDriverJson,
  ensureReady, isInstalled, installDriver, startDaemon, isDaemonRunning, callTool,
} from '../../../services/computerUse/driver.js';

class ComputerSetup extends BaseAction {
  static schema = {
    "title": "Computer Setup & Doctor",
    "category": "utility",
    "type": "computer-setup",
    "icon": "settings",
    "description": "Install, verify, update and diagnose the Cua Driver. ensure=ONE-CALL bootstrap (install if missing + start daemon + health probe + update check) — run this first and you are done. Also: status, doctor (environment + Session-0 check), health (end-to-end probe that exercises real capture/UIA/input paths), permissions, config (read or write persistent driver settings), tools (full driver surface), install, update, serve, stop, version.",
    "parameters": {
      "action": {
        "type": "string",
        "inputType": "select",
        "required": true,
        "options": [
          "ensure",
          "status",
          "doctor",
          "health",
          "permissions",
          "config",
          "tools",
          "install",
          "update",
          "serve",
          "stop",
          "version"
        ],
        "default": "ensure",
        "description": "ensure=one-call bootstrap; status=install+daemon; doctor=environment report + Session-0 check; health=end-to-end diagnostics that actually exercise capture/UIA/input; permissions=Windows permission check; config=read all settings (omit key) or write one (key+value, confirm=true); tools=list every driver tool; install/update/serve/stop/version=lifecycle."
      },
      "key": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "action=config only. Config key to write, e.g. max_image_dimension (controls how far snapshots are downscaled, which decides whether small text is legible without a zoom). Omit to read the whole config."
      },
      "value": {
        "type": "string",
        "inputType": "text",
        "required": false,
        "description": "action=config only. New value for key. Numbers and true/false are coerced automatically."
      },
      "confirm": {
        "type": "string",
        "inputType": "select",
        "required": false,
        "options": [
          "false",
          "true"
        ],
        "default": "false",
        "description": "Required true for ensure/install/update/serve/stop and for writing config (these install software or change persistent state)."
      }
    },
    "outputs": {
      "success": {
        "type": "boolean",
        "description": "True when the requested action completed (and, for ensure, the session is interactive)."
      },
      "installed": {
        "type": "boolean",
        "description": "Whether the cua-driver binary is installed and resolvable."
      },
      "version": {
        "type": "string",
        "description": "Installed cua-driver version."
      },
      "latestVersion": {
        "type": "string",
        "description": "Latest cua-driver release on GitHub (ensure action)."
      },
      "updateAvailable": {
        "type": "boolean",
        "description": "True when a newer driver release exists — run action=update."
      },
      "versionBefore": {
        "type": "string",
        "description": "Driver version before an update ran."
      },
      "binaryPath": {
        "type": "string",
        "description": "Resolved path to the cua-driver binary."
      },
      "daemon": {
        "type": "object",
        "description": "Daemon state: { running: boolean }."
      },
      "daemonRunning": {
        "type": "boolean",
        "description": "Whether the daemon is running."
      },
      "daemonStarted": {
        "type": "boolean",
        "description": "Whether serve started the daemon."
      },
      "stopped": {
        "type": "boolean",
        "description": "Whether stop succeeded."
      },
      "session0Warning": {
        "type": "boolean",
        "description": "True when the driver sits in Windows Session 0 (no interactive desktop) — every window tool will return empty."
      },
      "session0Hint": {
        "type": "string",
        "description": "Remediation guidance when session0Warning is true."
      },
      "report": {
        "type": "string",
        "description": "Full doctor / health / permissions / config report."
      },
      "permissions": {
        "type": "object",
        "description": "Structured permission check (action=permissions)."
      },
      "config": {
        "type": "object",
        "description": "Persistent driver config (action=config with no key)."
      },
      "tools": {
        "type": "array",
        "description": "Every tool the installed driver exposes: { name, description } (action=tools)."
      },
      "toolCount": {
        "type": "number",
        "description": "Number of driver tools available."
      },
      "installerOutput": {
        "type": "string",
        "description": "Tail of installer output (install/update)."
      },
      "steps": {
        "type": "array",
        "description": "Ordered bootstrap steps executed (ensure)."
      },
      "hint": {
        "type": "string",
        "description": "Next-step guidance."
      },
      "error": {
        "type": "string",
        "description": "Error message when success=false."
      }
    }
  };

  constructor() { super('computer-setup'); }

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
          const upd = await runDriver('check_for_update', {}, { timeoutMs: 15000 });
          const updJson = (() => { try { return JSON.parse(upd.stdout); } catch { return null; } })();
          return {
            success: !session0,
            installed: true,
            version: ver.ok ? ver.stdout.trim() : null,
            latestVersion: updJson?.latest_version || null,
            updateAvailable: updJson?.update_available === true,
            daemonRunning: boot.daemonRunning,
            session0Warning: session0,
            steps: boot.steps,
            report: doc.stdout || doc.stderr,
            hint: session0
              ? '⚠️ Ready EXCEPT Session 0 — window tools will be empty. Run AGNT from an interactive logon (or register cua-driver autostart).'
              : '✅ Cua is installed, daemon up, interactive session OK. Call computer-windows to see your desktop.',
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

        // Update = stop daemon → run installer (idempotent, pulls latest release) → restart daemon.
        case 'update': {
          if (!confirm) return { success: false, error: 'Refusing to update driver without confirm=true.' };
          if (!isInstalled()) return { success: false, error: 'Not installed. Run action="ensure" (confirm=true) instead.' };
          const before = await runDriver('--version', null, { timeoutMs: 8000 });
          await runDriver('stop', null, { timeoutMs: 8000 });
          const ins = await installDriver();
          await startDaemon();
          const after = await runDriver('--version', null, { timeoutMs: 10000 });
          const running = await isDaemonRunning();
          return {
            success: ins.ok && after.ok,
            installed: isInstalled(),
            versionBefore: before.ok ? before.stdout.trim() : null,
            version: after.ok ? after.stdout.trim() : null,
            daemonRunning: running,
            installerOutput: ins.output.slice(-2500),
            hint: running ? 'Driver updated and daemon restarted.' : 'Driver updated but daemon did not confirm running — run action="serve".',
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

        // ── 0.19 diagnostics ──────────────────────────────────────────────
        // health_report is a single-call end-to-end probe (capture, UIA walk,
        // input routing, browser endpoints) — strictly more than `doctor`,
        // which only reports the environment.
        case 'health': {
          const o = await callTool('health_report', {}, { timeoutMs: 90000 });
          return {
            success: !o.refused && o.parsed,
            report: o.json ? JSON.stringify(o.json, null, 2) : o.raw,
            result: o.json,
            error: o.refused ? o.summary : null,
            hint: 'Use this when a tool behaves oddly — it exercises the real paths rather than just describing the environment like action="doctor".',
          };
        }

        case 'permissions': {
          const o = await callTool('check_permissions', {}, { timeoutMs: 30000 });
          return {
            success: !o.refused,
            permissions: o.json,
            report: o.json ? JSON.stringify(o.json, null, 2) : o.raw,
            error: o.refused ? o.summary : null,
            hint: 'Windows has no TCC equivalent: normal use needs no elevation. Elevation only matters for a system-wide autostart task, and UIAccess only for foreground escalation on stubborn legacy apps.',
          };
        }

        // Persistent driver config (e.g. max_image_dimension, which downscales
        // snapshots before encoding and therefore decides whether small text is
        // legible without a zoom).
        case 'config': {
          const key = String(params?.key || '').trim();
          const value = params?.value;
          if (!key) {
            const o = await callTool('get_config', {}, { timeoutMs: 15000 });
            return { success: !o.refused, config: o.json, report: o.json ? JSON.stringify(o.json, null, 2) : o.raw, error: o.refused ? o.summary : null };
          }
          if (value === undefined || value === '') return { success: false, error: 'Pass value to set a config key, or omit key to read the whole config.' };
          if (!confirm) return { success: false, error: 'Writing persistent driver config requires confirm=true — it affects every future run, not just this one.' };
          const num = Number(value);
          const coerced = String(value) === 'true' ? true : String(value) === 'false' ? false : (Number.isFinite(num) && String(num) === String(value).trim() ? num : String(value));
          const o = await callTool('set_config', { key, value: coerced }, { timeoutMs: 15000 });
          return { success: !o.refused, key, value: coerced, result: o.json, error: o.refused ? o.summary : null };
        }

        case 'tools': {
          const r = await runDriver('list-tools', null, { timeoutMs: 20000 });
          const lines = (r.stdout || '').split(/\r?\n/).filter(Boolean);
          return {
            success: r.ok,
            toolCount: lines.length,
            tools: lines.map((l) => { const i = l.indexOf(':'); return i > 0 ? { name: l.slice(0, i), description: l.slice(i + 1).trim() } : { name: l, description: '' }; }),
            hint: 'The full driver surface. This plugin wraps the desktop-automation subset; the browser_* family is deliberately not wrapped — AGNT drives browsers through its own Browser Agent.',
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}. Valid: ensure, status, doctor, health, permissions, config, tools, install, update, serve, stop, version.` };
      }
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }
}

export default new ComputerSetup();
