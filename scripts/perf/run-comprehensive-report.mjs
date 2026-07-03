#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  collectRuntimeSamples,
  getChromeMetrics,
  percentile,
  resolveAuthToken,
  resourceSummary,
} from './run-page-probe.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PAGES_FILE = path.join(__dirname, 'default-pages.json');
const DEFAULT_OUTPUT_DIR = 'perf-results';
const DEFAULT_MODES = ['cold', 'warm', 'spa', 'loop'];

const ROUTE_LABELS = {
  '/settings': 'Settings',
  '/chat': 'Chat',
  '/dashboard': 'Dashboard',
  '/agents': 'Agents',
  '/workflows': 'Workflows',
  '/tools': 'Tools',
  '/artifacts': 'Artifacts',
  '/marketplace': 'Marketplace',
  '/connectors': 'Connectors',
  '/docs': 'Docs',
};

const ROUTE_NAV_ITEMS = {
  '/chat': { primary: 'Home', secondary: 'Chat' },
  '/dashboard': { primary: 'Home', secondary: 'Dashboard' },
  '/agents': { primary: 'Assets', secondary: 'Agents' },
  '/workflows': { primary: 'Assets', secondary: 'Workflows' },
  '/tools': { primary: 'Assets', secondary: 'Tools' },
  '/goals': { primary: 'Lab', secondary: 'Goals' },
  '/traces': { primary: 'Lab', secondary: 'Traces' },
  '/skills': { primary: 'Lab', secondary: 'Skills' },
  '/memory': { primary: 'Lab', secondary: 'Memory' },
  '/experiments': { primary: 'Lab', secondary: 'Evolution' },
  '/autonomy': { primary: 'Lab', secondary: 'Autonomy' },
  '/marketplace': { primary: 'AGNT', secondary: 'Market' },
  '/connectors': { primary: 'AGNT', secondary: 'Connectors' },
  '/settings': { primary: 'AGNT', secondary: 'Account' },
};

const ROUTE_TOUR_IDS = {
  '/chat': 'sidebar.chat',
  '/dashboard': 'sidebar.dashboard',
  '/agents': 'sidebar.agents',
  '/workflows': 'sidebar.workflows',
  '/tools': 'sidebar.tools',
  '/artifacts': 'sidebar.artifacts',
  '/marketplace': 'sidebar.marketplace',
  '/connectors': 'sidebar.connect',
  '/settings': 'sidebar.settings',
};

const DIRECT_GOTO_PATHS = new Set(['/docs']);

function parseArgs(argv) {
  const options = {
    variants: [],
    runs: 1,
    loopCount: 2,
    sampleMs: 1000,
    sampleIntervalMs: 500,
    viewport: { width: 1280, height: 720 },
    waitUntil: 'networkidle',
    warmupMs: 350,
    modes: DEFAULT_MODES,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return next;
    };

    if (arg === '--variant') {
      const value = readValue();
      const separator = value.indexOf('=');
      if (separator === -1) throw new Error('--variant must look like name=http://127.0.0.1:5301');
      options.variants.push({
        name: value.slice(0, separator),
        baseUrl: value.slice(separator + 1).replace(/\/$/, ''),
      });
    } else if (arg === '--pages') options.pages = splitList(readValue());
    else if (arg === '--modes') options.modes = splitList(readValue());
    else if (arg === '--config') options.configPath = readValue();
    else if (arg === '--render-results') options.renderResultsPath = readValue();
    else if (arg === '--auth-token') options.authToken = readValue();
    else if (arg === '--auth-token-file') options.authTokenFile = readValue();
    else if (arg === '--api-base-url') options.apiBaseUrl = readValue();
    else if (arg === '--runs') options.runs = Number(readValue());
    else if (arg === '--loop-count') options.loopCount = Number(readValue());
    else if (arg === '--output') options.outputDir = readValue();
    else if (arg === '--sample-ms') options.sampleMs = Number(readValue());
    else if (arg === '--sample-interval-ms') options.sampleIntervalMs = Number(readValue());
    else if (arg === '--wait-until') options.waitUntil = readValue();
    else if (arg === '--warmup-ms') options.warmupMs = Number(readValue());
    else if (arg === '--viewport') {
      const [width, height] = readValue().split('x').map(Number);
      if (!width || !height) throw new Error('--viewport must look like 1280x720');
      options.viewport = { width, height };
    } else if (arg === '--headful') options.headless = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  options.headless = options.headless !== false;
  return options;
}

function splitList(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function usage() {
  return `Usage:
  npm run perf:comprehensive -- \\
    --variant base=http://127.0.0.1:5301 \\
    --variant lazy-loading=http://127.0.0.1:5302 \\
    --variant lazy-global-libs=http://127.0.0.1:5303 \\
    --auth-token-file ~/.agnt-test-token \\
    --api-base-url http://127.0.0.1:3333/api

Options:
  --variant NAME=URL            Variant label and running app base URL. Repeat for each variant.
  --pages /settings,/chat       Ordered app pages. Defaults to scripts/perf/default-pages.json.
  --modes cold,warm,spa,loop    Test modes. Default: ${DEFAULT_MODES.join(',')}.
  --config FILE                 JSON with variants, pages, modes, runs, loopCount, outputDir.
  --render-results FILE         Re-render an existing comprehensive-results.json without running a browser.
  --auth-token TOKEN            Seed localStorage.token before each browser context.
  --auth-token-file FILE        Read token from a local file and seed localStorage.token.
  --api-base-url URL            Seed AGNT_API_BASE_URL for static previews.
  --runs N                      Runs per mode. Default: 1.
  --loop-count N                Page cycles for loop mode. Default: 2.
  --output DIR                  Output directory. Default: ${DEFAULT_OUTPUT_DIR}.
  --sample-ms MS                Runtime memory sampling window per step. Default: 1000.
  --sample-interval-ms MS       Runtime sampling cadence. Default: 500.
  --viewport WIDTHxHEIGHT       Browser viewport. Default: 1280x720.
  --headful                     Show the browser.
`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function loadOptions(cliOptions) {
  const defaultPages = await readJson(DEFAULT_PAGES_FILE);
  const fileConfig = cliOptions.configPath ? await readJson(path.resolve(cliOptions.configPath)) : {};
  const authTokenFile = cliOptions.authTokenFile ?? fileConfig.authTokenFile;
  const authToken = cliOptions.authToken ?? fileConfig.authToken ?? (authTokenFile ? await resolveAuthToken({ authTokenFile }) : null);

  return {
    ...cliOptions,
    ...fileConfig,
    variants: cliOptions.variants.length > 0 ? cliOptions.variants : fileConfig.variants || [],
    pages: (cliOptions.pages || fileConfig.pages || defaultPages.pages).map(normalizePath),
    modes: cliOptions.modes || fileConfig.modes || DEFAULT_MODES,
    runs: cliOptions.runs ?? fileConfig.runs ?? 1,
    loopCount: cliOptions.loopCount ?? fileConfig.loopCount ?? 2,
    outputDir: cliOptions.outputDir ?? fileConfig.outputDir ?? DEFAULT_OUTPUT_DIR,
    sampleMs: cliOptions.sampleMs ?? fileConfig.sampleMs ?? 1000,
    sampleIntervalMs: cliOptions.sampleIntervalMs ?? fileConfig.sampleIntervalMs ?? 500,
    viewport: cliOptions.viewport || fileConfig.viewport || { width: 1280, height: 720 },
    headless: cliOptions.headless ?? fileConfig.headless ?? true,
    authToken,
    apiBaseUrl: cliOptions.apiBaseUrl ?? fileConfig.apiBaseUrl ?? null,
    waitUntil: cliOptions.waitUntil ?? fileConfig.waitUntil ?? 'networkidle',
    warmupMs: cliOptions.warmupMs ?? fileConfig.warmupMs ?? 350,
  };
}

function normalizePath(pagePath) {
  return pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
}

function buildUrl(baseUrl, pagePath, tag = 'comprehensive') {
  const url = new URL(normalizePath(pagePath), `${baseUrl.replace(/\/$/, '')}/`);
  url.searchParams.set('agntPerf', tag);
  url.searchParams.set('t', Date.now().toString(36));
  return url.toString();
}

async function installObservers(page) {
  await page.addInitScript(() => {
    window.__agntPerf = {
      longTasks: [],
      layoutShifts: [],
      lcpEntries: [],
      eventTimings: [],
    };

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__agntPerf.longTasks.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      window.__agntPerf.longTasksUnsupported = true;
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            window.__agntPerf.layoutShifts.push({
              startTime: entry.startTime,
              value: entry.value,
            });
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      window.__agntPerf.layoutShiftUnsupported = true;
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__agntPerf.lcpEntries.push({
            startTime: entry.startTime,
            renderTime: entry.renderTime || 0,
            loadTime: entry.loadTime || 0,
            size: entry.size || 0,
            url: entry.url || '',
            element: entry.element?.tagName || '',
          });
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      window.__agntPerf.lcpUnsupported = true;
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__agntPerf.eventTimings.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
            processingStart: entry.processingStart,
            processingEnd: entry.processingEnd,
            interactionId: entry.interactionId || 0,
          });
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch {
      window.__agntPerf.eventTimingUnsupported = true;
    }
  });
}

async function seedContext(page, options) {
  if (options.authToken) {
    await page.addInitScript((token) => {
      window.localStorage.setItem('token', token);
      window.localStorage.setItem('hasCompletedOnboarding', 'true');
      window.localStorage.setItem('tours_enabled', 'false');
      window.localStorage.setItem('tours_auto_start', 'false');
    }, options.authToken);
  }
  if (options.apiBaseUrl) {
    await page.addInitScript((apiBaseUrl) => {
      window.localStorage.setItem('AGNT_API_BASE_URL', apiBaseUrl);
    }, options.apiBaseUrl);
  }
}

async function createPage(options, { disableCache = false } = {}) {
  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({
    viewport: options.viewport,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('Performance.enable').catch(() => null);
  if (disableCache) {
    await cdpSession.send('Network.enable').catch(() => null);
    await cdpSession.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => null);
  }
  await installObservers(page);
  await seedContext(page, options);
  return { browser, context, page, cdpSession };
}

async function resetStepPerformance(page) {
  await page.evaluate(() => {
    performance.clearResourceTimings();
    window.__agntPerf = window.__agntPerf || {};
    window.__agntPerf.longTasks = [];
    window.__agntPerf.layoutShifts = [];
    window.__agntPerf.lcpEntries = [];
    window.__agntPerf.eventTimings = [];
  }).catch(() => null);
}

function attachErrorCollectors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText || 'unknown',
    });
  });
  return { consoleErrors, pageErrors, failedRequests };
}

async function waitForSettledPage(page, options, expectedPath = null) {
  if (expectedPath) {
    await page.waitForFunction((pathname) => location.pathname === pathname, expectedPath, { timeout: 15000 }).catch(() => null);
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null);
  if (options.waitUntil === 'networkidle') {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
  }
  if (options.warmupMs > 0) await page.waitForTimeout(options.warmupMs);
}

async function navigateDirect(page, variant, pagePath, options, tag) {
  await page.goto(buildUrl(variant.baseUrl, pagePath, tag), { waitUntil: options.waitUntil, timeout: 60000 });
}

async function navigateInApp(page, pagePath, options) {
  const label = ROUTE_LABELS[pagePath] || pagePath.replace(/^\//, '');
  const navItem = ROUTE_NAV_ITEMS[pagePath];
  const tourId = ROUTE_TOUR_IDS[pagePath];
  const beforePath = await page.evaluate(() => location.pathname).catch(() => '');
  const currentUrl = page.url();

  await page.getByRole('button', { name: /Skip Tour/i }).click({ timeout: 1000 }).catch(() => null);

  try {
    const routeLink = page.locator(`a[href="${pagePath}"]`).first();
    await routeLink.click({ timeout: 2500 });
    await page.waitForFunction((pathname) => location.pathname === pathname, pagePath, { timeout: 15000 });
    return beforePath === pagePath ? 'same-route-link' : 'route-link';
  } catch {
    // Not every AGNT shell renders RouterLinks. The terminal shell uses
    // primary/secondary button groups, so drive those before synthetic fallbacks.
  }

  if (tourId) {
    try {
      await page.locator(`[data-tour-id="${tourId}"]`).click({ timeout: 5000 });
      await page.waitForFunction((pathname) => location.pathname === pathname, pagePath, { timeout: 15000 });
      return beforePath === pagePath ? 'same-route-sidebar' : 'sidebar';
    } catch {
      // Continue to older navigation shell fallbacks below.
    }
  }

  if (navItem) {
    try {
      await page.getByRole('button', { name: navItem.primary, exact: true }).click({ timeout: 2500 });
      await page.getByRole('button', { name: navItem.secondary, exact: true }).click({ timeout: 5000 });
      await page.waitForFunction((pathname) => location.pathname === pathname, pagePath, { timeout: 15000 });
      return beforePath === pagePath ? 'same-route-nav-button' : 'nav-button';
    } catch {
      // Continue to text/history/direct fallbacks below.
    }
  }

  if (DIRECT_GOTO_PATHS.has(pagePath)) {
    await page.goto(new URL(pagePath, currentUrl).toString(), { waitUntil: options.waitUntil, timeout: 60000 });
    return 'direct-route';
  }

  try {
    await page.getByText(label, { exact: true }).first().click({ timeout: 5000 });
    await page.waitForFunction((pathname) => location.pathname === pathname, pagePath, { timeout: 15000 });
    return beforePath === pagePath ? 'same-route-text' : 'text';
  } catch {
    try {
      await page.evaluate((pathname) => {
        history.pushState({}, '', pathname);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, pagePath);
      await page.waitForFunction((pathname) => location.pathname === pathname, pagePath, { timeout: 5000 });
      return 'history-fallback';
    } catch {
      await page.goto(new URL(pagePath, currentUrl).toString(), { waitUntil: options.waitUntil, timeout: 60000 });
      return 'goto-fallback';
    }
  }
}

async function collectStepData(page) {
  return page.evaluate(() => {
    const perf = window.__agntPerf || {};
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      transferSize: entry.transferSize || 0,
      encodedBodySize: entry.encodedBodySize || 0,
      decodedBodySize: entry.decodedBodySize || 0,
      startTime: entry.startTime || 0,
      duration: entry.duration || 0,
    }));
    const navigation = performance.getEntriesByType('navigation')[0];
    const paints = Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime]));
    const longTasks = perf.longTasks || [];
    const layoutShifts = perf.layoutShifts || [];
    const lcpEntries = perf.lcpEntries || [];
    const eventTimings = perf.eventTimings || [];
    const lcp = lcpEntries[lcpEntries.length - 1] || null;

    return {
      title: document.title,
      url: location.href,
      pathname: location.pathname,
      readyState: document.readyState,
      bodyTextSample: document.body?.innerText?.slice(0, 300) || '',
      dom: {
        elements: document.getElementsByTagName('*').length,
        scripts: document.scripts.length,
        stylesheets: document.styleSheets.length,
      },
      navigation: navigation
        ? {
            type: navigation.type,
            fetchStart: navigation.fetchStart,
            responseStart: navigation.responseStart,
            responseEnd: navigation.responseEnd,
            domInteractive: navigation.domInteractive,
            domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
            domComplete: navigation.domComplete,
            loadEventEnd: navigation.loadEventEnd,
            duration: navigation.duration,
            transferSize: navigation.transferSize || 0,
            decodedBodySize: navigation.decodedBodySize || 0,
          }
        : null,
      resources,
      longTasks,
      layoutShifts,
      lcpEntries,
      eventTimings,
      cumulativeLayoutShift: layoutShifts.reduce((total, entry) => total + entry.value, 0),
      heap: performance.memory
        ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          }
        : null,
      webVitalsApprox: {
        fcp: paints['first-contentful-paint'] || null,
        lcp: lcp ? lcp.startTime || lcp.renderTime || lcp.loadTime || null : null,
        cls: layoutShifts.reduce((total, entry) => total + entry.value, 0),
        longTaskCount: longTasks.length,
        totalBlockingTime: longTasks.reduce((total, task) => total + Math.max(0, task.duration - 50), 0),
        eventTimingCount: eventTimings.length,
        maxEventDuration: eventTimings.reduce((max, entry) => Math.max(max, entry.duration || 0), 0),
      },
    };
  });
}

async function measureStep({ page, cdpSession, variant, mode, pagePath, runIndex, iteration, sequence, action, options, tag }) {
  await resetStepPerformance(page);
  const errors = page.__agntErrors;
  const consoleStart = errors.consoleErrors.length;
  const pageErrorStart = errors.pageErrors.length;
  const failedRequestStart = errors.failedRequests.length;

  const startedAt = Date.now();
  const startPerf = await page.evaluate(() => performance.now()).catch(() => 0);
  const actionResult = await action();
  await waitForSettledPage(page, options, pagePath);
  const endPerf = await page.evaluate(() => performance.now()).catch(() => 0);
  const wallTimeMs = Date.now() - startedAt;

  const samples = await collectRuntimeSamples(page, cdpSession, options.sampleMs, options.sampleIntervalMs);
  const finalChromeMetrics = await getChromeMetrics(cdpSession);
  const pageData = await collectStepData(page);
  pageData.webVitalsApprox.p95LongTaskMs = percentile(pageData.longTasks.map((task) => task.duration), 95);

  return {
    measuredAt: new Date().toISOString(),
    variant: variant.name,
    mode,
    runIndex,
    iteration,
    sequence,
    pagePath,
    tag,
    navigationMethod: actionResult?.navigationMethod || actionResult || 'unknown',
    wallTimeMs,
    perfTimeMs: endPerf && startPerf ? endPerf - startPerf : null,
    ...pageData,
    resourcesSummary: resourceSummary(pageData.resources),
    samples,
    finalChromeMetrics,
    consoleErrors: errors.consoleErrors.slice(consoleStart),
    pageErrors: errors.pageErrors.slice(pageErrorStart),
    failedRequests: errors.failedRequests.slice(failedRequestStart),
  };
}

async function preparePageForMode(options, disableCache = false) {
  const handles = await createPage(options, { disableCache });
  handles.page.__agntErrors = attachErrorCollectors(handles.page);
  return handles;
}

async function runColdMode(variant, options, runIndex, sequenceStart) {
  const steps = [];
  let sequence = sequenceStart;
  for (const pagePath of options.pages) {
    const handles = await preparePageForMode(options, true);
    const step = await measureStep({
      ...handles,
      variant,
      mode: 'cold',
      pagePath,
      runIndex,
      iteration: 1,
      sequence: sequence++,
      options,
      tag: 'cold',
      action: async () => {
        await navigateDirect(handles.page, variant, pagePath, options, 'cold');
        return { navigationMethod: 'cold-goto' };
      },
    });
    steps.push(step);
    await handles.browser.close();
  }
  return { steps, sequence };
}

async function runWarmMode(variant, options, runIndex, sequenceStart) {
  const steps = [];
  let sequence = sequenceStart;
  const handles = await preparePageForMode(options, false);
  for (const pagePath of options.pages) {
    await navigateDirect(handles.page, variant, pagePath, options, 'warm-prime');
    await waitForSettledPage(handles.page, options, pagePath);
    const step = await measureStep({
      ...handles,
      variant,
      mode: 'warm',
      pagePath,
      runIndex,
      iteration: 1,
      sequence: sequence++,
      options,
      tag: 'warm',
      action: async () => {
        await handles.page.reload({ waitUntil: options.waitUntil, timeout: 60000 });
        return { navigationMethod: 'warm-reload' };
      },
    });
    steps.push(step);
  }
  await handles.browser.close();
  return { steps, sequence };
}

async function runSpaMode(variant, options, runIndex, sequenceStart) {
  const handles = await preparePageForMode(options, false);
  let sequence = sequenceStart;
  const steps = [];
  const firstPage = options.pages[0];
  await navigateDirect(handles.page, variant, firstPage, options, 'spa-start');
  await waitForSettledPage(handles.page, options, firstPage);

  for (const pagePath of options.pages) {
    const step = await measureStep({
      ...handles,
      variant,
      mode: 'spa',
      pagePath,
      runIndex,
      iteration: 1,
      sequence: sequence++,
      options,
      tag: 'spa',
      action: async () => ({ navigationMethod: await navigateInApp(handles.page, pagePath, options) }),
    });
    steps.push(step);
  }

  await handles.browser.close();
  return { steps, sequence };
}

async function runLoopMode(variant, options, runIndex, sequenceStart) {
  const handles = await preparePageForMode(options, false);
  let sequence = sequenceStart;
  const steps = [];
  const firstPage = options.pages[0];
  await navigateDirect(handles.page, variant, firstPage, options, 'loop-start');
  await waitForSettledPage(handles.page, options, firstPage);

  for (let iteration = 1; iteration <= options.loopCount; iteration += 1) {
    for (const pagePath of options.pages) {
      const step = await measureStep({
        ...handles,
        variant,
        mode: 'loop',
        pagePath,
        runIndex,
        iteration,
        sequence: sequence++,
        options,
        tag: 'loop',
        action: async () => ({ navigationMethod: await navigateInApp(handles.page, pagePath, options) }),
      });
      steps.push(step);
    }
  }

  await handles.browser.close();
  return { steps, sequence };
}

async function runVariant(variant, options) {
  const runs = [];
  let sequence = 1;
  for (let runIndex = 1; runIndex <= options.runs; runIndex += 1) {
    const steps = [];
    for (const mode of options.modes) {
      console.log(`[perf:comprehensive] ${variant.name} ${mode} run ${runIndex}/${options.runs}`);
      let result;
      if (mode === 'cold') result = await runColdMode(variant, options, runIndex, sequence);
      else if (mode === 'warm') result = await runWarmMode(variant, options, runIndex, sequence);
      else if (mode === 'spa') result = await runSpaMode(variant, options, runIndex, sequence);
      else if (mode === 'loop') result = await runLoopMode(variant, options, runIndex, sequence);
      else throw new Error(`Unknown mode: ${mode}`);
      sequence = result.sequence;
      steps.push(...result.steps);
    }
    runs.push({ variant: variant.name, runIndex, steps });
  }
  return runs;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
  const filtered = values.filter(Number.isFinite);
  if (!filtered.length) return 0;
  return filtered.reduce((total, value) => total + value, 0) / filtered.length;
}

function finalSample(step) {
  return step.samples[step.samples.length - 1] || {};
}

function heapMb(step) {
  return (finalSample(step).cdp?.jsHeapUsedSize || step.heap?.usedJSHeapSize || 0) / 1024 / 1024;
}

function stepErrorCount(step) {
  return step.consoleErrors.length + step.pageErrors.length + step.failedRequests.length;
}

function summarize(variantRuns) {
  const steps = variantRuns.flatMap((run) => run.steps);
  const groups = new Map();
  for (const step of steps) {
    const key = `${step.variant}\t${step.mode}\t${step.pagePath}`;
    const group = groups.get(key) || [];
    group.push(step);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => {
    const [variant, mode, pagePath] = key.split('\t');
    return {
      variant,
      mode,
      pagePath,
      runs: group.length,
      medianWallMs: median(group.map((step) => step.wallTimeMs)),
      medianPerfMs: median(group.map((step) => step.perfTimeMs || 0)),
      medianFcpMs: median(group.map((step) => step.webVitalsApprox.fcp || 0)),
      medianLcpMs: median(group.map((step) => step.webVitalsApprox.lcp || 0)),
      medianCls: median(group.map((step) => step.webVitalsApprox.cls || 0)),
      medianTbtMs: median(group.map((step) => step.webVitalsApprox.totalBlockingTime || 0)),
      averageLongTaskCount: average(group.map((step) => step.webVitalsApprox.longTaskCount || 0)),
      maxEventDurationMs: Math.max(0, ...group.map((step) => step.webVitalsApprox.maxEventDuration || 0)),
      medianTransferKb: median(group.map((step) => step.resourcesSummary.totalTransferSize / 1024)),
      medianDecodedKb: median(group.map((step) => step.resourcesSummary.totalDecodedBodySize / 1024)),
      medianResourceCount: median(group.map((step) => step.resourcesSummary.totalCount)),
      medianDomElements: median(group.map((step) => step.dom.elements)),
      medianHeapMb: median(group.map(heapMb)),
      maxHeapMb: Math.max(0, ...group.flatMap((step) => step.samples.map((sample) => (sample.cdp?.jsHeapUsedSize || sample.heap?.usedJSHeapSize || 0) / 1024 / 1024))),
      errorCount: group.reduce((total, step) => total + stepErrorCount(step), 0),
      navigationMethods: [...new Set(group.map((step) => step.navigationMethod))].join(', '),
    };
  });
}

function csvEscape(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const headers = [
    'variant',
    'mode',
    'pagePath',
    'runs',
    'medianWallMs',
    'medianFcpMs',
    'medianLcpMs',
    'medianCls',
    'medianTbtMs',
    'medianTransferKb',
    'medianResourceCount',
    'medianDomElements',
    'medianHeapMb',
    'maxHeapMb',
    'errorCount',
    'navigationMethods',
  ];
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n');
}

function round(value, digits = 1) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMetric(value, unit = '', digits = 1) {
  return `${round(value, digits).toLocaleString()}${unit}`;
}

function variants(rows) {
  return [...new Set(rows.map((row) => row.variant))];
}

function modes(rows) {
  return [...new Set(rows.map((row) => row.mode))];
}

function pages(rows) {
  return [...new Set(rows.map((row) => row.pagePath))];
}

function colorForVariant(variant, names) {
  const colors = ['#2563eb', '#059669', '#dc2626', '#7c3aed', '#ea580c', '#0891b2'];
  const index = Math.max(0, names.indexOf(variant));
  return colors[index % colors.length];
}

function aggregateByVariantMode(rows) {
  const totals = new Map();
  for (const row of rows) {
    const key = `${row.variant}\t${row.mode}`;
    const total = totals.get(key) || {
      variant: row.variant,
      mode: row.mode,
      totalWallMs: 0,
      totalTransferKb: 0,
      totalErrors: 0,
      avgHeapMb: 0,
      maxHeapMb: 0,
      pages: 0,
    };
    total.totalWallMs += row.medianWallMs;
    total.totalTransferKb += row.medianTransferKb;
    total.totalErrors += row.errorCount;
    total.avgHeapMb += row.medianHeapMb;
    total.maxHeapMb = Math.max(total.maxHeapMb, row.maxHeapMb);
    total.pages += 1;
    totals.set(key, total);
  }
  return [...totals.values()].map((total) => ({
    ...total,
    avgHeapMb: total.pages ? total.avgHeapMb / total.pages : 0,
  }));
}

function renderMetricCards(rows) {
  const totals = aggregateByVariantMode(rows);
  const byVariant = new Map();
  for (const total of totals) {
    const bucket = byVariant.get(total.variant) || {
      variant: total.variant,
      totalWallMs: 0,
      totalTransferKb: 0,
      totalErrors: 0,
      avgHeapMb: 0,
      maxHeapMb: 0,
      count: 0,
    };
    bucket.totalWallMs += total.totalWallMs;
    bucket.totalTransferKb += total.totalTransferKb;
    bucket.totalErrors += total.totalErrors;
    bucket.avgHeapMb += total.avgHeapMb;
    bucket.maxHeapMb = Math.max(bucket.maxHeapMb, total.maxHeapMb);
    bucket.count += 1;
    byVariant.set(total.variant, bucket);
  }
  const cards = [...byVariant.values()].map((card) => ({
    ...card,
    avgHeapMb: card.count ? card.avgHeapMb / card.count : 0,
  }));
  const bestWall = Math.min(...cards.map((row) => row.totalWallMs));
  const bestTransfer = Math.min(...cards.map((row) => row.totalTransferKb));
  const bestHeap = Math.min(...cards.map((row) => row.avgHeapMb));
  const bestMaxHeap = Math.min(...cards.map((row) => row.maxHeapMb));

  return `<section class="metric-grid" aria-label="Summary metrics">
    ${cards
      .map(
        (row) => `<article class="metric-card">
          <h2>${escapeHtml(row.variant)}</h2>
          <dl>
            <div class="${row.totalWallMs === bestWall ? 'best' : ''}"><dt>All-mode wall</dt><dd>${formatMetric(row.totalWallMs, ' ms', 0)}</dd></div>
            <div class="${row.totalTransferKb === bestTransfer ? 'best' : ''}"><dt>Transfer</dt><dd>${formatMetric(row.totalTransferKb, ' KB')}</dd></div>
            <div class="${row.avgHeapMb === bestHeap ? 'best' : ''}"><dt>Avg heap</dt><dd>${formatMetric(row.avgHeapMb, ' MB')}</dd></div>
            <div class="${row.maxHeapMb === bestMaxHeap ? 'best' : ''}"><dt>Max heap</dt><dd>${formatMetric(row.maxHeapMb, ' MB')}</dd></div>
            <div><dt>Errors</dt><dd>${row.totalErrors}</dd></div>
          </dl>
        </article>`,
      )
      .join('\n')}
  </section>`;
}

function renderGroupedBarChart(title, rows, metric, unit = '', digits = 0, labelFn = (row) => row.pagePath) {
  const labels = [...new Set(rows.map(labelFn))];
  const names = variants(rows);
  const width = 1120;
  const left = 168;
  const right = 124;
  const top = 72;
  const rowHeight = 58;
  const barHeight = 12;
  const variantGap = 4;
  const height = top + labels.length * rowHeight + 42;
  const maxValue = Math.max(1, ...rows.map((row) => row[metric] || 0));
  const chartWidth = width - left - right;
  const byKey = new Map(rows.map((row) => [`${labelFn(row)}\t${row.variant}`, row]));
  const bars = labels
    .map((label, labelIndex) => {
      const y = top + labelIndex * rowHeight;
      const group = names
        .map((variant, variantIndex) => {
          const row = byKey.get(`${label}\t${variant}`);
          const value = row?.[metric] || 0;
          const barWidth = (value / maxValue) * chartWidth;
          const barY = y + variantIndex * (barHeight + variantGap);
          const color = colorForVariant(variant, names);
          return `<g>
            <rect x="${left}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="3" fill="${color}"></rect>
            <text x="${left + barWidth + 6}" y="${barY + 10}" font-size="11" fill="#374151">${formatMetric(value, unit, digits)}</text>
          </g>`;
        })
        .join('\n');
      return `<g>
        <text x="14" y="${y + 21}" font-size="12" font-weight="700" fill="#111827">${escapeHtml(label)}</text>
        ${group}
      </g>`;
    })
    .join('\n');
  const legend = names.map((name) => `<span><i style="background:${colorForVariant(name, names)}"></i>${escapeHtml(name)}</span>`).join('');

  return `<section class="chart-card">
    <div class="chart-title"><h2>${escapeHtml(title)}</h2><div class="legend">${legend}</div></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
      <line x1="${left}" y1="${top - 16}" x2="${left + chartWidth}" y2="${top - 16}" stroke="#d1d5db"></line>
      <text x="${left}" y="${top - 28}" font-size="11" fill="#6b7280">0</text>
      <text x="${left + chartWidth - 58}" y="${top - 28}" font-size="11" fill="#6b7280">${formatMetric(maxValue, unit, digits)}</text>
      ${bars}
    </svg>
  </section>`;
}

function renderLoopHeapChart(variantRuns) {
  const loopSteps = variantRuns.flatMap((run) => run.steps).filter((step) => step.mode === 'loop');
  if (!loopSteps.length) return '';
  const names = variants(loopSteps);
  const width = 1120;
  const height = 360;
  const left = 62;
  const right = 28;
  const top = 34;
  const bottom = 48;
  const series = names.map((name) => ({
    name,
    values: loopSteps
      .filter((step) => step.variant === name)
      .sort((a, b) => a.runIndex - b.runIndex || a.sequence - b.sequence)
      .map((step, index) => ({
        x: index + 1,
        y: heapMb(step),
        label: `${step.pagePath} loop ${step.iteration}`,
      })),
  }));
  const maxX = Math.max(1, ...series.flatMap((item) => item.values.map((point) => point.x)));
  const maxY = Math.max(1, ...series.flatMap((item) => item.values.map((point) => point.y)));
  const xFor = (x) => left + ((x - 1) / Math.max(1, maxX - 1)) * (width - left - right);
  const yFor = (y) => top + (1 - y / maxY) * (height - top - bottom);
  const lines = series
    .map((item) => {
      const color = colorForVariant(item.name, names);
      const points = item.values.map((point) => `${xFor(point.x)},${yFor(point.y)}`).join(' ');
      const dots = item.values
        .map((point) => `<circle cx="${xFor(point.x)}" cy="${yFor(point.y)}" r="3" fill="${color}"><title>${escapeHtml(item.name)} ${escapeHtml(point.label)} ${formatMetric(point.y, ' MB')}</title></circle>`)
        .join('\n');
      return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"></polyline>${dots}`;
    })
    .join('\n');
  const legend = names.map((name) => `<span><i style="background:${colorForVariant(name, names)}"></i>${escapeHtml(name)}</span>`).join('');

  return `<section class="chart-card">
    <div class="chart-title"><h2>Loop Memory Growth</h2><div class="legend">${legend}</div></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Loop memory growth">
      <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="#9ca3af"></line>
      <line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" stroke="#9ca3af"></line>
      <text x="12" y="${top + 8}" font-size="12" fill="#374151">MB</text>
      <text x="${width - right - 70}" y="${height - 14}" font-size="12" fill="#374151">step</text>
      <text x="10" y="${yFor(maxY) + 4}" font-size="11" fill="#6b7280">${formatMetric(maxY, ' MB')}</text>
      ${lines}
    </svg>
  </section>`;
}

function renderReport(summary, variantRuns, metadata) {
  const sorted = [...summary].sort(
    (a, b) => a.mode.localeCompare(b.mode) || a.pagePath.localeCompare(b.pagePath) || a.variant.localeCompare(b.variant),
  );
  const aggregate = aggregateByVariantMode(sorted);
  const modeSections = modes(sorted)
    .map((mode) => {
      const modeRows = sorted.filter((row) => row.mode === mode);
      return `<section>
        <h2 class="mode-heading">${escapeHtml(mode.toUpperCase())}</h2>
        ${renderGroupedBarChart(`${mode} wall time`, modeRows, 'medianWallMs', ' ms', 0)}
        ${renderGroupedBarChart(`${mode} heap`, modeRows, 'medianHeapMb', ' MB', 1)}
      </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AGNT Comprehensive Performance Report</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f9fafb; }
    main { max-width: 1240px; margin: 0 auto; padding: 32px 24px 56px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    .meta { color: #4b5563; margin: 0 0 20px; }
    .mode-heading { margin: 34px 0 10px; font-size: 20px; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; margin: 22px 0; }
    .metric-card, .chart-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 1px 2px rgb(15 23 42 / 0.04); }
    .metric-card { padding: 16px; }
    .metric-card h2 { margin: 0 0 14px; font-size: 15px; }
    .metric-card dl { display: grid; gap: 8px; margin: 0; }
    .metric-card dl div { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid #f3f4f6; }
    .metric-card dt { color: #6b7280; font-size: 12px; }
    .metric-card dd { margin: 0; font-weight: 700; font-size: 13px; }
    .metric-card .best dd { color: #047857; }
    .chart-card { margin: 18px 0; padding: 16px; }
    .chart-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .chart-title h2 { margin: 0; font-size: 17px; }
    .legend { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px 14px; color: #374151; font-size: 12px; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .legend i { width: 10px; height: 10px; display: inline-block; border-radius: 999px; }
    svg { display: block; width: 100%; height: auto; }
    .table-wrap { margin-top: 22px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; }
    th, td { padding: 9px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; font-size: 13px; white-space: nowrap; }
    th:first-child, td:first-child, th:nth-child(2), td:nth-child(2), th:nth-child(3), td:nth-child(3), th:last-child, td:last-child { text-align: left; }
    th { background: #f3f4f6; font-weight: 700; }
    @media (max-width: 760px) {
      main { padding: 24px 12px 40px; }
      .chart-title { display: block; }
      .legend { justify-content: flex-start; margin-top: 10px; }
    }
  </style>
</head>
<body>
  <main>
    <h1>AGNT Comprehensive Performance Report</h1>
    <p class="meta">Generated ${escapeHtml(metadata.generatedAt)}. Modes: ${metadata.modes.map(escapeHtml).join(', ')}. Runs: ${metadata.runs}. Loop count: ${metadata.loopCount}. Viewport: ${metadata.viewport.width}x${metadata.viewport.height}. Sample window: ${metadata.sampleMs} ms.</p>
    ${renderMetricCards(sorted)}
    ${renderGroupedBarChart('Total Wall Time by Mode', aggregate, 'totalWallMs', ' ms', 0, (row) => row.mode)}
    ${renderGroupedBarChart('Average Heap by Mode', aggregate, 'avgHeapMb', ' MB', 1, (row) => row.mode)}
    ${renderGroupedBarChart('Transfer by Mode', aggregate, 'totalTransferKb', ' KB', 1, (row) => row.mode)}
    ${renderLoopHeapChart(variantRuns)}
    ${modeSections}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Variant</th><th>Mode</th><th>Section</th><th>Runs</th><th>Wall ms</th><th>FCP ms</th><th>LCP ms</th><th>CLS</th><th>TBT ms</th><th>Transfer KB</th><th>Resources</th><th>DOM</th><th>Heap MB</th><th>Max Heap MB</th><th>Errors</th><th>Navigation</th></tr></thead>
        <tbody>
          ${sorted.map((row) => `<tr><td>${escapeHtml(row.variant)}</td><td>${escapeHtml(row.mode)}</td><td>${escapeHtml(row.pagePath)}</td><td>${row.runs}</td><td>${round(row.medianWallMs)}</td><td>${round(row.medianFcpMs)}</td><td>${round(row.medianLcpMs)}</td><td>${round(row.medianCls, 3)}</td><td>${round(row.medianTbtMs)}</td><td>${round(row.medianTransferKb)}</td><td>${round(row.medianResourceCount)}</td><td>${round(row.medianDomElements)}</td><td>${round(row.medianHeapMb)}</td><td>${round(row.maxHeapMb)}</td><td>${row.errorCount}</td><td>${escapeHtml(row.navigationMethods)}</td></tr>`).join('\n')}
        </tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}

async function writeOutputs(outputDir, payload) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'comprehensive-results.json'), JSON.stringify(payload, null, 2));
  await writeFile(path.join(outputDir, 'comprehensive-summary.csv'), `${toCsv(payload.summary)}\n`);
  await writeFile(path.join(outputDir, 'comprehensive-report.html'), renderReport(payload.summary, payload.variantRuns, payload.metadata));
}

async function main() {
  const cliOptions = parseArgs(process.argv.slice(2));
  if (cliOptions.help) {
    console.log(usage());
    return;
  }

  if (cliOptions.renderResultsPath) {
    const resultsPath = path.resolve(cliOptions.renderResultsPath);
    const outputDir = path.dirname(resultsPath);
    const existing = await readJson(resultsPath);
    await writeOutputs(outputDir, existing);
    console.log(`[perf:comprehensive] rendered ${path.join(outputDir, 'comprehensive-report.html')}`);
    return;
  }

  const options = await loadOptions(cliOptions);
  if (!options.variants.length) throw new Error('At least one --variant NAME=URL is required');
  if (!options.pages.length) throw new Error('At least one page is required');

  const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const outputDir = path.resolve(options.outputDir, runId);
  const variantRuns = [];
  for (const variant of options.variants) {
    variantRuns.push(...(await runVariant(variant, options)));
  }

  const summary = summarize(variantRuns);
  const metadata = {
    generatedAt: new Date().toISOString(),
    variants: options.variants,
    pages: options.pages,
    modes: options.modes,
    runs: options.runs,
    loopCount: options.loopCount,
    sampleMs: options.sampleMs,
    sampleIntervalMs: options.sampleIntervalMs,
    viewport: options.viewport,
    hasAuthToken: Boolean(options.authToken),
    apiBaseUrl: options.apiBaseUrl,
  };

  await writeOutputs(outputDir, { metadata, summary, variantRuns });
  console.log(`[perf:comprehensive] wrote ${path.join(outputDir, 'comprehensive-report.html')}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
