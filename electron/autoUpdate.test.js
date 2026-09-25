/**
 * Auto-update policy.
 *
 * The plumbing (electron-updater downloading and installing) is not ours to
 * test. The DECISIONS are, and every one of them below is a place where being
 * wrong costs a user something concrete: an installer fetched from the wrong
 * place, a restart they did not consent to, a forty-minute agent run destroyed,
 * a root-password prompt after closing the app, or a dev checkout updating
 * itself.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  channelFor,
  feedUrlFor,
  updateSupport,
  updatePolicy,
  needsExplicitInstall,
  checkUpdateInfo,
  installVerdict,
  createInstallMarker,
  initAutoUpdate,
} from './autoUpdate.js';

const ASSETS = 'https://github.com/agnt-gg/agnt/releases/download/';
const FEED = 'https://agnt.gg/updates/';
const url = (v, name) => `${ASSETS}v${v}/AGNT-${v}-${name}`;
const info = (v, names = ['win-x64.exe']) => ({ version: v, files: names.map((n) => ({ url: url(v, n), sha512: 'x', size: 1 })), path: url(v, names[0]) });
const idle = { goals: 0, chats: 0, workflows: 0, tools: 0, unknown: [] };

// ------------------------------------------------------------------ policy
describe('which feed a build follows', () => {
  it('releases follow stable; prereleases follow rehearsal', () => {
    expect(channelFor('0.6.7')).toBe('stable');
    expect(channelFor('0.6.7-rc.1')).toBe('rehearsal');
    expect(feedUrlFor({ feedBase: FEED, version: '0.6.7' })).toBe('https://agnt.gg/updates/stable/');
    expect(feedUrlFor({ feedBase: FEED, version: '0.6.7-rc.2' })).toBe('https://agnt.gg/updates/rehearsal/');
  });

  it('refuses a malformed feed base instead of guessing', () => {
    expect(() => feedUrlFor({ feedBase: 'https://agnt.gg/updates', version: '0.6.7' })).toThrow(/ending in \//);
    expect(() => feedUrlFor({ feedBase: undefined, version: '0.6.7' })).toThrow();
  });
});

describe('who may update themselves', () => {
  it('never a dev checkout', () => {
    expect(updateSupport({ isPackaged: false, platform: 'win32' })).toEqual({ enabled: false, reason: 'dev-build' });
  });
  it('Windows and macOS packaged builds', () => {
    expect(updateSupport({ isPackaged: true, platform: 'win32' }).enabled).toBe(true);
    expect(updateSupport({ isPackaged: true, platform: 'darwin' }).enabled).toBe(true);
  });
  it('Linux only as an AppImage: deb/rpm would install through pkexec after the user quit', () => {
    expect(updateSupport({ isPackaged: true, platform: 'linux', env: {} })).toEqual({ enabled: false, reason: 'linux-package-manager' });
    expect(updateSupport({ isPackaged: true, platform: 'linux', env: { APPIMAGE: '/home/u/AGNT.AppImage' } }).enabled).toBe(true);
  });
});

describe('how installs happen', () => {
  it('never downloads without the pin check, never downgrades, never takes prereleases on its own', () => {
    for (const p of ['win32', 'darwin', 'linux']) {
      const policy = updatePolicy(p);
      expect(policy.autoDownload).toBe(false);
      expect(policy.allowDowngrade).toBe(false);
      expect(policy.allowPrerelease).toBe(false);
    }
  });
  it('Windows waits for a click (no certificate); macOS and AppImage install on quit', () => {
    expect(updatePolicy('win32').autoInstallOnAppQuit).toBe(false);
    expect(updatePolicy('darwin').autoInstallOnAppQuit).toBe(true);
    expect(updatePolicy('linux').autoInstallOnAppQuit).toBe(true);
    expect(needsExplicitInstall('win32')).toBe(true);
    expect(needsExplicitInstall('darwin')).toBe(false);
  });
});

// ------------------------------------------------------------------ the pin
describe('the pin: only AGNT assets of exactly the announced version', () => {
  const ctx = { assetBase: ASSETS, currentVersion: '0.6.7' };

  it('accepts a real release', () => {
    expect(checkUpdateInfo(info('0.6.8'), ctx)).toEqual({ ok: true });
    expect(checkUpdateInfo(info('0.6.8', ['mac-x64.zip', 'mac-arm64.zip']), ctx)).toEqual({ ok: true });
  });

  it('refuses the v0.6.6 defect: a feed pointing at AGNT-Lite', () => {
    const bad = { version: '0.6.8', files: [{ url: `${ASSETS}v0.6.8/AGNT-Lite-0.6.8-win-x64.exe` }], path: `${ASSETS}v0.6.8/AGNT-Lite-0.6.8-win-x64.exe` };
    expect(checkUpdateInfo(bad, ctx).ok).toBe(false);
  });

  it('refuses any other host, repository, tag or version', () => {
    const cases = [
      { ...info('0.6.8'), files: [{ url: 'https://evil.example/AGNT-0.6.8-win-x64.exe' }] },
      { ...info('0.6.8'), files: [{ url: 'https://github.com/someone/agnt/releases/download/v0.6.8/AGNT-0.6.8-win-x64.exe' }] },
      { ...info('0.6.8'), files: [{ url: url('0.6.6', 'win-x64.exe') }] },
      { ...info('0.6.8'), path: url('0.6.9', 'win-x64.exe') },
      { ...info('0.6.8'), files: [{ url: `${ASSETS}v0.6.8/AGNT-0.6.8-../../x.exe` }] },
      { ...info('0.6.8'), files: [{ url: `http://github.com/agnt-gg/agnt/releases/download/v0.6.8/AGNT-0.6.8-win-x64.exe` }] },
      { version: '0.6.8', files: [] },
      { version: 'latest', files: [{ url: url('latest', 'win-x64.exe') }] },
    ];
    for (const c of cases) expect(checkUpdateInfo(c, ctx).ok, JSON.stringify(c.files)).toBe(false);
  });

  it('a stable build never takes a prerelease; a rehearsal build may take its release', () => {
    expect(checkUpdateInfo(info('0.6.8-rc.1'), ctx)).toEqual({ ok: false, reason: 'stable build offered prerelease 0.6.8-rc.1' });
    expect(checkUpdateInfo(info('0.6.7-rc.2'), { ...ctx, currentVersion: '0.6.7-rc.1' }).ok).toBe(true);
    expect(checkUpdateInfo(info('0.6.7'), { ...ctx, currentVersion: '0.6.7-rc.2' }).ok).toBe(true);
  });

  it('refuses when no asset base is configured', () => {
    expect(checkUpdateInfo(info('0.6.8'), { ...ctx, assetBase: undefined }).ok).toBe(false);
  });
});

// ------------------------------------------------------------------ busy
describe('never restart over running work', () => {
  it('idle is the only unconditional yes', () => {
    expect(installVerdict(idle)).toEqual({ ok: true });
  });
  it('any running goal, chat, workflow or tool refuses', () => {
    for (const k of ['goals', 'chats', 'workflows', 'tools']) {
      expect(installVerdict({ ...idle, [k]: 1 })).toMatchObject({ ok: false, reason: 'busy' });
    }
  });
  it('an unreachable backend is UNKNOWN, not idle (it used to count as 0)', () => {
    expect(installVerdict(null)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(installVerdict({ ...idle, unknown: ['workflows'] })).toMatchObject({ ok: false, reason: 'unknown' });
  });
  it('"Restart anyway" is honoured', () => {
    expect(installVerdict({ ...idle, goals: 2 }, { force: true })).toEqual({ ok: true });
    expect(installVerdict(null, { force: true })).toEqual({ ok: true });
  });
});

describe('the post-restart check', () => {
  function memFs() {
    const files = new Map();
    return {
      files,
      writeFileSync: (f, d) => files.set(f, d),
      readFileSync: (f) => { if (!files.has(f)) throw new Error('ENOENT'); return files.get(f); },
      unlinkSync: (f) => files.delete(f),
    };
  }
  it('reports ok when the new version is running, mismatch when it is not, and is read once', () => {
    const fs = memFs();
    const m = createInstallMarker({ fs, file: '/u/update-install.json' });
    m.write('0.6.7', '0.6.8');
    expect(m.consume('0.6.8')).toMatchObject({ from: '0.6.7', to: '0.6.8', ok: true });
    expect(m.consume('0.6.8')).toBeNull();
    m.write('0.6.7', '0.6.8');
    expect(m.consume('0.6.7')).toMatchObject({ ok: false, running: '0.6.7' });
  });
});

// ------------------------------------------------------------------ wiring
function harness({ platform = 'win32', isPackaged = true, version = '0.6.7', env = {}, busy = idle, handoff, refuse = false, marker = null } = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const sent = [];
  let checks = 0;
  const autoUpdater = {
    autoDownload: null,
    autoInstallOnAppQuit: null,
    setFeedURL: vi.fn(),
    quitAndInstall: vi.fn(),
    downloadUpdate: vi.fn(async () => {}),
    checkForUpdates: vi.fn(async () => { checks++; await new Promise((r) => setTimeout(r, 5)); }),
    on: (evt, fn) => listeners.set(evt, fn),
  };
  const win = { isDestroyed: () => false, webContents: { send: (ch, p) => sent.push([ch, p]) } };
  const handoffBackend = vi.fn(handoff || (async () => {}));
  const order = [];
  handoffBackend.mockImplementation(async () => { order.push('handoff'); if (handoff) await handoff(); });
  autoUpdater.quitAndInstall.mockImplementation(() => order.push('quitAndInstall'));
  const result = initAutoUpdate({
    autoUpdater,
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
    getWindows: () => [win],
    isPackaged,
    platform,
    version,
    env,
    config: { feedBase: FEED, assetBase: ASSETS },
    getBusyReport: vi.fn(async () => (busy instanceof Error ? Promise.reject(busy) : busy)),
    handoffBackend,
    marker,
    refuseSender: () => refuse,
    log: () => {},
    defer: (fn) => fn(),
  });
  return {
    result, autoUpdater, sent, order, handoffBackend, checks: () => checks,
    invoke: (ch, ...a) => handlers.get(ch)({ sender: {} }, ...a),
    emit: (evt, payload) => listeners.get(evt)?.(payload),
    last: () => sent.filter(([c]) => c === 'update:state').at(-1)?.[1],
  };
}

describe('wiring', () => {
  it('a dev build registers the handlers, arms nothing and says why', async () => {
    const h = harness({ isPackaged: false });
    expect(h.result.enabled).toBe(false);
    expect(h.autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(await h.invoke('update:state')).toMatchObject({ enabled: false, disabledReason: 'dev-build', phase: 'disabled' });
    expect(await h.invoke('update:install')).toEqual({ ok: false, reason: 'dev-build' });
  });

  it('a deb/rpm install is disabled the same way', () => {
    expect(harness({ platform: 'linux', env: {} }).result).toMatchObject({ enabled: false, reason: 'linux-package-manager' });
  });

  it('follows the right generic feed and never auto-downloads', () => {
    const stable = harness({ version: '0.6.7' });
    expect(stable.autoUpdater.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'https://agnt.gg/updates/stable/' });
    expect(stable.autoUpdater.autoDownload).toBe(false);
    expect(stable.autoUpdater.allowDowngrade).toBe(false);
    const rc = harness({ version: '0.6.7-rc.1' });
    expect(rc.autoUpdater.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'https://agnt.gg/updates/rehearsal/' });
  });

  it('downloads only after the pin passes, and walks available → downloading → ready', async () => {
    const h = harness();
    h.emit('checking-for-update');
    h.emit('update-available', info('0.6.8'));
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(h.last()).toMatchObject({ phase: 'downloading', available: { version: '0.6.8' }, percent: 0 });
    h.emit('download-progress', { percent: 41.6 });
    expect(h.last()).toMatchObject({ phase: 'downloading', percent: 42 });
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(h.last()).toMatchObject({ phase: 'ready', available: { version: '0.6.8' } });
  });

  it('every PUSHED state says the build updates itself, not only the pulled one', () => {
    // The banner decides "self-updating" from `enabled`. Pushes used to omit it,
    // so the first push (downloading) turned the banner off and the Restart
    // button never appeared. Found in the update rehearsal.
    const h = harness();
    h.emit('checking-for-update');
    h.emit('update-available', info('0.6.8'));
    h.emit('update-downloaded', { version: '0.6.8' });
    const pushes = h.sent.filter(([c]) => c === 'update:state').map(([, s]) => s);
    expect(pushes.length).toBeGreaterThan(2);
    for (const s of pushes) expect(s).toMatchObject({ enabled: true, disabledReason: null });
  });

  it('a feed that fails the pin is refused loudly and nothing is downloaded', () => {
    const h = harness();
    h.emit('update-available', { version: '0.6.8', files: [{ url: 'https://evil.example/AGNT-0.6.8-win-x64.exe' }] });
    expect(h.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ phase: 'error', error: { during: 'verify' } });
  });

  it('a failed download surfaces as an error the banner can retry', async () => {
    const h = harness();
    h.autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error('sha512 checksum mismatch'));
    h.emit('update-available', info('0.6.8'));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.last()).toMatchObject({ phase: 'error', error: { message: 'sha512 checksum mismatch', during: 'download' } });
  });

  it('a background check that fails is quiet; a user check that fails is not', async () => {
    const h = harness();
    h.emit('checking-for-update');
    h.emit('error', new Error('HttpError: 404'));
    expect(h.last()).toMatchObject({ phase: 'idle', error: null });

    const p = h.invoke('update:check');
    h.emit('checking-for-update');
    h.emit('error', new Error('getaddrinfo ENOTFOUND agnt.gg'));
    await p;
    expect(h.last()).toMatchObject({ phase: 'error', error: { message: 'getaddrinfo ENOTFOUND agnt.gg' } });
  });

  it('concurrent checks collapse into one', async () => {
    const h = harness();
    await Promise.all([h.result.check(), h.result.check(), h.invoke('update:check')]);
    expect(h.checks()).toBe(1);
  });

  it('install before a download is ready is refused', async () => {
    expect(await harness().invoke('update:install')).toEqual({ ok: false, reason: 'not-ready' });
  });

  it('install over running work is refused, stays ready, and says what is running', async () => {
    const h = harness({ busy: { ...idle, goals: 1, chats: 2 } });
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(await h.invoke('update:install')).toMatchObject({ ok: false, reason: 'busy' });
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(h.handoffBackend).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ phase: 'ready', blocked: { reason: 'busy', busy: { goals: 1, chats: 2 } } });
  });

  it('an unanswering backend blocks as unknown until the user forces it', async () => {
    const h = harness({ busy: new Error('ECONNREFUSED') });
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(await h.invoke('update:install')).toMatchObject({ ok: false, reason: 'unknown' });
    expect(await h.invoke('update:install', { force: true })).toEqual({ ok: true });
    expect(h.order).toEqual(['handoff', 'quitAndInstall']);
  });

  it('install hands the backend a clean exit BEFORE the installer starts', async () => {
    const h = harness();
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(await h.invoke('update:install')).toEqual({ ok: true });
    expect(h.order).toEqual(['handoff', 'quitAndInstall']);
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(h.last()).toMatchObject({ phase: 'installing' });
  });

  it('work that starts between the check and the handoff postpones the install; nothing is stopped', async () => {
    const h = harness({ handoff: async () => ({ ok: false, reason: 'busy', busy: { ...idle, chats: 1 } }) });
    h.handoffBackend.mockImplementation(async (opts) => { h.order.push(`handoff:${opts.force}`); return { ok: false, reason: 'busy', busy: { ...idle, chats: 1 } }; });
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(await h.invoke('update:install')).toMatchObject({ ok: false, reason: 'busy' });
    expect(h.order).toEqual(['handoff:false']);
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ phase: 'ready', blocked: { reason: 'busy', busy: { chats: 1 } } });
  });

  it('Restart anyway is passed through to the backend', async () => {
    const h = harness({ busy: { ...idle, goals: 1 } });
    h.handoffBackend.mockImplementation(async (opts) => { h.order.push(`handoff:${opts.force}`); return { ok: true }; });
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(await h.invoke('update:install', { force: true })).toEqual({ ok: true });
    expect(h.order).toEqual(['handoff:true', 'quitAndInstall']);
  });

  it('a failed handoff still installs (the user asked; the old path was a kill anyway)', async () => {
    const h = harness({ handoff: async () => { throw new Error('backend gone'); } });
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(await h.invoke('update:install')).toEqual({ ok: true });
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalled();
  });

  it('a team space may read the state but never check or install', async () => {
    const h = harness({ refuse: true });
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(await h.invoke('update:install', { force: true })).toEqual({ ok: false, reason: 'refused' });
    expect(await h.invoke('update:check')).toEqual({ ok: false, reason: 'refused' });
    expect((await h.invoke('update:state')).phase).toBe('ready');
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('writes the marker before installing and reports the result after the restart', async () => {
    const files = new Map();
    const fs = { writeFileSync: (f, d) => files.set(f, d), readFileSync: (f) => files.get(f) ?? (() => { throw new Error('ENOENT'); })(), unlinkSync: (f) => files.delete(f) };
    const marker = createInstallMarker({ fs, file: 'm' });
    const before = harness({ marker });
    before.emit('update-downloaded', { version: '0.6.8' });
    await before.invoke('update:install');
    expect(JSON.parse(files.get('m'))).toMatchObject({ from: '0.6.7', to: '0.6.8' });

    const after = harness({ version: '0.6.8', marker });
    expect((await after.invoke('update:state')).installed).toMatchObject({ from: '0.6.7', to: '0.6.8', ok: true });
  });
});
