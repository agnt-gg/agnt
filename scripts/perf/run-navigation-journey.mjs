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

function parseArgs(argv) {
  const options = {
    variants: [],
    runs: 1,
    sampleMs: 5000,
    sampleIntervalMs: 1000,
    viewport: { width: 1280, height: 720 },
    waitUntil: 'networkidle',
    warmupMs: 500,
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
    } else if (arg === '--pages') {
      options.pages = readValue().split(',').map((page) => page.trim()).filter(Boolean);
    } else if (arg === '--config') options.configPath = readValue();
    else if (arg === '--auth-token') options.authToken = readValue();
    else if (arg === '--auth-token-file') options.authTokenFile = readValue();
    else if (arg === '--api-base-url') options.apiBaseUrl = readValue();
    else if (arg === '--runs') options.runs = Number(readValue());
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

function usage() {
  return `Usage:
  npm run perf:journey -- \\
    --variant base=http://127.0.0.1:5301 \\
    --variant lazy-loading=http://127.0.0.1:5302 \\
    --variant lazy-global-libs=http://127.0.0.1:5303 \\
    --auth-token-file ~/.agnt-test-token \\
    --api-base-url http://127.0.0.1:3333/api

Options:
  --variant NAME=URL            Variant label and running app base URL. Repeat for each variant.
  --pages /settings,/chat       Ordered app journey. Defaults to scripts/perf/default-pages.json.
  --config FILE                 JSON with variants, pages, runs, sampleMs, sampleIntervalMs, outputDir.
  --auth-token TOKEN            Seed localStorage.token before the journey.
  --auth-token-file FILE        Read token from a local file and seed localStorage.token.
  --api-base-url URL            Seed AGNT_API_BASE_URL for static previews.
  --runs N                      Journeys per variant. Default: 1.
  --output DIR                  Output directory. Default: ${DEFAULT_OUTPUT_DIR}.
  --sample-ms MS                Per-section runtime memory sampling window. Default: 5000.
  --sample-interval-ms MS       Runtime sampling cadence. Default: 1000.
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
    pages: cliOptions.pages || fileConfig.pages || defaultPages.pages,
    runs: cliOptions.runs ?? fileConfig.runs ?? 1,
    outputDir: cliOptions.outputDir ?? fileConfig.outputDir ?? DEFAULT_OUTPUT_DIR,
    sampleMs: cliOptions.sampleMs ?? fileConfig.sampleMs ?? 5000,
    sampleIntervalMs: cliOptions.sampleIntervalMs ?? fileConfig.sampleIntervalMs ?? 1000,
    viewport: cliOptions.viewport || fileConfig.viewport || { width: 1280, height: 720 },
    headless: cliOptions.headless ?? fileConfig.headless ?? true,
    authToken,
    apiBaseUrl: cliOptions.apiBaseUrl ?? fileConfig.apiBaseUrl ?? null,
    waitUntil: cliOptions.waitUntil ?? fileConfig.waitUntil ?? 'networkidle',
    warmupMs: cliOptions.warmupMs ?? fileConfig.warmupMs ?? 500,
  };
}

function normalizePath(pagePath) {
  return pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
}

function buildUrl(baseUrl, pagePath) {
  const url = new URL(normalizePath(pagePath), `${baseUrl}/`);
  url.searchParams.set('agntPerfJourney', Date.now().toString(36));
  return url.toString();
}

async function installObservers(page) {
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
}

async function resetStepPerformance(page) {
  await page.evaluate(() => {
    performance.clearResourceTimings();
    window.__agntPerfLongTasks = [];
    window.__agntPerfLayoutShifts = [];
  }).catch(() => null);
}

async function collectStepData(page) {
  return page.evaluate(() => {
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
    const paints = Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime]));

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
      resources,
      longTasks,
      layoutShifts,
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
        longTaskCount: longTasks.length,
        totalBlockingTime: longTasks.reduce((total, task) => total + Math.max(0, task.duration - 50), 0),
      },
    };
  });
}

async function seedContext(page, options) {
  if (options.authToken) {
    await page.addInitScript((token) => {
      window.localStorage.setItem('token', token);
    }, options.authToken);
  }
  if (options.apiBaseUrl) {
    await page.addInitScript((apiBaseUrl) => {
      window.localStorage.setItem('AGNT_API_BASE_URL', apiBaseUrl);
    }, options.apiBaseUrl);
  }
}

async function runJourney(variant, options, runIndex) {
  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({
    viewport: options.viewport,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('Performance.enable').catch(() => null);
  await installObservers(page);
  await seedContext(page, options);

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

  const steps = [];
  const normalizedPages = options.pages.map(normalizePath);
  for (let index = 0; index < normalizedPages.length; index += 1) {
    const pagePath = normalizedPages[index];
    await resetStepPerformance(page);
    const consoleStart = consoleErrors.length;
    const pageErrorStart = pageErrors.length;
    const failedRequestStart = failedRequests.length;

    const url = buildUrl(variant.baseUrl, pagePath);
    const startedAt = Date.now();
    await page.goto(url, { waitUntil: options.waitUntil, timeout: 60000 });
    if (options.warmupMs > 0) await page.waitForTimeout(options.warmupMs);
    const navigationWallTimeMs = Date.now() - startedAt;

    const samples = await collectRuntimeSamples(page, cdpSession, options.sampleMs, options.sampleIntervalMs);
    const finalChromeMetrics = await getChromeMetrics(cdpSession);
    const pageData = await collectStepData(page);
    pageData.webVitalsApprox.p95LongTaskMs = percentile(pageData.longTasks.map((task) => task.duration), 95);

    steps.push({
      measuredAt: new Date().toISOString(),
      label: variant.name,
      runIndex,
      stepIndex: index + 1,
      pagePath,
      navigationWallTimeMs,
      ...pageData,
      resourcesSummary: resourceSummary(pageData.resources),
      samples,
      finalChromeMetrics,
      consoleErrors: consoleErrors.slice(consoleStart),
      pageErrors: pageErrors.slice(pageErrorStart),
      failedRequests: failedRequests.slice(failedRequestStart),
    });
  }

  await browser.close();
  return { variant: variant.name, runIndex, steps, consoleErrors, pageErrors, failedRequests };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function finalSample(step) {
  return step.samples[step.samples.length - 1] || {};
}

function summarize(journeys) {
  const groups = new Map();
  for (const journey of journeys) {
    for (const step of journey.steps) {
      const key = `${step.label}\t${step.pagePath}`;
      const group = groups.get(key) || [];
      group.push({ step, journey });
      groups.set(key, group);
    }
  }

  return [...groups.entries()].map(([key, group]) => {
    const [variant, pagePath] = key.split('\t');
    const steps = group.map((item) => item.step);
    return {
      variant,
      pagePath,
      runs: steps.length,
      medianWallMs: median(steps.map((step) => step.navigationWallTimeMs)),
      medianFcpMs: median(steps.map((step) => step.webVitalsApprox.fcp || 0)),
      medianTbtMs: median(steps.map((step) => step.webVitalsApprox.totalBlockingTime || 0)),
      medianTransferKb: median(steps.map((step) => step.resourcesSummary.totalTransferSize / 1024)),
      medianResourceCount: median(steps.map((step) => step.resourcesSummary.totalCount)),
      medianDomElements: median(steps.map((step) => step.dom.elements)),
      medianHeapMb: median(steps.map((step) => (finalSample(step).cdp?.jsHeapUsedSize || step.heap?.usedJSHeapSize || 0) / 1024 / 1024)),
      maxHeapMb: Math.max(
        0,
        ...steps.flatMap((step) =>
          step.samples.map((sample) => (sample.cdp?.jsHeapUsedSize || sample.heap?.usedJSHeapSize || 0) / 1024 / 1024),
        ),
      ),
      errorCount: steps.reduce(
        (total, step) => total + step.consoleErrors.length + step.pageErrors.length + step.failedRequests.length,
        0,
      ),
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
    'pagePath',
    'runs',
    'medianWallMs',
    'medianFcpMs',
    'medianTbtMs',
    'medianTransferKb',
    'medianResourceCount',
    'medianDomElements',
    'medianHeapMb',
    'maxHeapMb',
    'errorCount',
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

function renderReport(summary, metadata) {
  const rows = [...summary].sort((a, b) => a.pagePath.localeCompare(b.pagePath) || a.variant.localeCompare(b.variant));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AGNT Performance Journey</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f9fafb; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 24px 56px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .meta { color: #4b5563; margin: 0 0 20px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; }
    th, td { padding: 9px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; font-size: 13px; }
    th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
    th { background: #f3f4f6; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>AGNT Performance Journey</h1>
    <p class="meta">Generated ${escapeHtml(metadata.generatedAt)}. Runs: ${metadata.runs}. Viewport: ${metadata.viewport.width}x${metadata.viewport.height}. Sample window per section: ${metadata.sampleMs} ms.</p>
    <table>
      <thead><tr><th>Variant</th><th>Section</th><th>Runs</th><th>Wall ms</th><th>FCP ms</th><th>TBT ms</th><th>Transfer KB</th><th>Resources</th><th>DOM</th><th>Heap MB</th><th>Max Heap MB</th><th>Errors</th></tr></thead>
      <tbody>
        ${rows.map((row) => `<tr><td>${escapeHtml(row.variant)}</td><td>${escapeHtml(row.pagePath)}</td><td>${row.runs}</td><td>${round(row.medianWallMs)}</td><td>${round(row.medianFcpMs)}</td><td>${round(row.medianTbtMs)}</td><td>${round(row.medianTransferKb)}</td><td>${round(row.medianResourceCount)}</td><td>${round(row.medianDomElements)}</td><td>${round(row.medianHeapMb)}</td><td>${round(row.maxHeapMb)}</td><td>${row.errorCount}</td></tr>`).join('\n')}
      </tbody>
    </table>
  </main>
</body>
</html>`;
}

async function main() {
  const cliOptions = parseArgs(process.argv.slice(2));
  if (cliOptions.help) {
    console.log(usage());
    return;
  }

  const options = await loadOptions(cliOptions);
  if (!options.variants.length) throw new Error('At least one --variant NAME=URL is required');
  if (!options.pages.length) throw new Error('At least one page is required');

  const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const outputDir = path.resolve(options.outputDir, runId);
  await mkdir(outputDir, { recursive: true });

  const journeys = [];
  for (const variant of options.variants) {
    for (let runIndex = 1; runIndex <= options.runs; runIndex += 1) {
      console.log(`[perf:journey] ${variant.name} run ${runIndex}/${options.runs}`);
      journeys.push(await runJourney(variant, options, runIndex));
    }
  }

  const summary = summarize(journeys);
  const metadata = {
    generatedAt: new Date().toISOString(),
    variants: options.variants,
    pages: options.pages.map(normalizePath),
    runs: options.runs,
    sampleMs: options.sampleMs,
    sampleIntervalMs: options.sampleIntervalMs,
    viewport: options.viewport,
    hasAuthToken: Boolean(options.authToken),
    apiBaseUrl: options.apiBaseUrl,
  };

  await writeFile(path.join(outputDir, 'journey-results.json'), JSON.stringify({ metadata, summary, journeys }, null, 2));
  await writeFile(path.join(outputDir, 'journey-summary.csv'), `${toCsv(summary)}\n`);
  await writeFile(path.join(outputDir, 'journey-report.html'), renderReport(summary, metadata));

  console.log(`[perf:journey] wrote ${path.join(outputDir, 'journey-report.html')}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
