/**
 * The desktop scraper: scrape.agnt.gg's pipeline, run in the user's own Chrome.
 *
 * Same input, same output, same errors as the hosted API (POST /scrape/v1/scrape): one URL,
 * the formats the caller asks for (markdown by default), and a body of
 * { success, url, finalUrl, statusCode, title, formats: {<name>: {requested, success, data}},
 * isPartial, document? } or { success: false, error: <code>, message }.
 *
 * The conversion code is NOT reimplemented here: extract.js (pages) and documents.js (files)
 * are the hosted files byte for byte, vendored under ./upstream by
 * scripts/sync-scrape-upstream.mjs. This file is only the part that has to differ on a
 * desktop: no egress proxy (it runs as the user, from the user's own IP, which is why
 * scraping is local at all), and one Chrome shared by every call instead of one per call.
 * The flow mirrors upstream scrape-worker.mjs handleScrape step for step; keep it that way.
 *
 * Heavy modules (puppeteer-core, jsdom, turndown, unpdf, mammoth) load on the first scrape,
 * never at boot: backend/boot.importBudget.test.js.
 */
import { SCRAPE_FORMATS, SCRAPE_LIMITS, normalizeOperation } from './upstream/src/services/ScrapePolicy.js';
import { getBestChromePath, getChromeNotFoundMessage } from '../../utils/chrome-detector.js';

export { SCRAPE_FORMATS };

/** One sentence per error code, for the agent or the workflow user reading the failure. */
export const SCRAPE_ERROR_MESSAGES = Object.freeze({
  invalid_url: 'The URL is not a valid http(s) address.',
  invalid_formats: `formats must be one or more of: ${SCRAPE_FORMATS.join(', ')}.`,
  invalid_request: `mainContentOnly must be true or false, and waitForMs a whole number from 0 to ${SCRAPE_LIMITS.maxWaitForMs}.`,
  invalid_page_range: 'pageRange must be a page number or a range such as "2-9" that starts inside the document.',
  page_blocked: 'The site refused automated access (401, 403, 429 or a bot check).',
  page_not_found: 'The page does not exist (404 or 410).',
  destination_unavailable: 'The site could not be reached, or it returned a server error.',
  scrape_timeout: `The page or file was not loaded and converted within ${SCRAPE_LIMITS.deadlineMs / 1000} seconds.`,
  extraction_failed: 'The page or file loaded but contained no readable content.',
  result_too_large: 'The page or file is over the size limit (20 MB per file, 10 MB of page HTML).',
  unsupported_file_type: 'The URL returned a kind of file that cannot be converted.',
  pdf_images_only: 'The PDF has no text layer (a scan or pictures of text); OCR is not offered.',
  worker_unavailable: 'The file converter could not start.',
  browser_not_found: 'Chrome was not found on this computer.',
  scrape_failed: 'The scrape failed unexpectedly.',
});
const KNOWN = new Set(Object.keys(SCRAPE_ERROR_MESSAGES));

// The browser outlives a single scrape so parallel and back-to-back calls share one Chrome,
// each in its own incognito context (no cookie, cache or storage crosses between calls).
// It closes itself after this long with nothing running.
export const BROWSER_IDLE_CLOSE_MS = 60_000;

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

// Workflow editors and models send "true", "0", null; the hosted validator wants real types.
const absentIfNull = (value) => (value === null ? undefined : value);
const asBoolean = (value) => (value === 'true' ? true : value === 'false' ? false : absentIfNull(value));
const asInteger = (value) => (typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : absentIfNull(value));
const asPageRange = (value) => (typeof value === 'number' ? String(value) : absentIfNull(value));

/**
 * Validates a scrape request and returns { url, formats, mainContentOnly, waitForMs, pageRange? }.
 * Throws Error(<hosted error code>).
 */
export function normalizeScrapeInput({ url, formats, mainContentOnly, waitForMs, pageRange } = {}) {
  if (typeof url !== 'string' || !url.trim() || url.length > 4096) throw new Error('invalid_url');
  const trimmed = url.trim();
  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed);
  } catch {
    throw new Error('invalid_url');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_url');
  // The options go through the hosted validator itself, so they can never mean something
  // different here. Its URL rules (ports 80/443 only, no credentials) exist to keep a shared
  // cloud worker off internal services; this scraper runs as the user, so the URL is checked
  // above instead and the placeholder below is never fetched.
  const options = normalizeOperation('scrape', {
    url: 'https://options.invalid/',
    formats: absentIfNull(formats),
    mainContentOnly: asBoolean(mainContentOnly),
    waitForMs: asInteger(waitForMs),
    pageRange: asPageRange(pageRange),
  });
  return { ...options, url: parsed.href };
}

// ---------------------------------------------------------------------------------------------
// Shared browser
// ---------------------------------------------------------------------------------------------

let browserPromise = null;
let activeScrapes = 0;
let idleTimer = null;

async function launchBrowser() {
  const executablePath = getBestChromePath();
  if (!executablePath) throw Object.assign(new Error('browser_not_found'), { detail: getChromeNotFoundMessage() });
  const puppeteer = (await import('puppeteer-core')).default;
  return puppeteer.launch({
    executablePath,
    // 'shell' is Chrome's classic invisible headless mode. headless:true is --headless=new,
    // which flashes a visible window on Windows with Chrome 132+ (0a3ff17b).
    headless: 'shell',
    // A pipe, not a websocket: if this process dies the pipe closes and Chrome exits with it,
    // so the shared browser can never outlive the app.
    pipe: true,
    timeout: 15000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-position=-32000,-32000', '--window-size=1,1', '--lang=en-US'],
  });
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

/** A fresh incognito context; relaunches once if Chrome died since the last call. */
async function openContext() {
  for (let attempt = 0; ; attempt++) {
    const launched = sharedBrowser();
    const browser = await launched;
    try {
      return { browser, context: await browser.createBrowserContext() };
    } catch (error) {
      if (attempt > 0 || browser.connected) throw error;
      // Forget only the browser that died. Another call may already have launched its
      // replacement, and dropping THAT reference would orphan a live Chrome.
      if (browserPromise === launched) browserPromise = null;
    }
  }
}

async function closeBrowser() {
  const closing = browserPromise;
  browserPromise = null;
  const browser = await closing?.catch(() => null);
  if (!browser) return;
  // close() can hang on a wedged renderer; the kill is the backstop.
  const kill = setTimeout(() => browser.process()?.kill('SIGKILL'), 3000);
  try {
    await browser.close();
  } catch {
    browser.process()?.kill('SIGKILL');
  } finally {
    clearTimeout(kill);
  }
}

function scrapeStarted() {
  activeScrapes++;
  clearTimeout(idleTimer);
  idleTimer = null;
}

function scrapeFinished() {
  activeScrapes--;
  if (activeScrapes > 0) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (activeScrapes === 0) closeBrowser();
  }, BROWSER_IDLE_CLOSE_MS);
  idleTimer.unref?.();
}

/** Closes the shared browser now. For shutdown and tests; scrapes relaunch it on demand. */
export async function closeScrapeBrowser() {
  clearTimeout(idleTimer);
  idleTimer = null;
  await closeBrowser();
}

/** For tests: is a browser running or launching? */
export const scrapeBrowserIsOpen = () => browserPromise !== null;

// ---------------------------------------------------------------------------------------------
// The pipeline (upstream modules, loaded on first use)
// ---------------------------------------------------------------------------------------------

let pipelinePromise = null;
function pipeline() {
  pipelinePromise ??= Promise.all([
    import('./upstream/src/services/scrape/extract.js'),
    import('./upstream/src/services/scrape/documents.js'),
    import('./upstream/src/services/scrape/convert.js'),
  ]).then(([extractModule, documentsModule, convertModule]) => ({
    extract: extractModule.extract,
    blocked: extractModule.blocked,
    visibleTextLength: extractModule.visibleTextLength,
    isHtmlContentType: documentsModule.isHtmlContentType,
    detectKind: documentsModule.detectKind,
    runConversion: convertModule.runConversion,
  }));
  pipelinePromise.catch(() => {
    pipelinePromise = null;
  });
  return pipelinePromise;
}

// Upstream scrape-worker.mjs failureFor().
const failureFor = (status) =>
  status === 404 || status === 410 ? 'page_not_found'
    : [401, 403, 429].includes(status) ? 'page_blocked'
      : status >= 500 ? 'destination_unavailable'
        : status >= 400 ? 'page_blocked'
          : null;

// Upstream scrape-worker.mjs renderedHTML(): the page INCLUDING open and closed shadow roots, as
// declarative templates. page.content() omits shadow DOM, where component sites put real
// content (every MDN code example). Falls back to page.content() if the protocol call fails.
async function renderedHTML(page) {
  try {
    const cdp = await page.createCDPSession();
    try {
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'html' });
      const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId, includeShadowDOM: true });
      if (outerHTML) return '<!DOCTYPE html>' + outerHTML;
    } finally {
      await cdp.detach().catch(() => {});
    }
  } catch {
    /* fall through */
  }
  return page.content();
}

// Upstream scrape-worker.mjs download(), minus the egress proxy: a file Chrome will not display
// (Word, Excel...) or whose body it did not keep, fetched once more, bounded in bytes and time.
async function download(url, userAgent, remainingMs) {
  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': userAgent, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(Math.max(1000, remainingMs)),
    });
  } catch (error) {
    const text = String(error?.cause?.message || error?.message || '');
    throw new Error(error?.name === 'TimeoutError' || /timeout|aborted/i.test(text) ? 'scrape_timeout' : 'destination_unavailable');
  }
  const failure = failureFor(response.status);
  if (failure || Number(response.headers.get('content-length') || 0) > SCRAPE_LIMITS.fileBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(failure || 'result_too_large');
  }
  const chunks = [];
  let size = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > SCRAPE_LIMITS.fileBytes) throw new Error('result_too_large');
      chunks.push(chunk);
    }
  }
  return { bytes: Buffer.concat(chunks), contentType: response.headers.get('content-type') || '', finalUrl: response.url || url, status: response.status };
}

function codeFor(error, deadline) {
  if (deadline || error?.name === 'TimeoutError') return 'scrape_timeout';
  if (KNOWN.has(error?.message)) return error.message;
  // Chrome's own network failures: DNS, refused, reset, certificate...
  if (/net::ERR_/.test(String(error?.message))) return 'destination_unavailable';
  return 'scrape_failed';
}

function failure(code, url, started, error) {
  const detail = code === 'scrape_failed' ? ` (${error?.message || error})` : '';
  console.log(`[Web Scrape] ${code} in ${Date.now() - started}ms: ${url}${detail}`);
  const message = code === 'browser_not_found' && error?.detail ? error.detail : SCRAPE_ERROR_MESSAGES[code];
  return { success: false, error: code, message, ...(url ? { url } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Scrape
// ---------------------------------------------------------------------------------------------

/**
 * Scrapes one URL. Never throws: every failure is a { success: false, error, message } body.
 * @param {{url: string, formats?: string[]|string|object, mainContentOnly?: boolean,
 *          waitForMs?: number, pageRange?: string}} request
 */
export async function scrapeUrl(request = {}) {
  const started = Date.now();
  const remaining = () => Math.max(1, SCRAPE_LIMITS.deadlineMs - (Date.now() - started));
  let input;
  try {
    input = normalizeScrapeInput(request);
  } catch (error) {
    return failure(KNOWN.has(error.message) ? error.message : 'invalid_request', request?.url, started, error);
  }
  const { url, formats, mainContentOnly, waitForMs, pageRange } = input;

  scrapeStarted();
  let context = null;
  let deadline = false;
  // Closing the context aborts whatever it is doing; the shared browser carries on.
  const timer = setTimeout(() => {
    deadline = true;
    context?.close().catch(() => {});
  }, SCRAPE_LIMITS.deadlineMs);
  timer.unref?.();
  try {
    const { extract, blocked, visibleTextLength, isHtmlContentType, detectKind, runConversion } = await pipeline();
    const opened = await openContext();
    context = opened.context;
    if (deadline) throw new Error('scrape_timeout');
    const page = await context.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    // Report the browser we actually are. A fixed, years-old version string next to a current
    // engine is one of the cheapest bot signals there is.
    const userAgent = (await opened.browser.userAgent()).replace('HeadlessChrome', 'Chrome');
    await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    // DOM first, then a bounded settle: waiting for total network silence times out on pages
    // with analytics or long-polling.
    let navigation = null;
    let downloaded = false;
    try {
      navigation = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(SCRAPE_LIMITS.navigationMs, remaining()) });
    } catch (error) {
      // Chrome aborts a navigation it hands to its download manager (Word, Excel, zips...).
      if (!/net::ERR_ABORTED/.test(error.message)) throw error;
      downloaded = true;
    }
    const contentType = navigation?.headers()['content-type'] || '';

    if (downloaded || !isHtmlContentType(contentType)) {
      // A file, not a page: convert its bytes instead of rendering them.
      const status = navigation?.status() ?? 0;
      const refused = status ? failureFor(status) : null;
      if (refused) throw new Error(refused);
      let file = null;
      // Chrome keeps the body of files it displays, but may hand back a viewer instead of the
      // file. Use its copy only when it really is the file; otherwise fetch the original.
      if (navigation) {
        try {
          const body = await navigation.buffer();
          if (body?.length && detectKind({ contentType, url: navigation.url(), bytes: body })) {
            file = { bytes: body, contentType, finalUrl: navigation.url(), status };
          }
        } catch {
          /* fetched below */
        }
      }
      file ??= await download(navigation?.url() || url, userAgent, remaining());
      // The conversion may need the memory more than this page needs the context.
      await context.close().catch(() => {});
      context = null;
      const converted = await runConversion(file.bytes, { contentType: file.contentType, url: file.finalUrl, formats, pageRange, mainContentOnly }, { timeoutMs: remaining() });
      if (deadline) throw new Error('scrape_timeout');
      return logged({ success: true, url, finalUrl: file.finalUrl, statusCode: file.status || status || 200, title: converted.title, formats: converted.formats, isPartial: converted.isPartial, document: converted.document }, started);
    }

    await page.waitForNetworkIdle({ idleTime: 500, timeout: Math.min(6000, remaining()) }).catch(() => {});
    if (waitForMs) await new Promise((resolve) => setTimeout(resolve, Math.min(waitForMs, remaining())));
    const status = navigation?.status() ?? 0;
    if (status === 404 || status === 410) throw new Error('page_not_found');
    const html = await renderedHTML(page);
    const title = await page.title();
    if (Buffer.byteLength(html) > SCRAPE_LIMITS.documentBytes) throw new Error('result_too_large');
    // blocked() reads the visible text length only to clear a captcha marker on a page that
    // has real content. A second full DOM parse is skipped unless that is the question:
    // no marker means the answer cannot depend on the length.
    const wall = { status, title, html };
    const markerDecides = blocked({ ...wall, textLength: 0 }) && !blocked({ ...wall, textLength: Infinity });
    if (blocked({ ...wall, textLength: markerDecides ? visibleTextLength(html) : 0 })) throw new Error('page_blocked');
    if (status >= 500) throw new Error('destination_unavailable');
    if (status >= 400) throw new Error('page_blocked');

    const textual = formats.filter((name) => name !== 'screenshot' && name !== 'bytes');
    const output = textual.length ? extract(html, page.url(), { formats: textual, mainContentOnly }) : { title };
    const outputs = {};
    for (const name of textual) outputs[name] = { requested: true, success: output[name] !== undefined, data: output[name] ?? null };
    if (formats.includes('bytes')) {
      // The page exactly as the server sent it, before any script ran.
      let data = null;
      try {
        const body = await navigation.buffer();
        if (body.length <= SCRAPE_LIMITS.bytesFormatBytes) data = 'data:' + (contentType.split(';')[0].trim() || 'text/html') + ';base64,' + body.toString('base64');
      } catch {
        /* reported as unsuccessful */
      }
      outputs.bytes = { requested: true, success: data !== null, data };
    }
    if (formats.includes('screenshot')) {
      try {
        outputs.screenshot = { requested: true, success: true, data: 'data:image/jpeg;base64,' + (await page.screenshot({ type: 'jpeg', quality: 70, encoding: 'base64' })) };
      } catch {
        outputs.screenshot = { requested: true, success: false, data: null };
      }
    }
    if (deadline) throw new Error('scrape_timeout');
    if (!Object.values(outputs).some((entry) => entry.success)) throw new Error('extraction_failed');
    return logged({ success: true, url, finalUrl: page.url(), statusCode: status, title: output.title || title, formats: outputs, isPartial: Object.values(outputs).some((entry) => !entry.success) }, started);
  } catch (error) {
    return failure(codeFor(error, deadline), url, started, error);
  } finally {
    clearTimeout(timer);
    await context?.close().catch(() => {});
    scrapeFinished();
  }
}

function logged(body, started) {
  console.log(`[Web Scrape] ok in ${Date.now() - started}ms: ${body.url}${body.document ? ` (${body.document.type})` : ''}`);
  return body;
}
