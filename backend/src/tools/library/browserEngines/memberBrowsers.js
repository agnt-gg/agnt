import fs from 'fs';
import { spawn, toolRootFor } from '../../../services/security/toolProcess.js';
import { withToolActor } from '../../../services/security/toolRunAuthority.js';
import { HOSTED_CDP_PORT, hostedBrowserPaths, clearStaleProfileLocks, openCdpBridge, readBridgedEndpoint } from './hostedCdpBridge.js';
import { requiredChromeFlags } from '../../../services/browserRuntime.js';
import { headlessLaunchProfile } from './browserStealth.js';

/**
 * EACH TEAMMATE'S OWN BROWSER on a hosted instance.
 *
 * The launched browser was one per instance, holding the owner's signed-in sites, so teammates could not
 * use it at all: a tab in it, or a script driving it over CDP, reaches every cookie in it. A separate
 * browser context in that one Chrome does not fix that (CDP is browser-wide), so each teammate gets their
 * own Chromium, launched inside THEIR tool sandbox (cwd pinned to their folder, which the sandbox requires),
 * with its profile in their folder, so their logins persist and nobody else's are reachable. The debugging
 * port is reached the same way as the owner's (hostedCdpBridge.js).
 *
 * Bounded: an idle browser closes after IDLE_MS, and at most MAX_BROWSERS run at once (the least recently
 * used closes first). A Chromium costs 150-300 MB, so this is the knob if the host is small.
 */
export const IDLE_MS = 20 * 60 * 1000;
export const MAX_BROWSERS = 4;
const browsers = new Map(); // actor -> { child, bridge, cdpUrl, lastUsed, launching }
let sweeper = null;

function close(actor, reason, log) {
  const entry = browsers.get(actor);
  if (!entry) return;
  browsers.delete(actor);
  try { entry.child?.kill(); } catch { /* gone */ }
  entry.bridge?.close();
  log?.(`[Browser Control] closed ${actor}'s browser: ${reason}`);
}

function armSweeper(log) {
  if (sweeper) return;
  sweeper = setInterval(() => {
    for (const [actor, entry] of browsers) if (!entry.launching && Date.now() - entry.lastUsed >= IDLE_MS) close(actor, 'idle', log);
    if (!browsers.size) { clearInterval(sweeper); sweeper = null; }
  }, 60000);
  sweeper.unref();
}

async function launch(actor, { log, findBrowser }) {
  const root = toolRootFor(actor);
  const paths = hostedBrowserPaths(root);
  fs.mkdirSync(paths.profilePath, { recursive: true });
  clearStaleProfileLocks(paths.profilePath);
  const found = findBrowser('');
  if (!found) throw new Error('No Chromium-based browser is installed on this instance.');
  const flags = requiredChromeFlags();
  if (!flags.includes('--headless=new')) flags.push('--headless=new');
  flags.push(...headlessLaunchProfile({ executable: found.executable, key: found.key }).flags);
  try { fs.rmSync(paths.socketPath, { force: true }); } catch { /* not there */ }
  const bridge = await openCdpBridge(paths.socketPath);
  let child;
  try {
    // spawn() is toolProcess's: inside withToolActor(actor), it runs in THIS teammate's sandbox.
    child = spawn(found.executable, [
      `--remote-debugging-port=${HOSTED_CDP_PORT}`, '--disable-dev-shm-usage', `--user-data-dir=${paths.profilePath}`,
      '--no-first-run', '--no-default-browser-check', '--no-service-autorun', '--disable-features=Translate,OptimizationHints',
      '--hide-crash-restore-bubble', ...flags, 'about:blank',
    ], { stdio: 'ignore', cwd: root, env: { AGNT_TOOL_EXPOSE: `${HOSTED_CDP_PORT}=${paths.socketPath}` } });
  } catch (error) { bridge.close(); throw error; }
  child.unref();
  child.once('exit', () => { bridge.close(); if (browsers.get(actor)?.child === child) browsers.delete(actor); });
  const entry = browsers.get(actor);
  Object.assign(entry, { child, bridge });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Your browser exited immediately (code ${child.exitCode}).`);
    // eslint-disable-next-line no-await-in-loop -- polling by design
    const endpoint = await readBridgedEndpoint(bridge.port);
    if (endpoint) { log(`[Browser Control] ${actor}'s own browser is listening at ${endpoint}`); return endpoint; }
    // eslint-disable-next-line no-await-in-loop -- polling by design
    await new Promise((resolve) => { setTimeout(resolve, 150); });
  }
  throw new Error('Your browser never reported a debugging endpoint within 30 seconds.');
}

/** This teammate's browser endpoint, launching it in their sandbox on first use. */
export async function ensureMemberBrowser(actor, { log = console.log, findBrowser }) {
  const existing = browsers.get(actor);
  if (existing?.launching) return existing.launching;
  if (existing?.cdpUrl && existing.child && existing.child.exitCode === null) { existing.lastUsed = Date.now(); return existing.cdpUrl; }
  if (existing) close(actor, 'replaced', log);
  while (browsers.size >= MAX_BROWSERS) {
    const [oldest] = [...browsers.entries()].filter(([, entry]) => !entry.launching).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0] || [];
    if (!oldest) throw new Error('Too many teammates are starting browsers at once; try again in a moment.');
    close(oldest, 'making room for another teammate', log);
  }
  const entry = { child: null, bridge: null, cdpUrl: null, lastUsed: Date.now(), launching: null };
  browsers.set(actor, entry);
  entry.launching = withToolActor(actor, () => launch(actor, { log, findBrowser }))
    .then((cdpUrl) => { entry.cdpUrl = cdpUrl; entry.lastUsed = Date.now(); return cdpUrl; })
    .catch((error) => { close(actor, 'failed to start', log); throw error; })
    .finally(() => { entry.launching = null; });
  armSweeper(log);
  return entry.launching;
}

/** Diagnostics and tests: whose browsers are running. */
export function memberBrowserActors() { return [...browsers.keys()]; }
export function closeMemberBrowsers() { for (const actor of [...browsers.keys()]) close(actor, 'shutdown'); }
