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
import fs from 'fs';
import path from 'path';
import PathManager from '../../../utils/PathManager.js';

/** The browser we launched, if it is still running. */
let session = null;
/** Shared in-flight launch, so two concurrent callers get one browser. */
let launching = null;

const PROFILE_DIR = 'browser_control_profile';

/** Where a Chromium-family browser lives, per platform, best first. */
function candidateBrowsers() {
  const env = process.env;
  if (process.platform === 'win32') {
    const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    const rel = [
      ['Google', 'Chrome', 'Application', 'chrome.exe'],
      ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
      ['Chromium', 'Application', 'chrome.exe'],
    ];
    return roots.flatMap((root) => rel.map((parts) => path.join(root, ...parts)));
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ];
}

function findBrowser() {
  const explicit = process.env.AGNT_BROWSER_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  return candidateBrowsers().find((candidate) => fs.existsSync(candidate)) || null;
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
  return Boolean(session?.child && session.child.exitCode === null && !session.child.killed);
}

/**
 * Launch a browser we own and return its CDP endpoint.
 *
 * Reused across calls: relaunching per step would throw away the page the last
 * step navigated to, which is the whole point of an interactive loop.
 */
export async function ensureFallbackSurface({ log = console.log } = {}) {
  if (isAlive() && session.cdpUrl) return session.cdpUrl;
  if (launching) return launching;

  launching = launchBrowser({ log }).finally(() => { launching = null; });
  return launching;
}

async function launchBrowser({ log }) {
  const executable = findBrowser();
  if (!executable) {
    throw new Error(
      'No Browser widget is open and no Chrome, Chromium or Edge could be found to launch instead. '
      + 'Open a Browser widget on the workspace canvas, or install a Chromium-based browser. '
      + '(Set AGNT_BROWSER_PATH to point at one explicitly.)',
    );
  }

  const profilePath = path.join(PathManager.getUserDataPath(), PROFILE_DIR);
  fs.mkdirSync(profilePath, { recursive: true });
  // A stale file from a previous run would be read as this run's port and send
  // us to a browser that no longer exists.
  try { fs.unlinkSync(path.join(profilePath, 'DevToolsActivePort')); } catch { /* not there */ }

  log(`[Browser Control] no Browser widget open; launching a clean browser at ${profilePath}`);

  const child = spawn(executable, [
    '--remote-debugging-port=0',
    `--user-data-dir=${profilePath}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Not the user's browser, so it must never try to become it.
    '--no-service-autorun',
    '--disable-features=Translate,OptimizationHints',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: false });

  child.on('error', (err) => { log(`[Browser Control] browser failed to start: ${err.message}`); });

  session = { child, cdpUrl: null, profilePath };
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
      throw new Error(`The browser exited immediately (code ${child.exitCode}) instead of opening.`);
    }
    const endpoint = readEndpoint(profilePath);
    if (endpoint) {
      session.cdpUrl = endpoint;
      log(`[Browser Control] launched browser is listening at ${endpoint}`);
      return endpoint;
    }
    // eslint-disable-next-line no-await-in-loop -- polling a file by design
    await wait(150);
  }

  closeFallbackSurface();
  throw new Error('The launched browser never reported a debugging endpoint within 30 seconds.');
}

/** Close the browser we launched. Safe to call when there is not one. */
export function closeFallbackSurface() {
  const child = session?.child;
  session = null;
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      // Chrome spawns a process tree; killing only the launcher orphans it.
      spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  } catch { /* it may already be gone */ }
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
