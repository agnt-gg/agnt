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
        .rejects.toThrow(/No Browser widget is open and no Chrome, Chromium or Edge could be found/i);
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
