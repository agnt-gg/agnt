/**
 * The three halves of the update IPC must name the same channels: main
 * registers them in electron/autoUpdate.js, preload exposes them, and the
 * banner calls the preload surface. The unit tests inject each half, so a
 * rename in one file would pass every one of them and ship a dead banner.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const handled = new Set([...read('electron/autoUpdate.js').matchAll(/ipcMain\.handle\('(update:[a-z-]+)'/g)].map((m) => m[1]));
const pushed = new Set([...read('electron/autoUpdate.js').matchAll(/webContents\.send\('(update:[a-z-]+)'/g)].map((m) => m[1]));
const preload = read('preload.js');
const invoked = new Set([...preload.matchAll(/ipcRenderer\.invoke\('(update:[a-z-]+)'/g)].map((m) => m[1]));
const listened = new Set([...preload.matchAll(/ipcRenderer\.on\('(update:[a-z-]+)'/g)].map((m) => m[1]));

describe('update IPC contract', () => {
  it('every channel preload invokes is handled by main', () => {
    expect(invoked.size).toBeGreaterThan(0);
    for (const ch of invoked) expect(handled, ch).toContain(ch);
  });

  it('every channel preload listens on is pushed by main', () => {
    expect(listened.size).toBeGreaterThan(0);
    for (const ch of listened) expect(pushed, ch).toContain(ch);
  });

  it('the banner uses only what preload exposes', () => {
    const block = /autoUpdate:\s*\{([\s\S]*?)\n  \},/.exec(preload)?.[1] || '';
    const exposed = new Set([...block.matchAll(/^\s{4}([a-zA-Z]+):/gm)].map((m) => m[1]));
    const banner = read('frontend/src/views/_components/common/UpdateNotification.vue');
    const used = new Set([...banner.matchAll(/autoUpdate\??\.([a-zA-Z]+)\(/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(0);
    for (const fn of used) expect(exposed, fn).toContain(fn);
  });

  it('main wires the dependencies initAutoUpdate requires', () => {
    const main = read('main.js');
    const call = /initAutoUpdate\(\{([\s\S]*?)\n    \}\);/.exec(main)?.[1] || '';
    for (const dep of ['autoUpdater', 'ipcMain', 'getWindows', 'version', 'config', 'getBusyReport', 'handoffBackend', 'marker', 'refuseSender']) {
      expect(call, dep).toMatch(new RegExp(`\\b${dep}\\b`));
    }
  });

  it('the backend gets the control token its update routes require', () => {
    expect(read('main.js')).toMatch(/AGNT_CONTROL_TOKEN:\s*CONTROL_TOKEN/);
    expect(read('backend/src/routes/SystemRoutes.js')).toMatch(/process\.env\.AGNT_CONTROL_TOKEN/);
  });

  it('the packaged config the updater reads is present and well-formed', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.agntUpdate.feedBase).toMatch(/^https:\/\/.+\/$/);
    expect(pkg.agntUpdate.assetBase).toBe('https://github.com/agnt-gg/agnt/releases/download/');
    expect(pkg.build.publish[0]).toEqual({ provider: 'generic', url: 'https://agnt.gg/updates/stable/' });
  });
});
