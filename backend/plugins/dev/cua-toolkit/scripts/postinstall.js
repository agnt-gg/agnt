#!/usr/bin/env node
/**
 * postinstall.js — auto-bootstrap the Cua Driver when the plugin is installed.
 *
 * AGNT installs plugins with `npm install --production` (no --ignore-scripts),
 * so this script runs automatically on plugin install. Goal: the user installs
 * the PLUGIN and nothing else — the native Cua Driver binary installs itself here.
 *
 * Hard rules:
 *   - NEVER fail the plugin install. Always exit 0, even on error.
 *   - Idempotent: if the driver is already present, do nothing.
 *   - Quiet by default; logs are prefixed so they're greppable in AGNT's console.
 *   - Honors CUA_TOOLKIT_SKIP_AUTOINSTALL=1 to opt out (CI, restricted machines).
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

const TAG = '[cua-toolkit:postinstall]';
const log = (...a) => console.log(TAG, ...a);

function driverPathCandidates() {
  const plat = process.platform;
  if (plat === 'win32') {
    const lad = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return [
      path.join(lad, 'Programs', 'Cua', 'cua-driver', 'bin', 'cua-driver.exe'),
      path.join(lad, 'Programs', 'trycua', 'cua-driver-rs', 'bin', 'cua-driver.exe'),
      path.join(os.homedir(), '.cua-driver', 'bin', 'cua-driver.exe'),
    ];
  }
  return [
    path.join(os.homedir(), '.local', 'bin', 'cua-driver'),
    path.join(os.homedir(), '.cua-driver', 'bin', 'cua-driver'),
  ];
}

function alreadyInstalled() {
  return driverPathCandidates().some((c) => { try { return fs.existsSync(c); } catch { return false; } });
}

function runInstaller() {
  return new Promise((resolve) => {
    let proc;
    let out = '';
    if (process.platform === 'win32') {
      const cmd = 'irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex';
      proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true });
    } else {
      const cmd = '"$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"';
      proc = spawn('/bin/bash', ['-lc', `/bin/bash -c ${cmd}`]);
    }
    proc.stdout?.on('data', (d) => { out += d.toString(); });
    proc.stderr?.on('data', (d) => { out += d.toString(); });
    proc.on('error', (e) => resolve({ ok: false, out: out + `\n[spawn error] ${e?.message}` }));
    proc.on('close', (code) => resolve({ ok: code === 0, out }));
    // 4-minute ceiling — never hang the plugin install forever.
    setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } resolve({ ok: false, out: out + '\n[timeout]' }); }, 240000);
  });
}

async function main() {
  try {
    if (process.env.CUA_TOOLKIT_SKIP_AUTOINSTALL === '1') {
      log('CUA_TOOLKIT_SKIP_AUTOINSTALL=1 set — skipping driver auto-install. Run cua-setup action="ensure" later.');
      return;
    }
    if (alreadyInstalled()) {
      log('Cua Driver already present — nothing to do. ✅');
      return;
    }
    log('Cua Driver not found. Auto-installing the native driver (one-time)…');
    const { ok, out } = await runInstaller();
    if (ok && alreadyInstalled()) {
      log('Cua Driver installed successfully. ✅  The plugin is ready to drive your desktop.');
    } else if (alreadyInstalled()) {
      log('Cua Driver appears installed. ✅');
    } else {
      log('Auto-install did not complete (network/permissions?). The plugin still works —');
      log('just call cua-setup action="ensure" confirm="true" once to finish driver setup.');
      log('Installer tail:', (out || '').slice(-600));
    }
  } catch (e) {
    log('Non-fatal: auto-install hit an error —', e?.message || String(e));
    log('Plugin install continues. Run cua-setup action="ensure" confirm="true" to finish.');
  } finally {
    // ALWAYS succeed so plugin install is never blocked.
    process.exit(0);
  }
}

main();
