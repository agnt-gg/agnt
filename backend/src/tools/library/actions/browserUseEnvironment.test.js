/**
 * CONTRACT: one Python environment, built once, shared by both browser tools.
 *
 * The Browser Agent and Browser Control install into the SAME venv. Two things
 * follow, and both are failures that would surface far from their cause:
 *
 *   - two callers arriving before the first install finishes must not both run
 *     pip against that directory. Concurrent pip on one venv leaves a
 *     half-written site-packages, and the symptom is a missing module during
 *     an unrelated browser task days later;
 *   - a venv that has the library but not the console script must be reported
 *     as exactly that, not as ENOENT from a spawn several layers up.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-bu-env-'));

vi.mock('../../../utils/PathManager.js', () => ({
  default: { getUserDataPath: () => tmpDir, getPath: (...p) => path.join(tmpDir, ...p) },
}));

const spawn = vi.fn();
vi.mock('child_process', () => ({ spawn: (...a) => spawn(...a) }));

const {
  ensureEnvironment, ensureCli, browserUsePaths, _resetEnvironmentMemo, BROWSER_USE_VERSION,
} = await import('./browserUseEnvironment.js');

/** Every spawned command, as a single string, in order. */
let commands;
/** What `importlib.metadata.version("browser-use")` currently reports. */
let installedVersion;
/** How many times pip install ran. */
let pipInstalls;

function fakeChild(stdout, delayMs = 0) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', 0);
  }, delayMs);
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetEnvironmentMemo();
  // These tests write real files into the fake venv (a stand-in interpreter, a
  // stand-in console script), and ensureVenv branches on whether the
  // interpreter exists. Without this, one test's leftover interpreter sends the
  // next one down the repair path — which reaches for the network.
  fs.rmSync(path.join(tmpDir, 'browser_use_venv'), { recursive: true, force: true });
  commands = [];
  installedVersion = '';
  pipInstalls = 0;

  spawn.mockImplementation((command, args) => {
    commands.push(`${command} ${args.join(' ')}`);

    if (args.includes('-c') && args.some((a) => a.includes('importlib.metadata'))) {
      return fakeChild(installedVersion);
    }
    if (args.includes('install')) {
      pipInstalls += 1;
      // A real install takes minutes. The delay is what opens the window a
      // second caller could race through — without it this test would pass
      // against the broken version too.
      return fakeChild('', 30);
    }
    return fakeChild('ok');
  });
});

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

/**
 * pip reports the pinned version once the install "finishes".
 *
 * Rebuilds the base behaviour rather than wrapping the CURRENT implementation,
 * so it is safe to call after a test has replaced the mock with a failing one.
 */
function installSucceeds() {
  const original = (command, args) => {
    commands.push(`${command} ${args.join(' ')}`);
    if (args.includes('-c') && args.some((a) => a.includes('importlib.metadata'))) {
      return fakeChild(installedVersion);
    }
    return fakeChild('ok');
  };
  spawn.mockImplementation((command, args) => {
    if (args.includes('install')) {
      pipInstalls += 1;
      installedVersion = BROWSER_USE_VERSION;
      return fakeChild('', 30);
    }
    return original(command, args);
  });
}

describe('two callers, one install', () => {
  it('runs pip exactly once when both tools ask at the same time', async () => {
    installSucceeds();

    const [a, b] = await Promise.all([ensureEnvironment(), ensureEnvironment()]);

    expect(pipInstalls).toBe(1);
    expect(a).toBe(b);
    expect(a).toBe(browserUsePaths().python);
  });

  it('does not spawn anything at all once the environment is ready', async () => {
    installSucceeds();
    await ensureEnvironment();
    // The memo only short-circuits when the interpreter is really there.
    fs.mkdirSync(path.dirname(browserUsePaths().python), { recursive: true });
    fs.writeFileSync(browserUsePaths().python, '');
    commands.length = 0;

    await ensureEnvironment();

    expect(commands).toEqual([]);
  });

  it('lets the NEXT caller retry after a failed install', async () => {
    // A rejected promise must not be memoised: that would turn one bad moment
    // into a permanently broken tool for the life of the process.
    //
    // Every spawn fails, not just the first: findSystemPython deliberately
    // catches and tries the next interpreter, so a single failing call is
    // swallowed by design and would not exercise the rejection path at all.
    spawn.mockImplementation(() => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => child.emit('error', new Error('nothing here')), 5);
      return child;
    });

    await expect(ensureEnvironment()).rejects.toThrow(/No Python interpreter found/);

    installSucceeds();
    await expect(ensureEnvironment()).resolves.toBe(browserUsePaths().python);
  });

  it('refuses to report success when pip installed the wrong version', async () => {
    // Silence here would mean running an unpinned browser-use and finding out
    // via a missing attribute at run time — the exact failure the pin prevents.
    spawn.mockImplementation((command, args) => {
      commands.push(`${command} ${args.join(' ')}`);
      if (args.includes('-c') && args.some((a) => a.includes('importlib.metadata'))) {
        return fakeChild(installedVersion);
      }
      if (args.includes('install')) {
        pipInstalls += 1;
        installedVersion = '0.0.1';
        return fakeChild('');
      }
      return fakeChild('ok');
    });

    await expect(ensureEnvironment()).rejects.toThrow(/but expected 0\.13\.8/);
  });
});

describe('the CLI shim is checked, not assumed', () => {
  it('explains a venv that has the library but not the console script', async () => {
    installSucceeds();
    const { cli } = browserUsePaths();
    if (fs.existsSync(cli)) fs.rmSync(cli);

    await expect(ensureCli()).rejects.toThrow(/command-line entry point is missing/);
  });

  it('returns the shim when it is there', async () => {
    installSucceeds();
    const { cli } = browserUsePaths();
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, '');

    await expect(ensureCli()).resolves.toBe(cli);
  });
});
