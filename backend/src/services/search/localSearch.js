/**
 * Google search in the user's own Chrome, invisible, from the user's own connection.
 *
 * One query at a time through one long-lived headless Chrome, the way services/scrape/
 * localScrape.js runs the scraper, with three differences that each came out of measuring
 * Google directly (October 2026, Chrome 154, puppeteer-core 24):
 *
 *  1. A PERSISTENT profile (its own; never the user's Chrome profile, never signed in to
 *     Google). A warm cache took a search from ~15 s cold to ~0.6 s and cut its weight several
 *     times over; an incognito context per call would pay the cold cost every time.
 *  2. Chrome must not announce automation. Out of the box puppeteer leaves
 *     `navigator.webdriver = true` and the user agent says `HeadlessChrome`; Google answered
 *     /sorry/ to 6 of 6 searches that way, in both headless modes, from an IP it was serving
 *     normally the same minute. `--disable-blink-features=AutomationControlled` plus the plain
 *     Chrome user agent and client hints: 20 of 20, no window ever on screen.
 *  3. Assets are blocked at the protocol level (Network.setBlockedURLs), not by request
 *     interception: interception turns Chrome's HTTP cache off, and the cache is point 1.
 *
 * Never throws. Returns { status: 'ok', results } | { status: 'blocked' } |
 * { status: 'unavailable' | 'error', error }. The caller (searchRouter.js) decides what a
 * non-ok status means; this file never solves a captcha and never retries a refusal.
 *
 * puppeteer-core loads on the first search, never at boot (backend/boot.importBudget.test.js).
 */
import fs from 'fs';
import PathManager from '../../utils/PathManager.js';
import { getBestChromePath } from '../../utils/chrome-detector.js';
import { sandboxFlags } from '../browserRuntime.js';
import { parseSerpDocument, isGoogleRedirect, sourceOf } from './googleSerp.js';

const IDLE_CLOSE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const RESULTS_TIMEOUT_MS = 12_000;
const LINK_TIMEOUT_MS = 8_000;
/** Above this the profile is wiped at the next launch; it is a cache, not data. */
const PROFILE_MAX_BYTES = 200 * 1024 * 1024;

/**
 * Invisible ('shell' headless, the classic mode: headless:true is --headless=new, which flashes
 * a window on Windows with Chrome 132+, see localScrape.js), off-screen as a backstop, and not
 * announcing automation (point 2 above).
 */
export const SEARCH_CHROME_ARGS = Object.freeze([
  '--disable-blink-features=AutomationControlled',
  '--window-position=-32000,-32000',
  '--window-size=1,1',
  '--lang=en-US',
  // Google's results page carries speculation rules that make Chrome prefetch the top results:
  // megabytes per search of pages nobody opens.
  '--disable-features=SpeculationRulesPrefetchFuture,Prerender2,SpeculationRulesPrefetchProxy',
  '--blink-settings=prefetchEnabled=false',
]);

/** What the results page does not need: pictures, fonts, telemetry, autocomplete, async panels. */
const BLOCKED_URLS = Object.freeze([
  '*encrypted-tbn*', '*.png*', '*.jpg*', '*.jpeg*', '*.gif*', '*.webp*', '*.svg*', '*.woff*', '*.ttf*', '*.mp4*', '*/images?*',
  '*gen_204*', '*/client_204*', '*/complete/search*', '*/async/callback*', '*/async/bgasy*', '*/sgasync*',
]);

export const profileDir = () => PathManager.getDataPath('search-profile');

let browserPromise = null;
let idleTimer = null;
let queue = Promise.resolve();

function directorySize(dir) {
  let total = 0;
  const pending = [dir];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = current + '/' + entry.name;
      if (entry.isDirectory()) pending.push(full);
      else try { total += fs.statSync(full).size; } catch { /* vanished */ }
    }
  }
  return total;
}

async function launchBrowser() {
  const executablePath = getBestChromePath();
  if (!executablePath) throw Object.assign(new Error('browser_not_found'), { status: 'unavailable' });
  const userDataDir = profileDir();
  if (directorySize(userDataDir) > PROFILE_MAX_BYTES) fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'shell',
    // A pipe: if this process dies, Chrome exits with it and cannot outlive the app.
    pipe: true,
    timeout: 15000,
    userDataDir,
    args: [...sandboxFlags(), ...SEARCH_CHROME_ARGS],
  });
  const fullVersion = (await browser.version()).split('/')[1] || '';
  const major = fullVersion.split('.')[0];
  const brands = [{ brand: 'Google Chrome', version: major }, { brand: 'Chromium', version: major }, { brand: 'Not.A/Brand', version: '99' }];
  browser.searchIdentity = {
    userAgent: (await browser.userAgent()).replace('HeadlessChrome/', 'Chrome/'),
    userAgentMetadata: {
      brands,
      fullVersionList: brands.map((b) => ({ ...b, version: b.brand === 'Not.A/Brand' ? '99.0.0.0' : fullVersion })),
      fullVersion,
      platform: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
      platformVersion: '10.0.0',
      architecture: process.arch === 'arm64' ? 'arm' : 'x86',
      model: '',
      mobile: false,
      bitness: '64',
      wow64: false,
    },
  };
  return browser;
}

function sharedBrowser() {
  if (!browserPromise) {
    const launching = launchBrowser().then((browser) => {
      browser.once('disconnected', () => {
        if (browserPromise === launching) browserPromise = null;
      });
      return browser;
    });
    launching.catch(() => {
      if (browserPromise === launching) browserPromise = null;
    });
    browserPromise = launching;
  }
  return browserPromise;
}

async function closeBrowser() {
  const closing = browserPromise;
  browserPromise = null;
  const browser = await closing?.catch(() => null);
  if (!browser) return;
  const kill = setTimeout(() => browser.process()?.kill('SIGKILL'), 3000);
  try {
    await browser.close();
  } catch {
    browser.process()?.kill('SIGKILL');
  } finally {
    clearTimeout(kill);
  }
}

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => closeBrowser(), IDLE_CLOSE_MS);
  idleTimer.unref?.();
}

/** Closes the browser now. For shutdown and tests; the next search relaunches it. */
export async function closeSearchBrowser() {
  clearTimeout(idleTimer);
  idleTimer = null;
  await closeBrowser();
}

/**
 * Forgets this profile's cookies and history. Called after Google refuses a search, so the
 * next session after the cooldown does not carry the refused one's reputation.
 */
export async function resetSearchProfile() {
  await closeSearchBrowser();
  try { fs.rmSync(profileDir(), { recursive: true, force: true, maxRetries: 5 }); } catch { /* next launch recreates it */ }
}

/** Google's /goto link → the destination, via Google's own 302, with the page's cookies. */
async function resolveLink(href, cookieHeader, userAgent) {
  if (!isGoogleRedirect(href)) return sourceOf(href) ? href : null;
  try {
    const response = await fetch('https://www.google.com' + href, {
      redirect: 'manual',
      headers: { cookie: cookieHeader, 'user-agent': userAgent },
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
    });
    await response.body?.cancel();
    const location = response.headers.get('location');
    return location && sourceOf(location) ? location : null;
  } catch {
    return null;
  }
}

async function runSearch(query, count) {
  let browser;
  try {
    browser = await sharedBrowser();
  } catch (error) {
    return { status: error.status || 'error', error: error.message };
  }
  const page = await browser.newPage().catch((error) => ({ failed: error }));
  if (page.failed) return { status: 'error', error: page.failed.message };
  try {
    await page.setUserAgent(browser.searchIdentity);
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: BLOCKED_URLS });
    await page.setViewport({ width: 1366, height: 900 });

    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    // Results or a refusal, whichever comes first; neither within the window is read as-is.
    await Promise.race([
      page.waitForSelector('#rso a h3', { timeout: RESULTS_TIMEOUT_MS }),
      page.waitForFunction(() => location.pathname.startsWith('/sorry'), { timeout: RESULTS_TIMEOUT_MS }),
    ]).catch(() => {});

    // The parser takes the document as its first argument, which page.evaluate cannot pass,
    // so its source runs in the page against the page's own document.
    const parsed = await page.evaluate(`(${parseSerpDocument})(document, ${JSON.stringify(page.url())})`);
    if (parsed.blocked) return { status: 'blocked' };
    if (!parsed.results.length) return { status: 'error', error: 'no_results_parsed' };

    const cookieHeader = (await page.cookies('https://www.google.com')).map((c) => `${c.name}=${c.value}`).join('; ');
    const wanted = parsed.results.slice(0, count);
    const links = await Promise.all(wanted.map((r) => resolveLink(r.href, cookieHeader, browser.searchIdentity.userAgent)));
    const results = [];
    wanted.forEach((r, index) => {
      if (links[index]) results.push({ title: r.title, link: links[index], snippet: r.snippet || '', source: sourceOf(links[index]) });
    });
    if (!results.length) return { status: 'error', error: 'links_unresolved' };
    return { status: 'ok', results };
  } catch (error) {
    return { status: 'error', error: error.message };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * One Google search. Calls are serialised: a burst of parallel searches from one address is
 * exactly what Google flags, so they queue here instead.
 * @param {{ query: string, count: number }} input
 */
export function searchLocally({ query, count }) {
  const run = queue.then(async () => {
    clearTimeout(idleTimer);
    try {
      return await runSearch(query, count);
    } finally {
      scheduleIdleClose();
    }
  });
  queue = run.catch(() => {});
  return run;
}
