/**
 * Auto-update policy.
 *
 * The plumbing (electron-updater talking to GitHub Releases) is not ours to
 * test. The DECISIONS are, and every one of them below is a place where being
 * wrong costs a user something concrete: a restart they did not consent to, a
 * forty-minute agent run destroyed, or a dev checkout trying to update itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  canInstallNow,
  initAutoUpdate,
  needsExplicitInstall,
  updatePolicy,
} from './autoUpdate.js';

/** Minimal stand-ins — this file tests decisions, not Electron. */
function harness({ platform = 'win32', isPackaged = true, goals = 0 } = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const sent = [];

  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  const autoUpdater = {
    autoDownload: null,
    autoInstallOnAppQuit: null,
    logger: null,
    quitAndInstall: vi.fn(),
    on: (evt, fn) => listeners.set(evt, fn),
  };
  const win = { isDestroyed: () => false, webContents: { send: (ch, p) => sent.push([ch, p]) } };

  const countExecutingGoals = vi.fn(async () => {
    if (goals instanceof Error) throw goals;
    return goals;
  });

  const result = initAutoUpdate({
    autoUpdater,
    ipcMain,
    getWindow: () => win,
    isPackaged,
    platform,
    countExecutingGoals,
    log: () => {},
  });

  return {
    result,
    autoUpdater,
    sent,
    countExecutingGoals,
    invoke: (ch, ...a) => handlers.get(ch)(null, ...a),
    emit: (evt, payload) => listeners.get(evt)?.(payload),
    has: (ch) => handlers.has(ch),
    listening: (evt) => listeners.has(evt),
  };
}

describe('per-platform install policy', () => {
  it('downloads silently on every platform', () => {
    for (const p of ['win32', 'darwin', 'linux']) {
      expect(updatePolicy(p).autoDownload).toBe(true);
    }
  });

  it('installs on quit everywhere EXCEPT Windows', () => {
    // macOS is signed and notarized and Linux AppImage self-replaces, so both
    // can land silently. Windows has no certificate, so installing raises
    // SmartScreen — and quitting the app is not consent to a security prompt
    // appearing afterwards.
    expect(updatePolicy('darwin').autoInstallOnAppQuit).toBe(true);
    expect(updatePolicy('linux').autoInstallOnAppQuit).toBe(true);
    expect(updatePolicy('win32').autoInstallOnAppQuit).toBe(false);
  });

  it('only Windows asks the user to click', () => {
    expect(needsExplicitInstall('win32')).toBe(true);
    expect(needsExplicitInstall('darwin')).toBe(false);
    expect(needsExplicitInstall('linux')).toBe(false);
  });

  it('applies the policy to the updater it is given', () => {
    const { autoUpdater } = harness({ platform: 'win32' });
    expect(autoUpdater.autoDownload).toBe(true);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  });
});

describe('THE INVARIANT: never restart while a goal is executing', () => {
  // Same rule as the cluster admission gate and the tenant fleet updater:
  // never destroy running work for an infrastructure reason. The update is
  // already on disk and loses nothing by waiting; a forty-minute agent run
  // killed at minute thirty-nine is gone.
  it('refuses to install while goals are running, and does not quit', async () => {
    const h = harness({ goals: 2 });
    const r = await h.invoke('update:install');

    expect(r).toEqual({ ok: false, reason: 'goal-running', goals: 2 });
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('installs when nothing is running', async () => {
    const h = harness({ goals: 0 });
    expect(await h.invoke('update:install')).toEqual({ ok: true });
  });

  it('an unreadable database does not brick the button forever', async () => {
    // The user is actively pressing this control. A database we cannot read is
    // not evidence of running work, and a permanently dead update button is a
    // worse failure than the bounded risk of restarting — the user asked.
    const h = harness({ goals: new Error('SQLITE_CANTOPEN') });
    expect(await h.invoke('update:install')).toEqual({ ok: true });
  });

  it('canInstallNow reports the count so the UI can say what is running', async () => {
    expect(await canInstallNow(async () => 3)).toEqual({ ok: false, reason: 'goal-running', goals: 3 });
    expect(await canInstallNow(async () => 0)).toEqual({ ok: true });
  });
});

describe('a dev checkout never tries to update itself', () => {
  // electron-builder writes no app-update.yml into a dev tree, so wiring the
  // updater there logs a confusing error on every launch and can never succeed.
  it('does not arm the updater', () => {
    const h = harness({ isPackaged: false });
    expect(h.result.enabled).toBe(false);
    expect(h.autoUpdater.autoDownload).toBeNull();
    expect(h.listening('update-downloaded')).toBe(false);
  });

  it('still answers the renderer instead of leaving the channel unhandled', async () => {
    // A missing handler surfaces as an opaque "no handler for channel" rejection.
    // Saying "not packaged" is an answer the UI can act on.
    const h = harness({ isPackaged: false });
    expect(h.has('update:status')).toBe(true);
    expect(await h.invoke('update:install')).toEqual({ ok: false, reason: 'not-packaged' });
  });

  it('ANTI-VACUITY: a packaged build DOES arm it', () => {
    const h = harness({ isPackaged: true });
    expect(h.result.enabled).toBe(true);
    expect(h.listening('update-downloaded')).toBe(true);
  });
});

describe('what the renderer is told', () => {
  it('announces a downloaded update, and whether a click is required', () => {
    const h = harness({ platform: 'win32' });
    h.emit('update-downloaded', { version: '0.6.8' });

    expect(h.sent).toContainEqual([
      'update:downloaded',
      { version: '0.6.8', needsExplicitInstall: true },
    ]);
  });

  it('tells macOS it needs no click', () => {
    const h = harness({ platform: 'darwin' });
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(h.sent[0][1].needsExplicitInstall).toBe(false);
  });

  it('reports progress so the button is not live before the file exists', () => {
    const h = harness();
    h.emit('download-progress', { percent: 42.7, bytesPerSecond: 1000 });
    expect(h.sent).toContainEqual(['update:progress', { percent: 43, bytesPerSecond: 1000 }]);
  });

  it('a failed update check is swallowed, never surfaced', () => {
    // The agnt.gg notifier is the visible fallback. An update error must never
    // be louder than whatever the user is actually doing.
    const h = harness();
    expect(() => h.emit('error', new Error('ENOTFOUND'))).not.toThrow();
    expect(h.sent).toHaveLength(0);
  });

  it('survives the window being gone', () => {
    const handlers = new Map();
    initAutoUpdate({
      autoUpdater: { on: (e, f) => handlers.set(e, f), quitAndInstall: vi.fn() },
      ipcMain: { handle: () => {} },
      getWindow: () => null, // quit in progress
      isPackaged: true,
      platform: 'darwin',
      countExecutingGoals: async () => 0,
      log: () => {},
    });
    expect(() => handlers.get('update-downloaded')({ version: '1' })).not.toThrow();
  });
});
