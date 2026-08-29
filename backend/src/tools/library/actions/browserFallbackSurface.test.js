/**
 * CONTRACT: when AGNT opens a browser, it is AGNT's browser.
 *
 * This is the fallback for "no Browser widget is open". The tool used to refuse
 * in that case, because browser-harness left to itself finds a
 * DevToolsActivePort and attaches to whatever Chrome the user happens to have
 * running — their real one, with their real logged-in sessions. Refusing was an
 * over-correction: the danger is adopting THEIR browser, not opening one.
 *
 * So the properties that matter here are all about what it opens:
 *
 *   - a dedicated profile directory, never the user's, so there are no cookies,
 *     no sessions and no way to act as the signed-in human by accident;
 *   - a port Chrome chooses and writes down, read back from DevToolsActivePort,
 *     because picking one ourselves is a race we would lose silently;
 *   - one browser reused across steps, since relaunching per step would throw
 *     away the page the previous step navigated to.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-bu-fallback-'));

vi.mock('../../../utils/PathManager.js', () => ({
  default: { getUserDataPath: () => tmpDir, getPath: (...p) => path.join(tmpDir, ...p) },
}));

const spawn = vi.fn();
vi.mock('child_process', () => ({ spawn: (...a) => spawn(...a) }));

const {
  ensureFallbackSurface, closeFallbackSurface, isLoopbackWebSocket, _fallbackSessionForTests,
  findBrowser, installedBrowsers,
} = await import('./browserFallbackSurface.js');

const PROFILE = path.join(tmpDir, 'browser_control_profile');
const PORT_FILE = path.join(PROFILE, 'DevToolsActivePort');

/** Commands spawned, as { command, args }. */
let spawned;
/** How the fake browser behaves once launched. */
let browserBehaviour;

function fakeBrowser() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.killed = false;
  // Real ChildProcess methods the launcher calls. A double that is missing one
  // fails with "x is not a function" from inside the code under test, which
  // reads like a product bug and is not one.
  child.unref = vi.fn();
  child.ref = vi.fn();
  return child;
}

let previousBrowserPath;

beforeEach(() => {
  vi.clearAllMocks();
  closeFallbackSurface();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  spawned = [];
  browserBehaviour = 'writes-port-file';

  // Pin the executable so these tests assert OUR logic rather than whether the
  // machine running them happens to have Chrome installed. Any real path will
  // do — spawn is mocked, so nothing is executed.
  previousBrowserPath = process.env.AGNT_BROWSER_PATH;
  process.env.AGNT_BROWSER_PATH = process.execPath;

  spawn.mockImplementation((command, args) => {
    spawned.push({ command, args: args || [] });
    // taskkill is the teardown path, not a browser launch.
    if (/taskkill/i.test(command)) return fakeBrowser();

    const child = fakeBrowser();
    if (browserBehaviour === 'writes-port-file') {
      // What Chrome does once it is genuinely listening: port on line 1,
      // websocket path on line 2.
      setTimeout(() => {
        fs.mkdirSync(PROFILE, { recursive: true });
        fs.writeFileSync(PORT_FILE, '51999\n/devtools/browser/abc-123\n');
      }, 10);
    } else if (browserBehaviour === 'exits-immediately') {
      setTimeout(() => { child.exitCode = 1; child.emit('exit', 1); }, 10);
    }
    return child;
  });
});

afterEach(() => {
  closeFallbackSurface();
  if (previousBrowserPath === undefined) delete process.env.AGNT_BROWSER_PATH;
  else process.env.AGNT_BROWSER_PATH = previousBrowserPath;
});
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const launchCalls = () => spawned.filter((s) => !/taskkill/i.test(s.command));

describe('the browser it opens is its own', () => {
  it('uses a dedicated profile directory, not the user\'s', async () => {
    await ensureFallbackSurface({ log: () => {} });

    const args = launchCalls()[0].args;
    const profileArg = args.find((a) => a.startsWith('--user-data-dir='));
    expect(profileArg).toBe(`--user-data-dir=${PROFILE}`);
    // The whole point: a clean profile under AGNT's own data path.
    expect(profileArg).toContain('browser_control_profile');
  });

  it('lets Chrome choose the port and reads it back', async () => {
    // Picking a port ourselves is a race: something else can take it between
    // the check and the launch, and the failure is silent.
    const url = await ensureFallbackSurface({ log: () => {} });

    expect(launchCalls()[0].args).toContain('--remote-debugging-port=0');
    expect(url).toBe('ws://127.0.0.1:51999/devtools/browser/abc-123');
    expect(isLoopbackWebSocket(url)).toBe(true);
  });

  it('deletes a stale port file before launching', async () => {
    // A file left by a previous run would be read as this run's port and send
    // us to a browser that no longer exists.
    fs.mkdirSync(PROFILE, { recursive: true });
    fs.writeFileSync(PORT_FILE, '1111\n/devtools/browser/stale\n');

    const url = await ensureFallbackSurface({ log: () => {} });

    expect(url).not.toContain('1111');
    expect(url).toContain('51999');
  });

  it('never passes a flag that could point at the user\'s data', async () => {
    await ensureFallbackSurface({ log: () => {} });

    const joined = launchCalls()[0].args.join(' ');
    expect(joined).not.toMatch(/--profile-directory/);
    // Adopting an already-running browser is the exact thing to avoid.
    expect(joined).not.toMatch(/--remote-debugging-port=9222\b/);
  });
});

describe('one browser, reused', () => {
  it('does not relaunch when it is already running', async () => {
    // Relaunching per step would throw away the page the last step navigated
    // to, which is the whole point of an interactive loop.
    const first = await ensureFallbackSurface({ log: () => {} });
    const second = await ensureFallbackSurface({ log: () => {} });

    expect(second).toBe(first);
    expect(launchCalls()).toHaveLength(1);
  });

  it('shares one launch between concurrent callers', async () => {
    const [a, b, c] = await Promise.all([
      ensureFallbackSurface({ log: () => {} }),
      ensureFallbackSurface({ log: () => {} }),
      ensureFallbackSurface({ log: () => {} }),
    ]);

    expect(launchCalls()).toHaveLength(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('opens a fresh one after the previous was closed', async () => {
    await ensureFallbackSurface({ log: () => {} });
    closeFallbackSurface();

    await ensureFallbackSurface({ log: () => {} });

    expect(launchCalls()).toHaveLength(2);
  });

  it('forgets the browser when it exits on its own', async () => {
    await ensureFallbackSurface({ log: () => {} });
    const { child } = _fallbackSessionForTests();

    child.exitCode = 0;
    child.emit('exit', 0);

    expect(_fallbackSessionForTests()).toBeNull();
  });
});

describe('failure says what happened', () => {
  it('names the problem when there is no browser to launch', async () => {
    // The user can act on this one: install a browser, or point at it.
    process.env.AGNT_BROWSER_PATH = path.join(tmpDir, 'definitely-not-here.exe');
    const originalPath = process.env.PATH;
    // Blank the well-known locations by pretending nothing exists there.
    const existsSync = fs.existsSync;
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => (
      String(p).includes(tmpDir) ? existsSync(p) : false
    ));

    try {
      await expect(ensureFallbackSurface({ log: () => {} }))
        .rejects.toThrow(/no Chromium-based browser could be found/i);
    } finally {
      fs.existsSync.mockRestore();
      process.env.PATH = originalPath;
    }
  });

  it('reports a browser that exits instead of opening', async () => {
    browserBehaviour = 'exits-immediately';

    await expect(ensureFallbackSurface({ log: () => {} }))
      .rejects.toThrow(/exited immediately/i);
  });

  it('does not leave a dead session behind after a failed launch', async () => {
    browserBehaviour = 'exits-immediately';
    await expect(ensureFallbackSurface({ log: () => {} })).rejects.toThrow();

    expect(_fallbackSessionForTests()).toBeNull();
  });
});

describe('teardown', () => {
  it('kills the whole process tree, because Chrome is not one process', async () => {
    await ensureFallbackSurface({ log: () => {} });

    closeFallbackSurface();

    if (process.platform === 'win32') {
      const kill = spawned.find((s) => /taskkill/i.test(s.command));
      expect(kill, 'a browser we opened must not outlive us').toBeTruthy();
      expect(kill.args).toContain('/T');
    }
    expect(_fallbackSessionForTests()).toBeNull();
  });

  it('is safe when nothing was ever launched', () => {
    expect(() => closeFallbackSurface()).not.toThrow();
  });
});

describe('a browser that outlived AGNT', () => {
  // Chromium refuses to start a second instance on a user-data-dir another
  // process owns: it hands off and exits without rewriting DevToolsActivePort.
  // So a browser that survived a crash would break every future launch, forever,
  // until someone found and closed a window they had no reason to connect to
  // AGNT. Adopting it is safe because this profile directory is ours alone.
  function profileHolderIsLive(live) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (!live) throw new Error('ECONNREFUSED');
      return {
        ok: true,
        json: async () => ({
          Browser: 'Chrome/151.0.0.0', // what Brave, Edge and Chrome ALL report
          webSocketDebuggerUrl: 'ws://127.0.0.1:51999/devtools/browser/adopted-1',
        }),
      };
    });
  }

  /** Make exactly one browser resolvable, so findBrowser cannot pick another. */
  function onlyInstalledFor(name) {
    delete process.env.AGNT_BROWSER_PATH;
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => (
      String(p).includes(PROFILE) ? true : String(p).toLowerCase().includes(name)
    ));
  }

  afterEach(() => {
    if (globalThis.fetch.mockRestore) globalThis.fetch.mockRestore();
    if (fs.existsSync.mockRestore) fs.existsSync.mockRestore();
  });

  it('ADOPTS it instead of launching on top of it', async () => {
    fs.mkdirSync(PROFILE, { recursive: true });
    fs.writeFileSync(PORT_FILE, '51999\n/devtools/browser/adopted-1\n');
    profileHolderIsLive(true);

    const url = await ensureFallbackSurface({ log: () => {} });

    expect(url).toBe('ws://127.0.0.1:51999/devtools/browser/adopted-1');
    // Nothing was spawned: the whole point is that spawning cannot work here.
    expect(launchCalls()).toHaveLength(0);
    expect(_fallbackSessionForTests().adopted).toBe(true);
  });

  it('launches normally when the port file is stale', async () => {
    // A file left by a browser that really is gone must not strand us.
    fs.mkdirSync(PROFILE, { recursive: true });
    fs.writeFileSync(PORT_FILE, '1111\n/devtools/browser/dead\n');
    profileHolderIsLive(false);

    const url = await ensureFallbackSurface({ log: () => {} });

    expect(launchCalls()).toHaveLength(1);
    expect(url).toContain('51999'); // the freshly launched one
    expect(_fallbackSessionForTests().adopted).toBe(false);
  });

  it('REFUSES to answer "open Brave" with an adopted Chrome', async () => {
    // This shipped for about ten minutes and was caught by running it: a Chrome
    // holding the profile was adopted for a `browser: brave` request and then
    // reported as "Brave". CDP cannot tell them apart — /json/version says
    // Chrome/151 for both — so a marker file records what was actually started.
    fs.mkdirSync(PROFILE, { recursive: true });
    fs.writeFileSync(PORT_FILE, '51999\n/devtools/browser/adopted-1\n');
    fs.writeFileSync(path.join(PROFILE, 'agnt-browser.json'), JSON.stringify({ key: 'chrome', label: 'Google Chrome' }));

    let versionCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      versionCalls += 1;
      // First call identifies the holder; afterwards the port is free, which is
      // how closeOverCdp knows the old browser has released the profile.
      if (versionCalls > 1) throw new Error('ECONNREFUSED');
      return {
        ok: true,
        json: async () => ({ Browser: 'Chrome/151.0.0.0', webSocketDebuggerUrl: 'ws://127.0.0.1:51999/devtools/browser/adopted-1' }),
      };
    });
    onlyInstalledFor('brave');

    await ensureFallbackSurface({ log: () => {}, browser: 'brave' });

    // The Chrome was NOT adopted: Brave was actually launched.
    expect(launchCalls()).toHaveLength(1);
    expect(launchCalls()[0].command.toLowerCase()).toMatch(/brave/);
    expect(_fallbackSessionForTests().adopted).toBe(false);
    expect(_fallbackSessionForTests().label).toBe('Brave');
  });

  it('adopts happily when the marker says it IS the browser asked for', async () => {
    fs.mkdirSync(PROFILE, { recursive: true });
    fs.writeFileSync(PORT_FILE, '51999\n/devtools/browser/adopted-1\n');
    fs.writeFileSync(path.join(PROFILE, 'agnt-browser.json'), JSON.stringify({ key: 'brave', label: 'Brave' }));
    profileHolderIsLive(true);
    onlyInstalledFor('brave');

    const url = await ensureFallbackSurface({ log: () => {}, browser: 'brave' });

    expect(url).toBe('ws://127.0.0.1:51999/devtools/browser/adopted-1');
    expect(launchCalls()).toHaveLength(0);
    expect(_fallbackSessionForTests().label).toBe('Brave');
  });

  it('does not try to kill a browser it did not start', async () => {
    fs.mkdirSync(PROFILE, { recursive: true });
    fs.writeFileSync(PORT_FILE, '51999\n/devtools/browser/adopted-1\n');
    profileHolderIsLive(true);
    await ensureFallbackSurface({ log: () => {} });

    closeFallbackSurface();

    expect(spawned.find((s) => /taskkill/i.test(s.command))).toBeUndefined();
    expect(_fallbackSessionForTests()).toBeNull();
  });
});

describe('choosing a browser by name', () => {
  /** Pretend exactly these executables exist, and nothing else. */
  function onlyInstalled(...needles) {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => needles.some((n) => String(p).includes(n)));
  }

  afterEach(() => {
    if (fs.existsSync.mockRestore) fs.existsSync.mockRestore();
  });

  it('finds Brave when Brave is asked for, even though Chrome sorts first', () => {
    // The old flat best-first list could only ever answer "a browser", so
    // "open Brave" silently got Chrome.
    delete process.env.AGNT_BROWSER_PATH;
    onlyInstalled('chrome.exe', 'brave.exe', 'Google Chrome', 'Brave Browser', 'brave-browser');

    const found = findBrowser('brave');

    expect(found.key).toBe('brave');
    expect(found.label).toBe('Brave');
    expect(found.executable.toLowerCase()).toMatch(/brave/);
  });

  it('is case-insensitive, because people type "Brave"', () => {
    delete process.env.AGNT_BROWSER_PATH;
    onlyInstalled('brave');
    expect(findBrowser('Brave').key).toBe('brave');
  });

  it('says what IS installed when the requested browser is not', () => {
    // A dead end helps nobody; a list of real choices does.
    delete process.env.AGNT_BROWSER_PATH;
    onlyInstalled('chrome.exe', 'Google Chrome', 'google-chrome');

    expect(() => findBrowser('vivaldi')).toThrow(/Vivaldi does not appear to be installed/i);
    expect(() => findBrowser('vivaldi')).toThrow(/chrome/i);
    expect(installedBrowsers()).toContain('chrome');
  });

  it('names the ones it knows when given something it does not', () => {
    expect(() => findBrowser('netscape')).toThrow(/not a browser I know how to launch/i);
    expect(() => findBrowser('netscape')).toThrow(/brave/);
  });

  it('accepts an absolute path outright', () => {
    // Someone naming a binary knows better than any table in this file.
    const found = findBrowser(process.execPath);
    expect(found.key).toBe('custom');
    expect(found.executable).toBe(process.execPath);
  });

  it('refuses an absolute path that is not there', () => {
    expect(() => findBrowser(path.join(tmpDir, 'nope.exe'))).toThrow(/No browser executable at/i);
  });

  it('SWITCHES browsers when a different one is asked for', async () => {
    // Reusing the running browser is the right default, but not when the user
    // just named a different one.
    await ensureFallbackSurface({ log: () => {}, browser: process.execPath });
    expect(launchCalls()).toHaveLength(1);

    onlyInstalled('brave');
    await ensureFallbackSurface({ log: () => {}, browser: 'brave' });

    expect(launchCalls()).toHaveLength(2);
    expect(launchCalls()[1].command.toLowerCase()).toMatch(/brave/);
  });

  it('does NOT relaunch when the same browser is asked for twice', async () => {
    await ensureFallbackSurface({ log: () => {}, browser: process.execPath });
    await ensureFallbackSurface({ log: () => {}, browser: process.execPath });
    expect(launchCalls()).toHaveLength(1);
  });

  it('does NOT relaunch when a later call names no browser at all', async () => {
    // "just use a browser" must not evict the one already open.
    await ensureFallbackSurface({ log: () => {}, browser: process.execPath });
    await ensureFallbackSurface({ log: () => {} });
    expect(launchCalls()).toHaveLength(1);
  });

  it('reports which browser is open', async () => {
    await ensureFallbackSurface({ log: () => {}, browser: process.execPath });
    const { label } = _fallbackSessionForTests();
    expect(label).toBe(path.basename(process.execPath));
  });
});

describe('isLoopbackWebSocket', () => {
  it('accepts a launched browser\'s own devtools endpoint', () => {
    expect(isLoopbackWebSocket('ws://127.0.0.1:9222/devtools/browser/abc')).toBe(true);
  });

  it('rejects anything off this machine', () => {
    // The last gate before this string becomes a subprocess environment
    // variable.
    expect(isLoopbackWebSocket('ws://10.0.0.5:9222/devtools/browser/abc')).toBe(false);
    expect(isLoopbackWebSocket('wss://example.com/devtools/browser/abc')).toBe(false);
    expect(isLoopbackWebSocket('')).toBe(false);
    expect(isLoopbackWebSocket(null)).toBe(false);
  });
});
