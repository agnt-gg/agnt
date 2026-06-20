// lib/driver.js — shared helpers for locating + invoking the Cua Driver (trycua/cua)
// Cross-platform, but Windows-first since that's the target host.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

export function asBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase());
  return false;
}

export function asInt(v, def, min, max) {
  const n = Number.parseInt(String(v ?? def), 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

// Resolve the cua-driver binary. Checks PATH first, then the known Windows install junction,
// then the platform-standard ~/.local/bin location.  We deliberately prefer the ABSOLUTE
// install path so a fresh terminal is NOT required for PATH to update (Windows quirk eliminated).
export function resolveDriverPath() {
  const plat = process.platform;
  const candidates = [];

  if (plat === 'win32') {
    const lad = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(
      path.join(lad, 'Programs', 'Cua', 'cua-driver', 'bin', 'cua-driver.exe'),
      // legacy layout (<= v0.2.13)
      path.join(lad, 'Programs', 'trycua', 'cua-driver-rs', 'bin', 'cua-driver.exe'),
      // install-home layout (~/.cua-driver) used by the release installer
      path.join(os.homedir(), '.cua-driver', 'bin', 'cua-driver.exe')
    );
  } else {
    candidates.push(
      path.join(os.homedir(), '.local', 'bin', 'cua-driver'),
      path.join(os.homedir(), '.cua-driver', 'bin', 'cua-driver')
    );
  }

  for (const c of candidates) {
    try { if (fs.existsSync(c)) return { found: true, path: c, onPath: false }; } catch { /* ignore */ }
  }
  // Fall back to bare name and rely on PATH resolution.
  return { found: false, path: plat === 'win32' ? 'cua-driver.exe' : 'cua-driver', onPath: true };
}

// Run cua-driver <subcommand> [jsonArg] and capture stdout/stderr.
// Cua's CLI shape:  cua-driver <tool> '<json>'   e.g.  cua-driver click '{"pid":844,...}'
export function runDriver(subcommand, jsonArg = null, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const { path: bin } = resolveDriverPath();
    // Cua Driver 0.5.x exposes automation tools via: cua-driver call <tool> <json>.
    // Management commands remain top-level: status, doctor, serve, stop, --version, etc.
    const management = new Set(['--version', 'status', 'doctor', 'serve', 'stop', 'list-tools', 'describe']);
    const args = management.has(subcommand) ? [subcommand] : ['call', subcommand];
    if (jsonArg != null) args.push(typeof jsonArg === 'string' ? jsonArg : JSON.stringify(jsonArg));

    let stdout = '';
    let stderr = '';
    let done = false;

    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, code: -1, stdout: '', stderr: String(e?.message || e), error: 'spawn_failed' });
    }

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve({ ok: false, code: -1, stdout, stderr, error: 'timeout', timedOut: true });
    }, timeoutMs);

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const notFound = /ENOENT/i.test(String(e?.message));
      resolve({ ok: false, code: -1, stdout, stderr: String(e?.message || e), error: notFound ? 'not_installed' : 'spawn_error' });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim(), error: code === 0 ? null : 'nonzero_exit' });
    });
  });
}

// Best-effort JSON parse of driver stdout (Cua returns JSON for most tools).
export function parseDriverJson(out) {
  if (!out) return null;
  try { return JSON.parse(out); } catch { /* fall through */ }
  // Some commands print a leading human banner then JSON; grab the first {...} or [...] block.
  const m = out.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
  if (m) { try { return JSON.parse(m[1]); } catch { /* ignore */ } }
  return null;
}

// Detect the Windows Session-0 trap: window tools silently return empty arrays
// when the driver runs in a non-interactive session. We surface this clearly.
export function detectSession0(doctorText) {
  if (!doctorText) return false;
  return /Session 0|no attached interactive desktop|window-driving tools.*empty/i.test(doctorText);
}

export function notInstalledResult() {
  return {
    success: false,
    installed: false,
    error: 'Cua Driver is not installed. Run cua-setup with action="ensure" (confirm=true) to auto-install + start it, or action="install".',
  };
}

// ---------------------------------------------------------------------------
// Bootstrap layer — lets every tool self-heal so the user never runs manual steps.
// ---------------------------------------------------------------------------

export function isInstalled() {
  const r = resolveDriverPath();
  return r.found; // found === absolute binary exists on disk
}

// Run the official installer (Windows PowerShell / *nix bash). Returns combined output.
export function installDriver({ timeoutMs = 240000 } = {}) {
  return new Promise((resolve) => {
    let proc, out = '';
    if (process.platform === 'win32') {
      const cmd = 'irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex';
      proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true });
    } else {
      const cmd = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"';
      proc = spawn('/bin/bash', ['-lc', cmd]);
    }
    proc.stdout?.on('data', (d) => { out += d.toString(); });
    proc.stderr?.on('data', (d) => { out += d.toString(); });
    proc.on('error', (e) => resolve({ ok: false, output: out + `\n[spawn error] ${e?.message}` }));
    proc.on('close', (code) => resolve({ ok: code === 0, output: out }));
    setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } resolve({ ok: false, output: out + '\n[timeout]' }); }, timeoutMs);
  });
}

export async function isDaemonRunning() {
  const st = await runDriver('status', null, { timeoutMs: 8000 });
  return /running/i.test(st.stdout) && !/not running/i.test(st.stdout);
}

// Start the long-running daemon detached (needed for element-index cache persistence).
export function startDaemon() {
  return new Promise((resolve) => {
    const { path: bin } = resolveDriverPath();
    let child;
    try {
      child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } catch (e) {
      return resolve({ ok: false, error: e?.message });
    }
    setTimeout(() => resolve({ ok: true, pid: child.pid ?? null }), 1500);
  });
}

// The one-call self-heal used by every runtime tool.
// install (optional) -> ensure daemon up -> return readiness.
// Pass { allowInstall } to permit auto-install when the binary is missing.
export async function ensureReady({ allowInstall = false } = {}) {
  const steps = [];

  // 1. Binary present?
  if (!isInstalled()) {
    if (!allowInstall) {
      return { ready: false, installed: false, error: notInstalledResult().error, steps };
    }
    steps.push('installing driver…');
    const ins = await installDriver();
    steps.push(ins.ok ? 'install ok' : 'install failed');
    if (!isInstalled()) {
      return { ready: false, installed: false, error: 'Auto-install ran but binary did not appear.', installerTail: ins.output.slice(-1500), steps };
    }
  }

  // 2. Daemon up? (cheap to check; auto-start if not)
  let running = await isDaemonRunning();
  if (!running) {
    steps.push('starting daemon…');
    await startDaemon();
    running = await isDaemonRunning();
    steps.push(running ? 'daemon up' : 'daemon start unconfirmed');
  } else {
    steps.push('daemon already running');
  }

  return { ready: true, installed: true, daemonRunning: running, steps };
}
