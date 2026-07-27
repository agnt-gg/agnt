/**
 * Source-level contract for the remote-backend guards in main.js.
 *
 * main.js cannot be imported in a test: it calls app.getPath, registers
 * protocol handlers and forks processes at module scope. But the whole safety
 * argument for this feature rests on three specific guards being present, and
 * "the resolver is well tested" is worth nothing if a later refactor drops the
 * `if` that consults it.
 *
 * So this asserts the wiring at the source level — the same approach as
 * routeSecurity.test.js, for the same reason: an invariant nobody can verify is
 * an invariant that silently rots.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');

/** Strip comments so a rule can never be satisfied by prose describing it. */
const code = main
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('main.js — connection resolution', () => {
  it('resolves the connection exactly once, from the shared resolver', () => {
    expect(code).toMatch(/import\s*\{[\s\S]*?resolveConnection[\s\S]*?\}\s*from\s*'\.\/electron\/connectionConfig\.js'/);
    expect((code.match(/resolveConnection\(/g) || []).length).toBe(1);
  });

  it('defaults to local if resolution itself throws', () => {
    // A broken config file must never stop the app from booting.
    const block = /let connection = \{[\s\S]{0,600}?catch \(err\) \{[\s\S]{0,200}?\}/.exec(code);
    expect(block, 'connection resolution is not wrapped in try/catch').not.toBeNull();
    expect(block[0]).toMatch(/mode: 'local'/);
  });
});

describe('main.js — the three guards', () => {
  it('GUARD 1: does not respawn a local backend in remote mode', () => {
    expect(code).toMatch(/if \(isRemoteMode\(\)\) \{[\s\S]{0,160}?return;/);
  });

  it('GUARD 2: only forks a local backend when one will be used', () => {
    expect(code).toMatch(/if \(!isRemoteMode\(\)\) startBackend\(\);/);
    // and never unconditionally
    expect(code).not.toMatch(/\n\s*startBackend\(\);\s*\n\s*\n\s*\/\/ Instead of a fixed delay/);
  });

  it('GUARD 3: the window URL is no longer hardcoded to localhost', () => {
    expect(code).toMatch(/mainWindow\.loadURL\(isRemoteMode\(\) \? connection\.url : `http:\/\/localhost:\$\{port\}`\)/);
    expect(code).not.toMatch(/mainWindow\.loadURL\(`http:\/\/localhost:\$\{port\}`\)/);
  });
});

describe('main.js — failure behaviour', () => {
  it('NEVER silently falls back to a local backend when the remote is down', () => {
    // Falling back would boot a second, empty database and present it as the
    // user's instance — the exact confusion this feature exists to remove.
    const onFail = /onFail: \(\) => \{([\s\S]*?)\n    \},/.exec(code);
    expect(onFail, 'remote onFail handler not found').not.toBeNull();
    expect(onFail[1]).not.toMatch(/startBackend\(/);
    expect(onFail[1]).toMatch(/connection-error\.html/);
  });

  it('bounds the remote health poll so the user is told rather than left spinning', () => {
    expect(code).toMatch(/maxAttempts: \d+/);
  });

  it('local mode keeps unbounded polling (today\'s behaviour)', () => {
    expect(code).toMatch(/maxAttempts = Number\.isFinite\(opts\.maxAttempts\) \? opts\.maxAttempts : Infinity/);
  });

  it('supports https remotes (AGNT Cloud), not just http', () => {
    expect(code).toMatch(/const transport = isHttps \? https : http/);
  });
});

describe('IPC surface', () => {
  it.each(['connection:get', 'connection:test', 'connection:set', 'connection:relaunch'])(
    'main registers %s',
    (channel) => {
      expect(code).toContain(`ipcMain.handle('${channel}'`);
    }
  );

  it('preload exposes the connection bridge', () => {
    expect(preload).toMatch(/connection:\s*\{/);
    for (const c of ['connection:get', 'connection:test', 'connection:set', 'connection:relaunch']) {
      expect(preload).toContain(c);
    }
  });

  it('refuses to overwrite an env-pinned connection', () => {
    expect(code).toMatch(/connection\.source === 'env'[\s\S]{0,200}?ok: false/);
  });

  it('probes the remote from the MAIN process, so there is no origin and no CORS', () => {
    expect(code).toMatch(/ipcMain\.handle\('connection:test'[\s\S]*?net\.fetch\(/);
  });
});

describe('connection error page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'electron', 'connection-error.html'), 'utf8');

  it('offers both escape hatches', () => {
    expect(html).toMatch(/id="retry"/);
    expect(html).toMatch(/id="local"/);
  });

  it('uses the preload bridge, which survives having no frontend to talk to', () => {
    expect(html).toMatch(/window\.electron\?\.connection/);
    expect(html).toMatch(/relaunch/);
  });
});
