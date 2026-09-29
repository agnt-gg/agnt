/**
 * How a HEADLESS browser we launch presents itself to the sites it visits.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The hidden fallback browser is real Chrome, but out of the box headless
 * Chrome announces itself: `HeadlessChrome/<v>` in the User-Agent header and
 * navigator.userAgent, navigator.webdriver === true, an 800x600 screen that
 * equals the window, and (with --disable-gpu) Microsoft's software rasteriser
 * as the WebGL renderer. Bot-protection vendors (Akamai, PerimeterX/HUMAN,
 * DataDome, Cloudflare) read exactly those signals, so the tool that works on
 * a demo page was blocked on the sites users actually ask about.
 *
 * MEASURED 2026-09-27, Chrome 154, same residential IP, logged out, 28 pages
 * across 19 protected sites: the old flags served 11/28; the flags below
 * served 24/28 with Runtime.enable on and 25-27/28 with it off, and
 * bot.sannysoft.com went from four failures to none. The page-side half of
 * the change (no Runtime.enable by default, humanised input) lives in
 * services/browserActDriver.js.
 *
 * This is presentation, not deception of the user: the profile is still a
 * clean AGNT-owned one with no cookies, and nothing here touches the user's
 * own browser.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

/** A plausible desktop viewport. The old default (800x600) is itself a tell. */
export const HEADLESS_WINDOW = { width: 1920, height: 1080 };

/**
 * Browsers whose install layout names a directory after the CHROMIUM version
 * (first component = Chromium major). Vivaldi and Opera name it after their
 * own version, so deriving a Chrome UA from them would be wrong — they are
 * left alone rather than guessed at.
 */
const CHROMIUM_VERSIONED = new Set(['chrome', 'chromium', 'edge', 'brave', 'custom']);

const FULL_VERSION = /^(\d{2,4})\.\d+\.\d+\.\d+$/;

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 4; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Cache: an executable's version does not change while AGNT is running. */
const versionCache = new Map();

/**
 * The full Chromium version of an installed browser, or null when it cannot
 * be determined honestly.
 *
 * Windows installs keep a sibling directory named for each version
 * (…\Application\154.0.8037.57\), which is readable without executing
 * anything. Elsewhere `--version` prints it. A spawn failure is not an error:
 * the caller simply launches without a User-Agent override, which is what it
 * did before this module existed.
 */
export function detectChromiumVersion(executable, { platform = process.platform } = {}) {
  if (!executable) return null;
  if (versionCache.has(executable)) return versionCache.get(executable);

  let version = null;
  try {
    if (platform === 'win32') {
      const found = fs.readdirSync(path.dirname(executable)).filter((name) => FULL_VERSION.test(name));
      found.sort(compareVersions);
      version = found.length ? found[found.length - 1] : null;
    } else {
      const out = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      version = /(\d{2,4}\.\d+\.\d+\.\d+)/.exec(String(out?.stdout || ''))?.[1] || null;
    }
  } catch {
    version = null;
  }
  // A version below 70 is not a Chromium major (node.exe, a stray folder).
  if (version && Number(version.split('.')[0]) < 70) version = null;
  versionCache.set(executable, version);
  return version;
}

/** The frozen platform token every current Chrome sends (UA reduction). */
function platformToken(platform) {
  if (platform === 'win32') return 'Windows NT 10.0; Win64; x64';
  if (platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7';
  return 'X11; Linux x86_64';
}

/**
 * The User-Agent the same browser sends when it is NOT headless.
 *
 * Chrome's reduced UA carries only the major version (`Chrome/154.0.0.0`),
 * so the string is exact rather than approximate. Edge appends its own token.
 * Returns null for browsers whose Chromium version cannot be known.
 */
export function headedUserAgent({ key, version, platform = process.platform }) {
  if (!version || !CHROMIUM_VERSIONED.has(key)) return null;
  const major = FULL_VERSION.exec(version)?.[1];
  if (!major) return null;
  const base = `Mozilla/5.0 (${platformToken(platform)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  return key === 'edge' ? `${base} Edg/${major}.0.0.0` : base;
}

/**
 * Launch flags that make a headless browser present like the headed one.
 *
 * Only for headless launches. A visible browser already reports the right UA
 * and screen, and --disable-blink-features puts an "unsupported command-line
 * flag" bar across a visible window.
 *
 * Deliberately NOT here: --disable-gpu. With a GPU, headless Chrome reports
 * the machine's real renderer; without one it reports the software rasteriser,
 * a common bot tell. Machines with no display still get --disable-gpu from
 * services/browserRuntime.js, where there is no GPU to use anyway.
 */
export function headlessPresentationFlags({ userAgent } = {}) {
  const { width, height } = HEADLESS_WINDOW;
  const flags = [
    // navigator.webdriver = false. Automation is still fully available over CDP.
    '--disable-blink-features=AutomationControlled',
    `--window-size=${width},${height}`,
    // Headless reports screen === window unless told otherwise.
    `--screen-info={${width}x${height}}`,
  ];
  if (userAgent) flags.push(`--user-agent=${userAgent}`);
  return flags;
}

/** One call for the launcher: flags for this browser, plus what they claim, for the log. */
export function headlessLaunchProfile({ executable, key, platform = process.platform }) {
  const version = CHROMIUM_VERSIONED.has(key) ? detectChromiumVersion(executable, { platform }) : null;
  const userAgent = headedUserAgent({ key, version, platform });
  return { flags: headlessPresentationFlags({ userAgent }), userAgent, version };
}

/** Test seam. */
export function _resetVersionCacheForTests() {
  versionCache.clear();
}
