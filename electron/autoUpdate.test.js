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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { compareVersions,
  channelFor,
  feedUrlFor,
  updateSupport,
  updatePolicy,
  needsExplicitInstall,
  checkUpdateInfo,
  installVerdict,
  createInstallMarker,
  keepAppImagePath,
  isPerMachineInstall,
  manualDownloadUrl,
  macInstallNeedsAdmin,
  stagingFailure,
  STAGING_LIMIT_MS,
  initAutoUpdate,
} from './autoUpdate.js';

describe('isPerMachineInstall', () => {
  const env = { ProgramFiles: 'C:\\Program Files', ProgramW6432: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' };
  it('an all-users install lives under Program Files', () => {
    expect(isPerMachineInstall({ platform: 'win32', execPath: 'C:\\Program Files\\AGNT\\AGNT.exe', env })).toBe(true);
    expect(isPerMachineInstall({ platform: 'win32', execPath: 'c:/program files (x86)/AGNT/AGNT.exe', env })).toBe(true);
  });
  it('a per-user install, a lookalike folder, or another OS is not', () => {
    expect(isPerMachineInstall({ platform: 'win32', execPath: 'C:\\Users\\u\\AppData\\Local\\Programs\\AGNT\\AGNT.exe', env })).toBe(false);
    expect(isPerMachineInstall({ platform: 'win32', execPath: 'C:\\Program Files Extra\\AGNT\\AGNT.exe', env })).toBe(false);
    expect(isPerMachineInstall({ platform: 'darwin', execPath: 'C:\\Program Files\\AGNT\\AGNT.exe', env })).toBe(false);
  });
});

const ASSETS = 'https://github.com/agnt-gg/agnt/releases/download/';
const FEED = 'https://agnt.gg/updates/';
const url = (v, name) => `${ASSETS}v${v}/AGNT-${v}-${name}`;
const info = (v, names = ['win-x64.exe']) => ({ version: v, files: names.map((n) => ({ url: url(v, n), sha512: 'x', size: 1 })), path: url(v, names[0]) });
const idle = { goals: 0, chats: 0, workflows: 0, tools: 0, unknown: [] };
const settle = () => new Promise((r) => setTimeout(r, 0));
// macOS's own wording for an administrator prompt that was cancelled.
const cancelledPrompt = () => Object.assign(new Error('The operation couldn’t be completed. (OSStatus error -60006.)'), { code: -60006, domain: 'NSOSStatusErrorDomain' });

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
  it('never downloads without the pin check, never takes prereleases on its own; older versions reach the pin', () => {
    for (const p of ['win32', 'darwin', 'linux']) {
      const policy = updatePolicy(p);
      expect(policy.autoDownload).toBe(false);
      expect(policy.allowDowngrade).toBe(true);
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
  it('a Mac that will ask for an administrator waits for a click too', () => {
    expect(updatePolicy('darwin', { needsAdmin: true }).autoInstallOnAppQuit).toBe(false);
    expect(updatePolicy('darwin', { needsAdmin: false }).autoInstallOnAppQuit).toBe(true);
  });
});

describe('macOS: does replacing the app need an administrator?', () => {
  const installed = '/Applications/AGNT.app/Contents/MacOS/AGNT';
  const refusing = (targets, code = 'EACCES') => ({
    constants: { W_OK: 2 },
    accessSync: (target) => { if (targets.includes(target)) throw Object.assign(new Error(code), { code }); },
  });
  const needs = (fsDep, over = {}) => macInstallNeedsAdmin({ platform: 'darwin', execPath: installed, fs: fsDep, path: path.posix, ...over });

  it('yes when the folder holding the app is not this account’s to change (a standard account, /Applications)', () => {
    expect(needs(refusing(['/Applications']))).toBe(true);
  });
  it('yes when the app itself is not', () => {
    expect(needs(refusing(['/Applications/AGNT.app']))).toBe(true);
    expect(needs(refusing(['/Applications/AGNT.app'], 'EPERM'))).toBe(true);
  });
  it('no when both can be changed, as in the Applications folder inside a home folder', () => {
    expect(needs(refusing([]))).toBe(false);
    expect(needs(refusing(['/Applications']), { execPath: '/Users/u/Applications/AGNT.app/Contents/MacOS/AGNT' })).toBe(false);
  });
  it('no when it cannot tell; macOS decides then', () => {
    expect(needs(refusing(['/Applications'], 'ENOENT'))).toBe(false);
    expect(needs(null)).toBe(false);
    expect(needs(refusing(['/', '/opt', '/opt/dev']), { execPath: '/opt/dev/electron' })).toBe(false); // not an app bundle
  });
  it('is a question for macOS only', () => {
    expect(needs(refusing(['/Applications']), { platform: 'win32' })).toBe(false);
    expect(needs(refusing(['/Applications']), { platform: 'linux' })).toBe(false);
  });
});

describe('what a person is told when macOS could not prepare an update', () => {
  it('a cancelled administrator prompt is said in words, with the ways on', () => {
    for (const reason of [cancelledPrompt(), new Error(cancelledPrompt().message), '(OSStatus error -60006.)']) {
      const told = stagingFailure(reason);
      expect(told.message).toBe("macOS asked for an administrator's name and password, and the request was cancelled.");
      expect(told.hint).toMatch(/^Retry and enter them/);
      expect(told.hint).toMatch(/Applications folder inside your home folder/);
    }
  });
  it('so is one macOS did not accept', () => {
    const told = stagingFailure(Object.assign(new Error('The operation couldn’t be completed. (OSStatus error -60005.)'), { code: -60005 }));
    expect(told.message).toBe("macOS did not accept the administrator's name and password.");
    expect(told.hint).toMatch(/^Retry and enter them/);
  });
  it('anything else is passed on as macOS said it', () => {
    expect(stagingFailure(new Error('Could not locate update bundle'))).toEqual({ message: 'Could not locate update bundle' });
    expect(stagingFailure('macOS found nothing to install.')).toEqual({ message: 'macOS found nothing to install.' });
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

// ------------------------------------------------------------------ rollback
describe('rollback: back to the release this build replaced, only when the feed says so', () => {
  const ctx = { assetBase: ASSETS, currentVersion: '0.6.8', rollbackTo: '0.6.7' };
  const rollback = (v) => ({ ...info(v), rollback: true });

  it('a marked rollback to rollbackTo is accepted', () => {
    expect(checkUpdateInfo(rollback('0.6.7'), ctx)).toEqual({ ok: true });
  });
  it('an older version without the mark is refused', () => {
    expect(checkUpdateInfo(info('0.6.7'), ctx)).toEqual({ ok: false, reason: 'feed offers older 0.6.7 without a rollback' });
    expect(checkUpdateInfo({ ...info('0.6.7'), rollback: 'true' }, ctx).ok).toBe(false);
  });
  it('anything older than rollbackTo is refused, marked or not', () => {
    expect(checkUpdateInfo(rollback('0.6.6'), ctx)).toEqual({ ok: false, reason: 'rollback to 0.6.6 refused: this build rolls back only to 0.6.7' });
    expect(checkUpdateInfo(rollback('0.5.9'), ctx).ok).toBe(false);
  });
  it('a build with no rollbackTo never goes back', () => {
    expect(checkUpdateInfo(rollback('0.6.7'), { ...ctx, rollbackTo: undefined }).ok).toBe(false);
  });
  it('a rollback still has to pass the pin', () => {
    expect(checkUpdateInfo({ ...rollback('0.6.7'), files: [{ url: 'https://evil.example/AGNT-0.6.7-win-x64.exe' }] }, ctx).ok).toBe(false);
  });
  it('newer versions are unaffected by the mark', () => {
    expect(checkUpdateInfo(info('0.6.9'), ctx)).toEqual({ ok: true });
    expect(checkUpdateInfo(rollback('0.6.9'), ctx)).toEqual({ ok: true });
  });
  it('a rehearsal build rolls back to its own previous candidate', () => {
    expect(checkUpdateInfo(rollback('0.6.8-rc.1'), { assetBase: ASSETS, currentVersion: '0.6.8-rc.2', rollbackTo: '0.6.8-rc.1' })).toEqual({ ok: true });
  });
  it('compareVersions orders releases and prereleases by semver', () => {
    expect(compareVersions('0.6.7', '0.6.8')).toBe(-1);
    expect(compareVersions('0.6.10', '0.6.9')).toBe(1);
    expect(compareVersions('0.6.8-rc.1', '0.6.8')).toBe(-1);
    expect(compareVersions('0.6.8-rc.10', '0.6.8-rc.9')).toBe(1);
    expect(compareVersions('0.6.8', '0.6.8')).toBe(0);
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
function harness({ platform = 'win32', arch = 'x64', isPackaged = true, version = '0.6.7', env = {}, busy = idle, handoff, refuse = false, marker = null, native = false, rollbackTo, standardAccount = false } = {}) {
  // A standard macOS account with AGNT in /Applications: not a folder it can change.
  const installedWhere = standardAccount
    ? {
      execPath: '/Applications/AGNT.app/Contents/MacOS/AGNT',
      path: path.posix,
      fs: { constants: { W_OK: 2 }, accessSync: (target) => { if (target === '/Applications') throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); } },
    }
    : {};
  const handlers = new Map();
  const listeners = new Map();
  const nativeListeners = new Map();
  const nativeUpdater = native ? { on: (evt, fn) => nativeListeners.set(evt, fn), checkForUpdates: vi.fn() } : null;
  // Timers the updater has started; a test decides when one runs out.
  const timers = [];
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
    nativeUpdater,
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
    getWindows: () => [win],
    isPackaged,
    platform,
    version,
    env,
    config: { feedBase: FEED, assetBase: ASSETS, rollbackTo },
    getBusyReport: vi.fn(async () => (busy instanceof Error ? Promise.reject(busy) : busy)),
    handoffBackend,
    marker,
    refuseSender: () => refuse,
    log: () => {},
    defer: (fn) => fn(),
    arch,
    ...installedWhere,
    setTimer: (fn, ms) => { const timer = { fn, ms, live: true }; timers.push(timer); return timer; },
    clearTimer: (timer) => { if (timer) timer.live = false; },
  });
  return {
    result, autoUpdater, nativeUpdater, sent, order, handoffBackend, checks: () => checks,
    clocks: () => timers.filter((t) => t.live),
    elapse: () => { const timer = timers.find((t) => t.live); timer.live = false; timer.fn(); },
    invoke: (ch, ...a) => handlers.get(ch)({ sender: {} }, ...a),
    emit: (evt, payload) => listeners.get(evt)?.(payload),
    emitNative: (evt, payload) => nativeListeners.get(evt)?.(payload),
    last: () => sent.filter(([c]) => c === 'update:state').at(-1)?.[1],
  };
}

describe('an updated AppImage stays where the user launched it', () => {
  // Real files, real links: this is a filesystem contract, so it is tested on
  // one. Symlinks need privileges on Windows, so there the test is skipped;
  // CI's Linux rehearsal runs the real update.
  const canLink = (() => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-link-'));
    try { fs.symlinkSync(path.join(d, 'a'), path.join(d, 'b')); return true; } catch { return false; } finally { fs.rmSync(d, { recursive: true, force: true }); }
  })();
  const it_ = canLink ? it : it.skip;
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-keep-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = (n) => path.join(dir, n);

  it_('moves the new version to the old path and links the new name to it', () => {
    // What electron-updater leaves: old file deleted, new one beside it.
    fs.writeFileSync(at('AGNT-0.6.8-linux-x86_64.AppImage'), 'new');
    const where = keepAppImagePath({ fs, path, oldPath: at('AGNT-0.6.7-linux-x86_64.AppImage'), newPath: at('AGNT-0.6.8-linux-x86_64.AppImage') });
    expect(where).toBe(at('AGNT-0.6.7-linux-x86_64.AppImage'));
    expect(fs.readFileSync(at('AGNT-0.6.7-linux-x86_64.AppImage'), 'utf8')).toBe('new');
    expect(fs.lstatSync(at('AGNT-0.6.8-linux-x86_64.AppImage')).isSymbolicLink()).toBe(true);
    // The updater relaunches the new name; it must still reach the new version.
    expect(fs.readFileSync(at('AGNT-0.6.8-linux-x86_64.AppImage'), 'utf8')).toBe('new');
  });

  it_('the next update clears the previous link and keeps the same path', () => {
    const home = at('AGNT-0.6.7-linux-x86_64.AppImage');
    fs.writeFileSync(at('AGNT-0.6.8-linux-x86_64.AppImage'), 'v8');
    keepAppImagePath({ fs, path, oldPath: home, newPath: at('AGNT-0.6.8-linux-x86_64.AppImage') });
    // Second update: electron-updater deletes the real file, writes 0.6.9.
    fs.unlinkSync(home);
    fs.writeFileSync(at('AGNT-0.6.9-linux-x86_64.AppImage'), 'v9');
    keepAppImagePath({ fs, path, oldPath: home, newPath: at('AGNT-0.6.9-linux-x86_64.AppImage') });
    expect(fs.readFileSync(home, 'utf8')).toBe('v9');
    expect(fs.existsSync(at('AGNT-0.6.8-linux-x86_64.AppImage'))).toBe(false);
    expect(fs.readdirSync(dir).sort()).toEqual(['AGNT-0.6.7-linux-x86_64.AppImage', 'AGNT-0.6.9-linux-x86_64.AppImage']);
  });

  it('if it cannot link, it puts the file back where the updater relaunches it', () => {
    const moves = [];
    const fake = {
      renameSync: (a, b) => moves.push([a, b]),
      symlinkSync: () => { throw new Error('EPERM'); },
    };
    const where = keepAppImagePath({ fs: fake, path, oldPath: '/a/old.AppImage', newPath: '/a/new.AppImage' });
    expect(where).toBe('/a/new.AppImage');
    expect(moves).toEqual([['/a/new.AppImage', '/a/old.AppImage'], ['/a/old.AppImage', '/a/new.AppImage']]);
  });

  it('if it cannot move, the updater\'s result stands', () => {
    const fake = { renameSync: () => { throw new Error('EXDEV'); }, symlinkSync: vi.fn() };
    expect(keepAppImagePath({ fs: fake, path, oldPath: '/a/old', newPath: '/b/new' })).toBe('/b/new');
    expect(fake.symlinkSync).not.toHaveBeenCalled();
  });

  it('is wired for an AppImage and only for an AppImage', () => {
    const listeners = (env, platform = 'linux') => {
      const on = new Map();
      initAutoUpdate({
        autoUpdater: { setFeedURL() {}, on: (e, f) => on.set(e, f), checkForUpdates: async () => {} },
        ipcMain: { handle() {} }, getWindows: () => [], isPackaged: true, platform, version: '0.6.7', env,
        config: { feedBase: FEED, assetBase: ASSETS }, getBusyReport: async () => idle, handoffBackend: async () => {},
        fs, path, log: () => {}, defer: (f) => f(),
      });
      return on.has('appimage-filename-updated');
    };
    expect(listeners({ APPIMAGE: '/home/u/AGNT-0.6.7-linux-x86_64.AppImage' })).toBe(true);
    expect(listeners({})).toBe(false); // deb/rpm: updater off
    expect(listeners({ APPIMAGE: '/x' }, 'win32')).toBe(false);
  });
});

describe('macOS: ready only once Squirrel has staged the update', () => {
  // electron-updater says "downloaded" before Squirrel.Mac has fetched, unpacked
  // and verified the update. Quitting then installs nothing (CI rehearsal, both
  // Mac architectures). The banner must not offer a restart before Squirrel is done.
  const mac = () => harness({ platform: 'darwin', native: true });

  it('downloaded -> preparing; Squirrel staged -> ready', async () => {
    const h = mac();
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(h.last()).toMatchObject({ phase: 'preparing', available: { version: '0.6.8' } });
    expect(await h.invoke('update:install')).toEqual({ ok: false, reason: 'not-ready' });
    h.emitNative('update-downloaded');
    expect(h.last()).toMatchObject({ phase: 'ready', available: { version: '0.6.8' } });
  });

  it('if Squirrel finished first, downloaded goes straight to ready', () => {
    const h = mac();
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    h.emitNative('update-downloaded');
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(h.last()).toMatchObject({ phase: 'ready' });
  });

  it('Windows and Linux are ready as soon as the download lands', () => {
    const h = harness();
    h.emit('update-available', info('0.6.8'));
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(h.last()).toMatchObject({ phase: 'ready' });
  });
});

describe('macOS: preparing always ends', () => {
  // `preparing` waits on Squirrel. When Squirrel fails, or says nothing, the
  // banner has to say so and offer a way on. It used to stay on "almost
  // ready" for good, because only Squirrel's success could end the wait.
  const preparing = () => {
    const h = harness({ platform: 'darwin', arch: 'arm64', native: true });
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(h.last()).toMatchObject({ phase: 'preparing' });
    return h;
  };
  const failed = { phase: 'error', available: { version: '0.6.8' }, error: { message: 'Could not locate update bundle', during: 'prepare' } };

  it('a Squirrel failure is reported with its reason, whichever way it arrives', () => {
    const relayed = preparing();
    relayed.emit('error', new Error('Could not locate update bundle'));
    expect(relayed.last()).toMatchObject(failed);
    expect(relayed.clocks()).toHaveLength(0);

    const direct = preparing();
    direct.emitNative('error', new Error('Could not locate update bundle'));
    expect(direct.last()).toMatchObject(failed);
    expect(direct.clocks()).toHaveLength(0);
  });

  it('the same failure arriving both ways is reported once', () => {
    const h = preparing();
    h.emit('error', new Error('Could not locate update bundle'));
    h.emitNative('error', new Error('Could not locate update bundle'));
    expect(h.sent.filter(([, s]) => s.phase === 'error')).toHaveLength(1);
  });

  it('Squirrel finding nothing to install is a failure, not a wait', () => {
    const h = preparing();
    h.emitNative('update-not-available');
    expect(h.last()).toMatchObject({ phase: 'error', error: { message: 'macOS found nothing to install.', during: 'prepare' } });
  });

  it('a Squirrel that never answers is given up on when the time runs out', () => {
    const h = preparing();
    expect(h.clocks().map((c) => c.ms)).toEqual([STAGING_LIMIT_MS]);
    h.elapse();
    expect(h.last()).toMatchObject({ phase: 'error', error: { message: 'macOS did not finish preparing the update.', during: 'prepare' } });
  });

  it('staging that finishes stops the clock', () => {
    const h = preparing();
    h.emitNative('update-downloaded');
    expect(h.last()).toMatchObject({ phase: 'ready' });
    expect(h.clocks()).toHaveLength(0);
  });

  it('staging that finishes after it was given up on is still ready', () => {
    const h = preparing();
    h.elapse();
    h.emitNative('update-downloaded');
    expect(h.last()).toMatchObject({ phase: 'ready', available: { version: '0.6.8' }, error: null });
  });

  it('a check while preparing asks nothing and changes nothing', async () => {
    const h = preparing();
    expect(await h.invoke('update:check')).toMatchObject({ phase: 'preparing' });
    expect(h.checks()).toBe(0);
    expect(h.last()).toMatchObject({ phase: 'preparing' });
  });

  it('Retry after a failure runs the whole hand-off again', async () => {
    const h = preparing();
    await settle(); // electron-updater's download promise settles
    h.emit('error', new Error('Could not locate update bundle'));
    const retry = h.invoke('update:check');
    h.emit('checking-for-update');
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2);
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(h.last()).toMatchObject({ phase: 'preparing', error: null });
    h.emitNative('update-downloaded');
    expect(await retry).toMatchObject({ phase: 'ready', error: null });
  });

  it('a hand-off electron-updater never settles does not hold up the next check', async () => {
    const h = harness({ platform: 'darwin', arch: 'arm64', native: true });
    h.autoUpdater.downloadUpdate.mockReturnValueOnce(new Promise(() => {}));
    const first = h.result.check();
    h.emit('checking-for-update');
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    h.emit('update-downloaded', { version: '0.6.8' });
    h.elapse();
    expect(await first).toMatchObject({ phase: 'error', error: { during: 'prepare' } });

    // electron-updater would only hand back the promise it still holds, so
    // Squirrel is asked for the same file again.
    const retry = h.invoke('update:check');
    h.emit('checking-for-update');
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    expect(await retry).toMatchObject({ phase: 'preparing' });
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(h.nativeUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(h.clocks()).toHaveLength(1);
    h.emitNative('update-downloaded');
    expect(h.last()).toMatchObject({ phase: 'ready', error: null });
  });

  it('asking Squirrel again and being refused is a failure, not a wait', async () => {
    const h = harness({ platform: 'darwin', arch: 'arm64', native: true });
    h.autoUpdater.downloadUpdate.mockReturnValueOnce(new Promise(() => {}));
    h.nativeUpdater.checkForUpdates.mockImplementation(() => { throw new Error('The command is disabled and cannot be executed'); });
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    h.emit('update-downloaded', { version: '0.6.8' });
    h.elapse();
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    expect(h.last()).toMatchObject({ phase: 'error', error: { message: 'The command is disabled and cannot be executed', during: 'prepare' } });
    expect(h.clocks()).toHaveLength(0);
  });

  it('a different version offered while one is still held open asks for a restart', () => {
    const h = harness({ platform: 'darwin', arch: 'arm64', native: true });
    h.autoUpdater.downloadUpdate.mockReturnValueOnce(new Promise(() => {}));
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    h.emit('update-downloaded', { version: '0.6.8' });
    h.elapse();
    h.emit('update-available', info('0.6.9', ['mac-arm64.zip']));
    expect(h.last()).toMatchObject({ phase: 'error', error: { message: 'Restart AGNT to finish updating.' } });
    expect(h.nativeUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  const handingOff = () => {
    const h = harness({ platform: 'darwin', arch: 'arm64', native: true });
    let reject;
    h.autoUpdater.downloadUpdate.mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    h.emit('update-downloaded', { version: '0.6.8' });
    return { h, reject };
  };

  it('a hand-off that fails with no word from Squirrel is reported and stops the clock', async () => {
    const { h, reject } = handingOff();
    reject(new Error('Cannot pipe the update'));
    await settle();
    expect(h.last()).toMatchObject({ phase: 'error', error: { message: 'Cannot pipe the update', during: 'download' } });
    expect(h.clocks()).toHaveLength(0);
  });

  it('the first reason reported for an attempt is the one that stays', async () => {
    const { h, reject } = handingOff();
    h.emit('error', new Error('Could not locate update bundle'));
    reject(new Error('a later, less specific failure'));
    await settle();
    expect(h.last()).toMatchObject(failed);
  });

  it('Windows and Linux start no clock', () => {
    const h = harness();
    h.emit('update-available', info('0.6.8'));
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(h.clocks()).toHaveLength(0);
  });
});

describe('macOS: an account that cannot change the Applications folder', () => {
  // Preparing an update there makes macOS ask for an administrator. That used
  // to happen in the background, about half a minute after launch, with
  // nothing in AGNT saying why; a cancel then left the banner on "almost
  // ready". Now the update is offered first and prepared only when asked for.
  const offered = (opts = {}) => {
    const h = harness({ platform: 'darwin', arch: 'arm64', native: true, standardAccount: true, ...opts });
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    h.emit('update-downloaded', { version: '0.6.8' });
    return h;
  };

  it('is offered the update without macOS being asked for anything', () => {
    const h = offered();
    expect(h.autoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(h.last()).toMatchObject({ phase: 'ready', available: { version: '0.6.8' }, needsExplicitInstall: true, needsPermission: true });
    expect(h.nativeUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(h.clocks()).toHaveLength(0);
  });

  it('an account that can change the folder is prepared in the background as before', () => {
    const h = harness({ platform: 'darwin', arch: 'arm64', native: true });
    expect(h.autoUpdater.autoInstallOnAppQuit).toBe(true);
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(h.last()).toMatchObject({ phase: 'preparing', needsExplicitInstall: false, needsPermission: false });
  });

  it('the click prepares the update first, and stops nothing until macOS has accepted it', async () => {
    const h = offered();
    expect(await h.invoke('update:install')).toEqual({ ok: true });
    expect(h.last()).toMatchObject({ phase: 'preparing', available: { version: '0.6.8' } });
    expect(h.nativeUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(h.clocks()).toHaveLength(1);
    expect(h.order).toEqual([]);
    h.emitNative('update-downloaded');
    await settle();
    expect(h.order).toEqual(['handoff', 'quitAndInstall']);
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(h.last()).toMatchObject({ phase: 'installing' });
    expect(h.clocks()).toHaveLength(0);
  });

  it('a cancelled administrator prompt is said plainly and leaves the app running', async () => {
    const h = offered();
    await h.invoke('update:install');
    h.emitNative('error', cancelledPrompt());
    expect(h.last()).toMatchObject({
      phase: 'error',
      available: { version: '0.6.8' },
      error: { message: "macOS asked for an administrator's name and password, and the request was cancelled.", during: 'prepare' },
    });
    expect(h.last().error.hint).toMatch(/Applications folder inside your home folder/);
    expect(h.order).toEqual([]);
    // Accepting the prompt after that makes the update ready; it restarts nothing.
    h.emitNative('update-downloaded');
    await settle();
    expect(h.order).toEqual([]);
    expect(h.last()).toMatchObject({ phase: 'ready', error: null });
  });

  it('Retry offers it again, and the next click asks macOS again', async () => {
    const h = offered();
    await settle();
    await h.invoke('update:install');
    h.emitNative('error', cancelledPrompt());
    const retry = h.invoke('update:check');
    h.emit('checking-for-update');
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    h.emit('update-downloaded', { version: '0.6.8' });
    expect(await retry).toMatchObject({ phase: 'ready', error: null, needsPermission: true });
    expect(await h.invoke('update:install')).toEqual({ ok: true });
    expect(h.nativeUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('running work is refused before macOS is asked for anything', async () => {
    const h = offered({ busy: { ...idle, goals: 1 } });
    expect(await h.invoke('update:install')).toMatchObject({ ok: false, reason: 'busy' });
    expect(h.nativeUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ phase: 'ready', blocked: { reason: 'busy' } });
  });

  it('Restart anyway is carried through to the backend once macOS has accepted', async () => {
    const h = offered({ busy: { ...idle, goals: 1 } });
    h.handoffBackend.mockImplementation(async (opts) => { h.order.push(`handoff:${opts.force}`); return { ok: true }; });
    expect(await h.invoke('update:install', { force: true })).toEqual({ ok: true });
    expect(h.last()).toMatchObject({ phase: 'preparing', blocked: null });
    h.emitNative('update-downloaded');
    await settle();
    expect(h.order).toEqual(['handoff:true', 'quitAndInstall']);
  });

  it('work that starts while macOS is asking postpones the install; the prepared update stays ready', async () => {
    const h = offered();
    h.handoffBackend.mockImplementation(async () => ({ ok: false, reason: 'busy', busy: { ...idle, chats: 1 } }));
    await h.invoke('update:install');
    h.emitNative('update-downloaded');
    await settle();
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ phase: 'ready', blocked: { reason: 'busy', busy: { chats: 1 } } });
    // It is prepared now, so the next click goes straight to the install.
    h.handoffBackend.mockImplementation(async () => ({ ok: true }));
    expect(await h.invoke('update:install')).toEqual({ ok: true });
    expect(h.nativeUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('a second click while macOS is asking changes nothing', async () => {
    const h = offered();
    await h.invoke('update:install');
    expect(await h.invoke('update:install')).toEqual({ ok: false, reason: 'not-ready' });
    expect(h.nativeUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('a prompt nobody answers is given up on; answering it later makes the update ready, not installed', async () => {
    const h = offered();
    await h.invoke('update:install');
    h.elapse();
    expect(h.last()).toMatchObject({ phase: 'error', error: { message: 'macOS did not finish preparing the update.', during: 'prepare' } });
    h.emitNative('update-downloaded');
    await settle();
    expect(h.order).toEqual([]);
    expect(h.last()).toMatchObject({ phase: 'ready', error: null });
  });

  it('a cancelled prompt reads the same when macOS raises it in the background', () => {
    // The check above is a judgement made before macOS makes its own. Where the
    // two disagree the prompt still arrives unasked, and still has to be explained.
    const h = harness({ platform: 'darwin', arch: 'arm64', native: true });
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    h.emit('update-downloaded', { version: '0.6.8' });
    h.emit('error', cancelledPrompt());
    expect(h.last()).toMatchObject({ phase: 'error', error: { message: "macOS asked for an administrator's name and password, and the request was cancelled.", during: 'prepare' } });
  });
});

describe('the installer to download by hand', () => {
  const at = (platform, arch, env) => manualDownloadUrl({ assetBase: ASSETS, version: '0.6.8', platform, arch, env });

  it('names the file for this machine', () => {
    expect(at('darwin', 'arm64')).toBe(url('0.6.8', 'mac-arm64.dmg'));
    expect(at('darwin', 'x64')).toBe(url('0.6.8', 'mac-x64.dmg'));
    expect(at('win32', 'x64')).toBe(url('0.6.8', 'win-x64.exe'));
    expect(at('linux', 'x64', { APPIMAGE: '/home/u/AGNT.AppImage' })).toBe(url('0.6.8', 'linux-x86_64.AppImage'));
  });

  it('is null without a version, an asset base, or a single file to point at', () => {
    expect(at('linux', 'x64', {})).toBeNull();
    expect(manualDownloadUrl({ assetBase: ASSETS, version: null, platform: 'darwin', arch: 'arm64' })).toBeNull();
    expect(manualDownloadUrl({ assetBase: '', version: '0.6.8', platform: 'darwin', arch: 'arm64' })).toBeNull();
  });

  it('travels with the state once a version is known, and not before', async () => {
    const h = harness({ platform: 'darwin', arch: 'arm64', native: true });
    expect((await h.invoke('update:state')).manualDownloadUrl).toBeNull();
    h.emit('update-available', info('0.6.8', ['mac-arm64.zip']));
    h.emit('update-downloaded', { version: '0.6.8' });
    h.emit('error', new Error('Could not locate update bundle'));
    expect(h.last().manualDownloadUrl).toBe(url('0.6.8', 'mac-arm64.dmg'));
    expect((await h.invoke('update:state')).manualDownloadUrl).toBe(url('0.6.8', 'mac-arm64.dmg'));
  });
});

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
    expect(stable.autoUpdater.allowDowngrade).toBe(true);
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

  it('a marked rollback downloads; the same version unmarked does not', () => {
    const refused = harness({ version: '0.6.8', rollbackTo: '0.6.7' });
    refused.emit('update-available', info('0.6.7'));
    expect(refused.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(refused.last()).toMatchObject({ phase: 'error', error: { during: 'verify' } });
    const h = harness({ version: '0.6.8', rollbackTo: '0.6.7' });
    h.emit('update-available', { ...info('0.6.7'), rollback: true });
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(h.last()).toMatchObject({ phase: 'downloading', available: { version: '0.6.7' } });
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
    // Silent AND relaunch. Non-silent, electron-updater drops the relaunch flag
    // and Windows shows the full setup wizard (found in the update rehearsal).
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
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
