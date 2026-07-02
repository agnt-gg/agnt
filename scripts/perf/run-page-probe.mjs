#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const DEFAULT_WAIT_UNTIL = 'networkidle';
const DEFAULT_SAMPLE_MS = 10000;
const DEFAULT_SAMPLE_INTERVAL_MS = 1000;

function parseArgs(argv) {
  const options = {
    viewport: { width: 1280, height: 720 },
    sampleMs: DEFAULT_SAMPLE_MS,
    sampleIntervalMs: DEFAULT_SAMPLE_INTERVAL_MS,
    waitUntil: DEFAULT_WAIT_UNTIL,
    warmupMs: 250,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return next;
    };

    if (arg === '--url') options.url = readValue();
    else if (arg === '--label') options.label = readValue();
    else if (arg === '--page') options.pagePath = readValue();
    else if (arg === '--auth-token') options.authToken = readValue();
    else if (arg === '--auth-token-file') options.authTokenFile = readValue();
    else if (arg === '--api-base-url') options.apiBaseUrl = readValue();
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

function usage() {
  return `Usage:
  npm run perf:probe -- --url http://127.0.0.1:5301/settings --label base

Options:
  --url URL                     Full page URL to measure.
  --label NAME                  Variant label used in output.
  --page PATH                   Logical app path for output grouping.
  --auth-token TOKEN            Seed localStorage.token before navigation.
  --auth-token-file FILE        Read token from a local file and seed localStorage.token.
  --api-base-url URL            Seed AGNT_API_BASE_URL before navigation for static previews.
  --sample-ms MS                Runtime sampling window after load. Default: ${DEFAULT_SAMPLE_MS}.
  --sample-interval-ms MS       Runtime sampling cadence. Default: ${DEFAULT_SAMPLE_INTERVAL_MS}.
  --viewport WIDTHxHEIGHT       Browser viewport. Default: 1280x720.
  --wait-until STATE            load, domcontentloaded, or networkidle. Default: ${DEFAULT_WAIT_UNTIL}.
  --warmup-ms MS                Short idle wait after navigation. Default: 250.
  --headful                     Show the browser.
`;
}

async function resolveAuthToken(options) {
  if (options.authTokenFile) {
    return (await readFile(path.resolve(options.authTokenFile), 'utf8')).trim();
  }
  return options.authToken || null;
}

function percentile(values, percentileValue) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function resourceSummary(resources) {
  const byType = new Map();
  for (const resource of resources) {
    const key = resource.initiatorType || 'other';
    const bucket = byType.get(key) || {
      count: 0,
      transferSize: 0,
      decodedBodySize: 0,
      duration: 0,
    };
    bucket.count += 1;
    bucket.transferSize += resource.transferSize || 0;
    bucket.decodedBodySize += resource.decodedBodySize || 0;
    bucket.duration += resource.duration || 0;
    byType.set(key, bucket);
  }

  return {
    totalCount: resources.length,
    totalTransferSize: sum(resources.map((resource) => resource.transferSize)),
    totalDecodedBodySize: sum(resources.map((resource) => resource.decodedBodySize)),
    byType: Object.fromEntries(byType),
    topTransfer: [...resources]
      .sort((a, b) => (b.transferSize || b.decodedBodySize || 0) - (a.transferSize || a.decodedBodySize || 0))
      .slice(0, 15),
    topDuration: [...resources].sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 15),
  };
}

function metricValue(metrics, name) {
  return metrics.find((metric) => metric.name === name)?.value ?? null;
}

async function getChromeMetrics(cdpSession) {
  const result = await cdpSession.send('Performance.getMetrics').catch(() => ({ metrics: [] }));
  const metrics = result.metrics || [];
  return {
    jsHeapUsedSize: metricValue(metrics, 'JSHeapUsedSize'),
    jsHeapTotalSize: metricValue(metrics, 'JSHeapTotalSize'),
    nodes: metricValue(metrics, 'Nodes'),
    documents: metricValue(metrics, 'Documents'),
    layoutCount: metricValue(metrics, 'LayoutCount'),
    recalcStyleCount: metricValue(metrics, 'RecalcStyleCount'),
    layoutDuration: metricValue(metrics, 'LayoutDuration'),
    recalcStyleDuration: metricValue(metrics, 'RecalcStyleDuration'),
    scriptDuration: metricValue(metrics, 'ScriptDuration'),
    taskDuration: metricValue(metrics, 'TaskDuration'),
  };
}

async function collectRuntimeSamples(page, cdpSession, sampleMs, intervalMs) {
  if (!sampleMs || sampleMs <= 0) return [];

  const startedAt = Date.now();
  const samples = [];

  while (Date.now() - startedAt <= sampleMs) {
    const cdpMetrics = await getChromeMetrics(cdpSession);
    const pageMetrics = await page.evaluate(() => ({
      now: Math.round(performance.now()),
      heap: performance.memory
        ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          }
        : null,
      documentElementCount: document.getElementsByTagName('*').length,
      scriptCount: document.scripts.length,
      stylesheetCount: document.styleSheets.length,
    }));

    samples.push({
      elapsedMs: Date.now() - startedAt,
      ...pageMetrics,
      cdp: cdpMetrics,
    });

    if (Date.now() - startedAt >= sampleMs) break;
    await page.waitForTimeout(intervalMs);
  }

  return samples;
}

async function runProbe(options) {
  if (!options.url) {
    throw new Error('--url is required');
  }

  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({
    viewport: options.viewport,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('Performance.enable').catch(() => null);
  const authToken = await resolveAuthToken(options);
  if (authToken) {
    await page.addInitScript((token) => {
      window.localStorage.setItem('token', token);
    }, authToken);
  }
  if (options.apiBaseUrl) {
    await page.addInitScript((apiBaseUrl) => {
      window.localStorage.setItem('AGNT_API_BASE_URL', apiBaseUrl);
    }, options.apiBaseUrl);
  }

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText || 'unknown',
    });
  });

  await page.addInitScript(() => {
    window.__agntPerfLongTasks = [];
    window.__agntPerfLayoutShifts = [];

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__agntPerfLongTasks.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      window.__agntPerfLongTasksUnsupported = true;
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            window.__agntPerfLayoutShifts.push({
              startTime: entry.startTime,
              value: entry.value,
            });
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      window.__agntPerfLayoutShiftUnsupported = true;
    }
  });

  const navigationStartedAt = Date.now();
  await page.goto(options.url, { waitUntil: options.waitUntil, timeout: 60000 });
  if (options.warmupMs > 0) {
    await page.waitForTimeout(options.warmupMs);
  }
  const navigationWallTimeMs = Date.now() - navigationStartedAt;

  const samples = await collectRuntimeSamples(page, cdpSession, options.sampleMs, options.sampleIntervalMs);
  const finalChromeMetrics = await getChromeMetrics(cdpSession);

  const pageData = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const paintEntries = Object.fromEntries(
      performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime]),
    );
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      transferSize: entry.transferSize || 0,
      encodedBodySize: entry.encodedBodySize || 0,
      decodedBodySize: entry.decodedBodySize || 0,
      startTime: entry.startTime || 0,
      duration: entry.duration || 0,
    }));
    const longTasks = window.__agntPerfLongTasks || [];
    const layoutShifts = window.__agntPerfLayoutShifts || [];
    const heap = performance.memory
      ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        }
      : null;

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
            startTime: navigation.startTime,
            unloadEventEnd: navigation.unloadEventEnd,
            redirectEnd: navigation.redirectEnd,
            fetchStart: navigation.fetchStart,
            domainLookupStart: navigation.domainLookupStart,
            domainLookupEnd: navigation.domainLookupEnd,
            connectStart: navigation.connectStart,
            connectEnd: navigation.connectEnd,
            requestStart: navigation.requestStart,
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
      paints: paintEntries,
      resources,
      longTasks,
      layoutShifts,
      cumulativeLayoutShift: layoutShifts.reduce((total, entry) => total + entry.value, 0),
      heap,
      webVitalsApprox: {
        fcp: paintEntries['first-contentful-paint'] || null,
        longTaskCount: longTasks.length,
        totalBlockingTime: longTasks.reduce((total, task) => total + Math.max(0, task.duration - 50), 0),
        p95LongTaskMs: 0,
      },
    };
  });

  pageData.webVitalsApprox.p95LongTaskMs = percentile(
    pageData.longTasks.map((task) => task.duration),
    95,
  );

  await browser.close();

  return {
    measuredAt: new Date().toISOString(),
    label: options.label || new URL(options.url).origin,
    pagePath: options.pagePath || new URL(options.url).pathname,
    input: {
      url: options.url,
      viewport: options.viewport,
      hasAuthToken: Boolean(authToken),
      apiBaseUrl: options.apiBaseUrl || null,
      sampleMs: options.sampleMs,
      sampleIntervalMs: options.sampleIntervalMs,
      waitUntil: options.waitUntil,
    },
    navigationWallTimeMs,
    ...pageData,
    resourcesSummary: resourceSummary(pageData.resources),
    samples,
    finalChromeMetrics,
    consoleErrors,
    pageErrors,
    failedRequests,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = await runProbe(options);
  console.log(JSON.stringify(result, null, 2));
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

export {
  runProbe,
  resolveAuthToken,
  resourceSummary,
  getChromeMetrics,
  collectRuntimeSamples,
  percentile,
};
