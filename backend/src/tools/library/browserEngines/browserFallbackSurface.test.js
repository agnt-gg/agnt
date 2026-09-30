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
import { WebSocketServer } from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-bu-fallback-'));

vi.mock('../../../utils/PathManager.js', () => ({
  default: { getUserDataPath: () => tmpDir, getPath: (...p) => path.join(tmpDir, ...p) },
}));

const spawn = vi.fn();
// spawnSync is how browserStealth reads `--version` off Windows; answering
// nothing keeps the launch on its no-override path, deterministically.
vi.mock('child_process', () => ({ spawn: (...a) => spawn(...a), spawnSync: () => ({ stdout: '' }) }));

const {
  ensureFallbackSurface, closeFallbackSurface, isLoopbackWebSocket, _fallbackSessionForTests,
  findBrowser, installedBrowsers,
} = await import('./browserFallbackSurface.js');

const PROFILE = path.join(tmpDir, 'browser_control_profile');
const PORT_FILE = path.join(PROFILE, 'DevToolsActivePort');

/** Commands spawned, as { command, args }. */
let spawned;
/** Port the fake browser writes into DevToolsActivePort. */
let fakePort = 51999;
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
let previousHeadless;

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

  // Pin WHETHER THIS MACHINE HAS A DISPLAY, for exactly the reason the line
  // above pins the executable: otherwise these assertions describe the host
  // rather than this code. requiredChromeFlags() adds --headless=new wherever
  // there is no window server, so the launch args below differ by platform —
  // Windows and macOS always report a display and stayed green, Linux CI has
  // none and went red on 'stays VISIBLE'. '0' means "a desktop", which is the
  // premise of these tests; the display-less path is asserted in its own test
  // rather than left to the luck of where the suite runs.
  previousHeadless = process.env.AGNT_BROWSER_HEADLESS;
  process.env.AGNT_BROWSER_HEADLESS = '0';

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
        fs.writeFileSync(PORT_FILE, `${fakePort}\n/devtools/browser/abc-123\n`);
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
  if (previousHeadless === undefined) delete process.env.AGNT_BROWSER_HEADLESS;
  else process.env.AGNT_BROWSER_HEADLESS = previousHeadless;
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

  it('always hides the crash-restore bubble — a crashed profile must not paralyze the next launch', async () => {
    // Measured on Chrome 151: after a force-kill marks the profile crashed, a
    // HEADLESS launch on it hangs its renderer on the restore path. CDP accepts
    // connections, targets list, attach succeeds — and every page command times
    // out silently, which reads as "the stream is broken" with no error
    // anywhere. Same profile with this flag: streams a frame. Force-kills are
    // routine here (closeFallbackSurface uses taskkill), so this flag is
    // load-bearing, not cosmetic.
    await ensureFallbackSurface({ log: () => {} });
    expect(launchCalls()[0].args).toContain('--hide-crash-restore-bubble');

    closeFallbackSurface();
    spawned = [];
    await ensureFallbackSurface({ log: () => {}, hidden: true });
    expect(launchCalls()[0].args).toContain('--hide-crash-restore-bubble');
  });

  it('launches HIDDEN with a self-naming start page when asked', async () => {
    // hidden = "the stream is the window". A visible launch here put a second
    // Chrome window on the host desktop; and about:blank streams as a white
    // rectangle indistinguishable from a broken stream, so the start page
    // names itself.
    await ensureFallbackSurface({ log: () => {}, hidden: true });

    const args = launchCalls()[0].args;
    expect(args).toContain('--headless=new');
    expect(args.join(' ')).not.toContain('about:blank');
    expect(args.some((a) => a.startsWith('data:text/html'))).toBe(true);
  });

  it('a hidden launch presents like a headed browser, because headless ones get blocked', async () => {
    // MEASURED 2026-09-27: with --headless=new --disable-gpu alone, protected
    // sites (Home Depot, Lowe's, Zillow, Walmart, Etsy) served 11 of 28 pages;
    // with these flags, 24-27 of 28. The tells were navigator.webdriver, an
    // 800x600 screen, and the software WebGL renderer --disable-gpu forces.
    await ensureFallbackSurface({ log: () => {}, hidden: true });

    const args = launchCalls()[0].args;
    expect(args).toContain('--disable-blink-features=AutomationControlled');
    expect(args).toContain('--window-size=1920,1080');
    expect(args).toContain('--screen-info={1920x1080}');
    expect(args, 'on a desktop the GPU stays on: disabling it is a fingerprint').not.toContain('--disable-gpu');
    expect(args.join(' ')).not.toMatch(/HeadlessChrome/);
  });

  it('a visible launch carries none of the headless presentation flags', async () => {
    // A visible browser already reports the right UA and screen, and
    // --disable-blink-features puts an "unsupported flag" bar across it.
    await ensureFallbackSurface({ log: () => {} });

    const args = launchCalls()[0].args;
    expect(args).not.toContain('--disable-blink-features=AutomationControlled');
    expect(args.some((a) => a.startsWith('--window-size='))).toBe(false);
    expect(args.some((a) => a.startsWith('--user-agent='))).toBe(false);
  });

  it('stays VISIBLE with about:blank by default — the agent\'s window on a desktop', async () => {
    await ensureFallbackSurface({ log: () => {} });

    const args = launchCalls()[0].args;
    expect(args).not.toContain('--headless=new');
    expect(args).toContain('about:blank');
  });

  it('still goes headless where there is no display, because visible is a preference and a window server is not', async () => {
    // The machine overrules the default above, and MUST: a headed launch on a
    // box with no window server exits instantly, and the wait loop then spends
    // its full 30 seconds polling for a DevToolsActivePort that is never
    // coming — a timeout that blames the browser for a decision this code
    // made. Asserted rather than merely neutralised by the pin in beforeEach,
    // because this is the path every Linux CI runner, container and headless
    // VPS actually takes.
    process.env.AGNT_BROWSER_HEADLESS = '1';

    await ensureFallbackSurface({ log: () => {} });

    const args = launchCalls()[0].args;
    expect(args).toContain('--headless=new');
    // No display means no GPU to use: the machine keeps --disable-gpu.
    expect(args).toContain('--disable-gpu');
    // And it still presents like a headed browser.
    expect(args).toContain('--disable-blink-features=AutomationControlled');
  });

  it('reuses a live browser across a hidden/visible mismatch instead of relaunching', async () => {
    // Relaunching to honour the preference would kill a browser the OTHER
    // consumer may be mid-task in. Every browser is watchable via the stream,
    // so the preference only shapes a NEW launch.
    const first = await ensureFallbackSurface({ log: () => {} });
    const second = await ensureFallbackSurface({ log: () => {}, hidden: true });
    expect(second).toBe(first);
    expect(launchCalls()).toHaveLength(1);
  });

  it('never passes a flag that could point at the user\'s data', async () => {
    await ensureFallbackSurface({ log: () => {} });

    const joined = launchCalls()[0].args.join(' ');
    expect(joined).not.toMatch(/--profile-directory/);
    // Adopting an already-running browser is the exact thing to avoid.
    expect(joined).not.toMatch(/--remote-debugging-port=9222\b/);
  });
});

describe('a headless launch starts on a tab that has focus', () => {
  // MEASURED 2026-09-27: headless Chrome's STARTUP tab reports
  // document.hasFocus() === false and a short viewport; G2 (DataDome) blocked
  // it 3/3 and served a CDP-created tab 3/3. So the launcher swaps it.
  let wss;
  let cdpCalls;
  let targets;
  /** How many getTargets polls a closed tab survives, like real Chrome's teardown. */
  let closeLag;

  beforeEach(async () => {
    cdpCalls = [];
    closeLag = 0;
    targets = [{ targetId: 'STARTUP', type: 'page', url: 'data:...' }, { targetId: 'SW', type: 'service_worker' }];
    const dying = new Map();
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((resolve) => { wss.once('listening', resolve); });
    fakePort = wss.address().port;
    wss.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        cdpCalls.push({ method: m.method, params: m.params });
        let result = {};
        if (m.method === 'Target.createTarget') {
          targets.push({ targetId: 'FRESH', type: 'page', url: m.params.url });
          result = { targetId: 'FRESH' };
        } else if (m.method === 'Target.closeTarget') {
          // Accepted now, gone later: the ordering that exposed the race.
          dying.set(m.params.targetId, closeLag);
          result = { success: true };
        } else if (m.method === 'Target.getTargets') {
          for (const [id, polls] of dying) {
            if (polls <= 0) { targets = targets.filter((t) => t.targetId !== id); dying.delete(id); } else dying.set(id, polls - 1);
          }
          result = { targetInfos: targets.map((t) => ({ ...t })) };
        }
        socket.send(JSON.stringify({ id: m.id, result }));
      });
    });
  });

  afterEach(async () => {
    fakePort = 51999;
    for (const client of wss.clients) client.terminate();
    await new Promise((resolve) => { wss.close(resolve); });
  });

  it('opens a fresh tab on the start page, THEN closes the startup tab', async () => {
    await ensureFallbackSurface({ log: () => {}, hidden: true });

    const methods = cdpCalls.map((c) => c.method);
    expect(methods.slice(0, 3)).toEqual(['Target.getTargets', 'Target.createTarget', 'Target.closeTarget']);
    // Create before close: closing a headless browser's last tab can end it.
    expect(cdpCalls[1].params.url.startsWith('data:text/html')).toBe(true);
    // Only pages are closed — never a service worker or anything else.
    expect(cdpCalls[2].params).toEqual({ targetId: 'STARTUP' });
  });

  it('does not hand the browser over until the startup tab has actually gone', async () => {
    // closeTarget is answered when the close is ACCEPTED. Returning then left
    // the dying tab first in the list, every consumer attached to it, and its
    // first command never answered (live driver test, measured).
    closeLag = 3;
    await ensureFallbackSurface({ log: () => {}, hidden: true });

    const polls = cdpCalls.filter((c) => c.method === 'Target.getTargets');
    expect(polls.length).toBeGreaterThanOrEqual(1 + 4);
    expect(targets.filter((t) => t.type === 'page').map((t) => t.targetId)).toEqual(['FRESH']);
  });

  it('leaves a VISIBLE browser\'s tab alone — the swap is a headless fix', async () => {
    await ensureFallbackSurface({ log: () => {} });
    expect(cdpCalls).toHaveLength(0);
  });

  it('never fails a launch over it: an unreachable endpoint keeps the startup tab', async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise((resolve) => { wss.close(resolve); });
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }); // afterEach needs something to close
    await new Promise((resolve) => { wss.once('listening', resolve); });
    const logs = [];

    const url = await ensureFallbackSurface({ log: (m) => logs.push(m), hidden: true });

    expect(url).toContain(`:${fakePort}/`);
    expect(logs.some((m) => /kept the startup tab/.test(m))).toBe(true);
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

  it('FORGETS an adopted browser that has died, instead of serving it forever', async () => {
    // THE WEDGE THIS PINS (measured live 2026-09-01): an adopted session has no
    // child handle, so nothing ever told the launcher its browser died. It
    // returned the same dead endpoint to every caller, every viewer got the
    // same refused connection, and no path in the process could clear it — the
    // backend stayed wedged until a human restarted it.
    fs.mkdirSync(PROFILE, { recursive: true });
    fs.writeFileSync(PORT_FILE, '51999\n/devtools/browser/adopted-1\n');
    profileHolderIsLive(true);

    const first = await ensureFallbackSurface({ log: () => {} });
    expect(first).toBe('ws://127.0.0.1:51999/devtools/browser/adopted-1');
    expect(_fallbackSessionForTests().adopted).toBe(true);

    // The adopted browser dies. Its endpoint now refuses everything.
    globalThis.fetch.mockRestore();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('ECONNREFUSED'); });
    // Its stale port file must not resurrect it either.
    fs.writeFileSync(PORT_FILE, '51999\n/devtools/browser/adopted-1\n');

    const second = await ensureFallbackSurface({ log: () => {} });

    // A fresh browser was launched; the corpse was not served again.
    expect(launchCalls()).toHaveLength(1);
    expect(_fallbackSessionForTests().adopted).toBe(false);
    expect(second).toContain('ws://127.0.0.1:');
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
