/**
 * A browser to drive when AGNT is not rendering one.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY REFUSING WAS THE WRONG ANSWER
 * ---------------------------------------------------------------------------
 * Browser Control used to fail outright when no Browser widget was open. The
 * reasoning was sound as far as it went: browser-harness, left alone, scans for
 * a DevToolsActivePort and attaches to whatever Chrome the user happens to have
 * running — their real browser, with their real logged-in sessions. A tool a
 * model can call on its own initiative must never do that.
 *
 * But "do not touch the user's browser" is not the same as "do not open one",
 * and treating them as the same made the tool fail for a reason the user could
 * do nothing useful about — including during the few seconds after a widget is
 * opened but before its bridge exists. The Browser Agent has always had the
 * honest third option: launch a CLEAN browser it owns. That is what this does.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES THIS SAFE
 * ---------------------------------------------------------------------------
 *   - A dedicated user-data directory under AGNT's own data path. Never the
 *     user's profile, so no cookies, no sessions, no history, no extensions,
 *     and no possibility of acting as the signed-in human by accident.
 *   - Launched by us, so we know its port and never have to guess which of the
 *     running Chromes is "ours".
 *   - Visible, not headless. A browser doing things on someone's behalf should
 *     be watchable; a hidden one is how automation surprises people.
 *
 * The widget is still strongly preferred — it is on the canvas, next to the
 * conversation, where the work can be seen. This is the fallback, not the plan.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PORT IS READ FROM DevToolsActivePort
 * ---------------------------------------------------------------------------
 * Picking a free port ourselves and passing it to Chrome is a race: something
 * else can take it between the check and the launch. `--remote-debugging-port=0`
 * makes Chrome choose, and it writes the result into DevToolsActivePort inside
 * the profile — port on line 1, websocket path on line 2. Reading it back is
 * race-free and is the same mechanism browser-harness itself uses.
 */

import { spawn } from 'child_process';
import { WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import PathManager from '../../../utils/PathManager.js';
import { requiredChromeFlags, shouldRunHeadless, describeRuntime } from '../../../services/browserRuntime.js';

/** The browser we launched, if it is still running. */
let session = null;
/** Shared in-flight launch, so two concurrent callers get one browser. */
let launching = null;

const PROFILE_DIR = 'browser_control_profile';

/**
 * Which browser is using the profile directory right now.
 *
 * Written at launch, read when adopting. It exists because CDP CANNOT answer
 * this question: /json/version reports `Chrome/151.0.x` for Brave, Edge and
 * Vivaldi alike, since they are all Chromium. Trusting that field made an
 * adopted Chrome answer a request for Brave and report itself as "Brave" — a
 * wrong answer delivered confidently, which is worse than a failure.
 */
const MARKER = 'agnt-browser.json';

function writeMarker(profilePath, key, label) {
  try {
    fs.writeFileSync(path.join(profilePath, MARKER), JSON.stringify({ key, label }), 'utf8');
  } catch { /* best effort: adoption degrades to "unknown", which is handled */ }
}

function readMarker(profilePath) {
  try {
    const { key, label } = JSON.parse(fs.readFileSync(path.join(profilePath, MARKER), 'utf8'));
    return key ? { key, label: label || key } : null;
  } catch {
    return null;
  }
}

/**
 * The Chromium-family browsers we know how to launch, in default preference
 * order, with where each one lives per platform.
 *
 * Keyed rather than a flat list because "open Brave" is a thing a person
 * actually says. A flat best-first list can only ever answer "a browser", so a
 * named request had no way to be expressed and Chrome won every time.
 *
 * Everything here speaks CDP, so the rest of this module does not care which
 * one is chosen — only the executable path changes.
 */
const BROWSERS = {
  chrome: {
    label: 'Google Chrome',
    win32: [['Google', 'Chrome', 'Application', 'chrome.exe']],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
  },
  brave: {
    label: 'Brave',
    win32: [['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe']],
    darwin: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    linux: ['/usr/bin/brave-browser', '/usr/bin/brave'],
  },
  edge: {
    label: 'Microsoft Edge',
    win32: [['Microsoft', 'Edge', 'Application', 'msedge.exe']],
    darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    linux: ['/usr/bin/microsoft-edge'],
  },
  vivaldi: {
    label: 'Vivaldi',
    win32: [['Vivaldi', 'Application', 'vivaldi.exe']],
    darwin: ['/Applications/Vivaldi.app/Contents/MacOS/Vivaldi'],
    linux: ['/usr/bin/vivaldi'],
  },
  opera: {
    label: 'Opera',
    win32: [['Programs', 'Opera', 'opera.exe'], ['Opera', 'opera.exe']],
    darwin: ['/Applications/Opera.app/Contents/MacOS/Opera'],
    linux: ['/usr/bin/opera'],
  },
  chromium: {
    label: 'Chromium',
    win32: [['Chromium', 'Application', 'chrome.exe']],
    darwin: ['/Applications/Chromium.app/Contents/MacOS/Chromium'],
    linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser'],
  },
};

/** Every place a given browser might be installed on this platform. */
function pathsFor(key) {
  const entry = BROWSERS[key];
  if (!entry) return [];
  if (process.platform !== 'win32') return entry[process.platform] || entry.linux || [];

  const env = process.env;
  const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
  return roots.flatMap((root) => (entry.win32 || []).map((parts) => path.join(root, ...parts)));
}

/** Which browsers are actually installed. Used to make errors actionable. */
export function installedBrowsers() {
  return Object.keys(BROWSERS).filter((key) => pathsFor(key).some((p) => fs.existsSync(p)));
}

/**
 * Resolve a request for a browser to an executable.
 *
 * @param {string} [preference] A key from BROWSERS, or an absolute path.
 * @returns {{ key: string, label: string, executable: string }}
 */
export function findBrowser(preference) {
  const wanted = String(preference || '').trim();

  // An explicit path wins outright: someone naming a binary knows what they
  // want better than any table here does.
  if (wanted && (path.isAbsolute(wanted) || wanted.includes(path.sep))) {
    if (!fs.existsSync(wanted)) throw new Error(`No browser executable at ${wanted}`);
    return { key: 'custom', label: path.basename(wanted), executable: wanted };
  }

  if (wanted) {
    const key = wanted.toLowerCase();
    const entry = BROWSERS[key];
    if (!entry) {
      throw new Error(
        `"${wanted}" is not a browser I know how to launch. Available: ${Object.keys(BROWSERS).join(', ')}, `
        + 'or give an absolute path to the executable.',
      );
    }
    const executable = pathsFor(key).find((p) => fs.existsSync(p));
    if (!executable) {
      // Naming what IS installed turns a dead end into a choice.
      const installed = installedBrowsers();
      throw new Error(
        `${entry.label} does not appear to be installed on this machine.`
        + (installed.length ? ` Installed: ${installed.join(', ')}.` : ''),
      );
    }
    return { key, label: entry.label, executable };
  }

  const override = process.env.AGNT_BROWSER_PATH;
  if (override && fs.existsSync(override)) {
    return { key: 'custom', label: path.basename(override), executable: override };
  }

  for (const key of Object.keys(BROWSERS)) {
    const executable = pathsFor(key).find((p) => fs.existsSync(p));
    if (executable) return { key, label: BROWSERS[key].label, executable };
  }
  return null;
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Read the endpoint Chrome wrote for itself.
 * @returns {string|null} ws://127.0.0.1:<port><path>, or null if not ready.
 */
function readEndpoint(profilePath) {
  try {
    const raw = fs.readFileSync(path.join(profilePath, 'DevToolsActivePort'), 'utf8');
    const [port, wsPath] = raw.split('\n').map((line) => line.trim());
    if (!port || !wsPath) return null;
    return `ws://127.0.0.1:${port}${wsPath}`;
  } catch {
    return null;
  }
}

/** Is this a loopback websocket endpoint? The only shape we will ever drive. */
export function isLoopbackWebSocket(url) {
  return typeof url === 'string' && /^ws:\/\/(127\.0\.0\.1|\[::1\]):\d+\//.test(url);
}

function isAlive() {
  if (!session) return false;
  // An ADOPTED browser has no child handle — we did not spawn this process, a
  // previous run of AGNT did. Its liveness is proven by the CDP endpoint, and
  // the step's own daemon preflight is what notices if it goes away.
  if (session.adopted) return Boolean(session.cdpUrl);
  return Boolean(session.child && session.child.exitCode === null && !session.child.killed);
}

/**
 * Is a browser from a PREVIOUS run still holding our profile directory?
 *
 * Chromium refuses to start a second instance on a user-data-dir that another
 * process already owns: the new process hands off to the running one and exits
 * immediately, without ever rewriting DevToolsActivePort. So a browser that
 * outlived AGNT — a hard crash, a killed process tree, anything that skipped
 * the exit handler — would make every future launch fail with either "exited
 * immediately" or a 30-second timeout, permanently, until someone found and
 * closed a window they had no reason to connect to AGNT.
 *
 * Adopting it is safe in a way that adopting a browser generally is not: this
 * profile directory is ours, nothing else writes to it, and the endpoint is
 * verified to be a live browser before it is trusted. It is our own process,
 * recovered — not somebody else's browser, discovered.
 *
 * @returns {Promise<string|null>} The CDP endpoint, or null if there is nothing
 *   healthy to adopt.
 */
async function findProfileHolder(profilePath) {
  const endpoint = readEndpoint(profilePath);
  if (!endpoint) return null;

  const port = /^ws:\/\/[^:]+:(\d+)\//.exec(endpoint)?.[1];
  if (!port) return null;

  // A stale port file can point at a number some unrelated process has since
  // been given, so ask what is actually there rather than trusting the file.
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const info = await response.json();
    if (!info?.Browser || !info?.webSocketDebuggerUrl) return null;

    // The marker, not info.Browser, is what identifies it. See MARKER.
    const marker = readMarker(profilePath);
    return {
      cdpUrl: info.webSocketDebuggerUrl,
      key: marker?.key || null,
      label: marker?.label || null,
      port,
    };
  } catch {
    // Nothing listening, or not a browser. The file is stale.
    return null;
  }
}

/**
 * Ask a browser to quit, over CDP.
 *
 * Used when the profile is held by a browser that is not the one being asked
 * for. `Browser.close` is the browser's own shutdown path, so the profile lock
 * is released cleanly — and it works without a child handle, which is the whole
 * problem with a process that outlived the run that started it.
 */
async function closeOverCdp(cdpUrl, port, log) {
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const socket = new WebSocket(cdpUrl, { handshakeTimeout: 2000 });
    socket.on('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Browser.close', params: {} }));
      setTimeout(() => { try { socket.close(); } catch { /* gone */ } finish(); }, 500);
    });
    socket.on('error', finish);
    socket.on('close', finish);
    setTimeout(finish, 3000);
  });

  // Wait for the port to actually free: launching while the old process still
  // holds the profile lock is the exact failure this is avoiding.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop -- polling for shutdown
      await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(700) });
    } catch {
      log('[Browser Control] the previous browser has released the profile.');
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await wait(250);
  }
  log('[Browser Control] the previous browser did not exit; launching anyway.');
}

/**
 * Launch a browser we own and return its CDP endpoint.
 *
 * Reused across calls: relaunching per step would throw away the page the last
 * step navigated to, which is the whole point of an interactive loop.
 */
export async function ensureFallbackSurface({ log = console.log, browser = '' } = {}) {
  const wanted = String(browser || '').trim().toLowerCase();

  // A DIFFERENT browser was asked for than the one already running. Naming a
  // browser is a human instruction, so it wins over the convenience of reusing
  // whatever happens to be open.
  if (isAlive() && wanted && session.browserKey !== wanted && session.requested !== wanted) {
    log(`[Browser Control] switching browser: ${session.browserKey} -> ${wanted}`);
    closeFallbackSurface();
  }

  if (isAlive() && session.cdpUrl) return session.cdpUrl;
  if (launching) return launching;

  launching = launchBrowser({ log, browser: wanted }).finally(() => { launching = null; });
  return launching;
}

async function launchBrowser({ log, browser }) {
  // Throws by name for an unknown or uninstalled request, which is more useful
  // than silently falling back to a browser nobody asked for.
  const found = findBrowser(browser);
  if (!found) {
    const installed = installedBrowsers();
    throw new Error(
      'No Browser widget is open and no Chromium-based browser could be found to launch instead. '
      + (installed.length ? `Installed: ${installed.join(', ')}. ` : '')
      + 'Install Chrome, Brave, Edge or Chromium, or set AGNT_BROWSER_PATH to point at one.',
    );
  }
  const { executable, label, key } = found;

  // A headless browser that exits immediately reports the same way as a missing
  // one, so the reason it was launched headless is recorded before it can fail.
  const headlessHere = shouldRunHeadless();

  const profilePath = path.join(PathManager.getUserDataPath(), PROFILE_DIR);
  fs.mkdirSync(profilePath, { recursive: true });

  // Before spawning: is one of ours already holding this profile? Launching on
  // top of it cannot work, so recover it instead of failing forever.
  const holder = await findProfileHolder(profilePath);
  if (holder) {
    // Only adopt when it can honestly answer the request. Adopting a Chrome to
    // satisfy "open Brave" and calling it Brave is a wrong answer stated
    // confidently, which is worse than taking a moment to do it properly.
    const satisfiesRequest = !browser || (holder.key && holder.key === key);
    if (satisfiesRequest) {
      const adoptedLabel = holder.label || label;
      log(`[Browser Control] adopting the ${adoptedLabel} already holding this profile.`);
      session = {
        child: null,
        adopted: true,
        cdpUrl: holder.cdpUrl,
        profilePath,
        browserKey: holder.key || key,
        requested: browser || holder.key || key,
        label: adoptedLabel,
      };
      return holder.cdpUrl;
    }
    log(`[Browser Control] the profile is held by ${holder.label || 'another browser'}; closing it to open ${label}.`);
    await closeOverCdp(holder.cdpUrl, holder.port, log);
  }

  // A stale file from a previous run would be read as this run's port and send
  // us to a browser that no longer exists.
  try { fs.unlinkSync(path.join(profilePath, 'DevToolsActivePort')); } catch { /* not there */ }

  // WHY THE FLAGS ARE NOT A CONSTANT.
  //
  // The header above says this browser is "visible, not headless", and on a
  // desktop that is exactly right. On a machine with no window server there is
  // nothing to be visible ON: the process exits instantly and the wait loop
  // below spends its full 30 seconds polling for a DevToolsActivePort that is
  // never coming — a timeout whose message blames the browser for a decision
  // this code made. requiredChromeFlags() returns [] on a desktop, so the
  // visible path is unchanged; see services/browserRuntime.js for why the test
  // is DISPLAY rather than container-ness.
  const runtimeFlags = requiredChromeFlags();
  log(`[Browser Control] launching a clean ${label} profile at ${profilePath} (${describeRuntime()})`);

  const child = spawn(executable, [
    '--remote-debugging-port=0',
    `--user-data-dir=${profilePath}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Not the user's browser, so it must never try to become it.
    '--no-service-autorun',
    '--disable-features=Translate,OptimizationHints',
    ...runtimeFlags,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: false });

  child.on('error', (err) => { log(`[Browser Control] browser failed to start: ${err.message}`); });
  // A browser must never be the reason a process cannot exit. The exit handler
  // below is what actually closes it; keeping a live handle on the event loop
  // as well would just stop AGNT shutting down cleanly.
  child.unref();

  // `requested` is remembered separately from `browserKey` so an explicit path
  // (key 'custom') asked for twice is not seen as a switch each time.
  session = {
    child, adopted: false, cdpUrl: null, profilePath, browserKey: key, requested: browser || key, label,
  };
  // Recorded now rather than after the port appears, so a browser that is
  // adopted mid-startup is still identifiable.
  writeMarker(profilePath, key, label);
  child.once('exit', () => {
    // Only forget the session if this exit belongs to it — a slow exit event
    // from a previous browser must not blank a newer one.
    if (session?.child === child) session = null;
  });

  // Chrome writes DevToolsActivePort once it is genuinely listening.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      session = null;
      throw new Error(
        `${label} exited immediately (code ${child.exitCode}) instead of opening`
        + `${headlessHere ? ' in headless mode' : ''}.`
        + (headlessHere ? '' : ' There may be no display available on this machine —'
          + ' set AGNT_BROWSER_HEADLESS=1 to launch without one.'),
      );
    }
    const endpoint = readEndpoint(profilePath);
    if (endpoint) {
      session.cdpUrl = endpoint;
      log(`[Browser Control] ${label} is listening at ${endpoint}`);
      return endpoint;
    }
    // eslint-disable-next-line no-await-in-loop -- polling a file by design
    await wait(150);
  }

  closeFallbackSurface();
  throw new Error(`${label} never reported a debugging endpoint within 30 seconds.`);
}

/** Close the browser we launched. Safe to call when there is not one. */
export function closeFallbackSurface() {
  const adopted = session?.adopted;
  const child = session?.child;
  session = null;
  // An adopted browser has no child handle to signal. Forgetting it is the
  // honest limit of what this can do, and it is bounded: the next launch adopts
  // the same window again rather than opening another, so at most one browser
  // ever exists for this profile.
  if (adopted || !child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      // Chrome spawns a process tree; killing only the launcher orphans it.
      spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  } catch { /* it may already be gone */ }
}

/** Which browser is currently launched, if any. */
export function launchedBrowserLabel() {
  return isAlive() ? session.label : null;
}

/** Test seam. */
export function _fallbackSessionForTests() {
  return session;
}

// A browser we opened must not outlive the app that opened it.
for (const signal of ['exit', 'SIGINT', 'SIGTERM']) {
  process.once(signal, () => closeFallbackSurface());
}

export default ensureFallbackSurface;
