#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProbe } from './run-page-probe.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PAGES_FILE = path.join(__dirname, 'default-pages.json');
const DEFAULT_OUTPUT_DIR = 'perf-results';
const DEFAULT_RUNS = 3;

function parseArgs(argv) {
  const options = {
    variants: [],
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

    if (arg === '--variant') {
      const value = readValue();
      const separator = value.indexOf('=');
      if (separator === -1) {
        throw new Error('--variant must look like name=http://127.0.0.1:5301');
      }
      options.variants.push({
        name: value.slice(0, separator),
        baseUrl: value.slice(separator + 1).replace(/\/$/, ''),
      });
    } else if (arg === '--pages') {
      options.pages = readValue()
        .split(',')
        .map((page) => page.trim())
        .filter(Boolean);
    } else if (arg === '--config') options.configPath = readValue();
    else if (arg === '--runs') options.runs = Number(readValue());
    else if (arg === '--output') options.outputDir = readValue();
    else if (arg === '--sample-ms') options.sampleMs = Number(readValue());
    else if (arg === '--sample-interval-ms') options.sampleIntervalMs = Number(readValue());
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
  npm run perf:compare -- \\
    --variant base=http://127.0.0.1:5301 \\
    --variant lazy-loading=http://127.0.0.1:5302 \\
    --variant lazy-global-libs=http://127.0.0.1:5303

Options:
  --variant NAME=URL            Variant label and running app base URL. Repeat for each variant.
  --pages /settings,/chat       Comma-separated page paths. Defaults to scripts/perf/default-pages.json.
  --config FILE                 JSON with variants, pages, runs, sampleMs, sampleIntervalMs, outputDir.
  --runs N                      Runs per page per variant. Default: ${DEFAULT_RUNS}.
  --output DIR                  Output directory. Default: ${DEFAULT_OUTPUT_DIR}.
  --sample-ms MS                Runtime memory sampling window after load. Default: 10000.
  --sample-interval-ms MS       Runtime sampling cadence. Default: 1000.
  --viewport WIDTHxHEIGHT       Browser viewport. Default: 1280x720.
  --headful                     Show the browser.
`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function loadConfig(options) {
  const defaultPages = await readJson(DEFAULT_PAGES_FILE);
  const fileConfig = options.configPath ? await readJson(path.resolve(options.configPath)) : {};

  return {
    ...options,
    ...fileConfig,
    variants: options.variants.length > 0 ? options.variants : fileConfig.variants || [],
    pages: options.pages || fileConfig.pages || defaultPages.pages,
    runs: options.runs ?? fileConfig.runs ?? DEFAULT_RUNS,
    outputDir: options.outputDir ?? fileConfig.outputDir ?? DEFAULT_OUTPUT_DIR,
    sampleMs: options.sampleMs ?? fileConfig.sampleMs ?? 10000,
    sampleIntervalMs: options.sampleIntervalMs ?? fileConfig.sampleIntervalMs ?? 1000,
    viewport: options.viewport || fileConfig.viewport || { width: 1280, height: 720 },
    headless: options.headless ?? fileConfig.headless ?? true,
  };
}

function normalizePath(pagePath) {
  return pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
}

function buildUrl(baseUrl, pagePath) {
  const url = new URL(normalizePath(pagePath), `${baseUrl.replace(/\/$/, '')}/`);
  url.searchParams.set('agntPerfRun', Date.now().toString(36));
  return url.toString();
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
  const filtered = values.filter(Number.isFinite);
  if (filtered.length === 0) return 0;
  return filtered.reduce((total, value) => total + value, 0) / filtered.length;
}

function max(values) {
  return values.filter(Number.isFinite).reduce((largest, value) => Math.max(largest, value), 0);
}

function finalSample(result) {
  return result.samples[result.samples.length - 1] || {};
}

function summarizeResults(results) {
  const groups = new Map();
  for (const result of results) {
    const key = `${result.label}\t${result.pagePath}`;
    const group = groups.get(key) || [];
    group.push(result);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => {
    const [variant, pagePath] = key.split('\t');
    const finalSamples = group.map(finalSample);
    return {
      variant,
      pagePath,
      runs: group.length,
      medianWallMs: median(group.map((result) => result.navigationWallTimeMs)),
      medianFcpMs: median(group.map((result) => result.webVitalsApprox.fcp || 0)),
      medianTbtMs: median(group.map((result) => result.webVitalsApprox.totalBlockingTime || 0)),
      averageLongTaskCount: average(group.map((result) => result.webVitalsApprox.longTaskCount || 0)),
      medianTransferKb: median(group.map((result) => result.resourcesSummary.totalTransferSize / 1024)),
      medianDecodedKb: median(group.map((result) => result.resourcesSummary.totalDecodedBodySize / 1024)),
      medianResourceCount: median(group.map((result) => result.resourcesSummary.totalCount)),
      medianDomElements: median(group.map((result) => result.dom.elements)),
      medianHeapMb: median(finalSamples.map((sample) => (sample.cdp?.jsHeapUsedSize || sample.heap?.usedJSHeapSize || 0) / 1024 / 1024)),
      maxHeapMb: max(
        group.flatMap((result) =>
          result.samples.map((sample) => (sample.cdp?.jsHeapUsedSize || sample.heap?.usedJSHeapSize || 0) / 1024 / 1024),
        ),
      ),
      errorCount: group.reduce(
        (total, result) => total + result.consoleErrors.length + result.pageErrors.length + result.failedRequests.length,
        0,
      ),
    };
  });
}

function csvEscape(value) {
  if (value == null) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  const headers = [
    'variant',
    'pagePath',
    'runs',
    'medianWallMs',
    'medianFcpMs',
    'medianTbtMs',
    'averageLongTaskCount',
    'medianTransferKb',
    'medianDecodedKb',
    'medianResourceCount',
    'medianDomElements',
    'medianHeapMb',
    'maxHeapMb',
    'errorCount',
  ];
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function renderBarChart(title, rows, metric, unit = '') {
  const width = 1000;
  const barHeight = 24;
  const gap = 10;
  const left = 260;
  const right = 40;
  const top = 46;
  const height = top + rows.length * (barHeight + gap) + 24;
  const maxValue = Math.max(1, ...rows.map((row) => row[metric] || 0));
  const colors = ['#2563eb', '#059669', '#dc2626', '#7c3aed', '#ea580c', '#0891b2'];
  const variantColor = new Map();
  let colorIndex = 0;
  const colorFor = (variant) => {
    if (!variantColor.has(variant)) {
      variantColor.set(variant, colors[colorIndex % colors.length]);
      colorIndex += 1;
    }
    return variantColor.get(variant);
  };

  const bars = rows
    .map((row, index) => {
      const value = row[metric] || 0;
      const y = top + index * (barHeight + gap);
      const barWidth = ((width - left - right) * value) / maxValue;
      const label = `${row.pagePath} - ${row.variant}`;
      return `<g>
        <text x="12" y="${y + 17}" font-size="12" fill="#111827">${escapeHtml(label)}</text>
        <rect x="${left}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="${colorFor(row.variant)}"></rect>
        <text x="${left + barWidth + 8}" y="${y + 17}" font-size="12" fill="#111827">${round(value)}${unit}</text>
      </g>`;
    })
    .join('\n');

  return `<section>
    <h2>${escapeHtml(title)}</h2>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
      <text x="12" y="24" font-size="16" font-weight="700" fill="#111827">${escapeHtml(title)}</text>
      ${bars}
    </svg>
  </section>`;
}

function renderHeapTimeline(results) {
  const width = 1000;
  const height = 360;
  const left = 60;
  const right = 30;
  const top = 34;
  const bottom = 44;
  const series = results
    .filter((result) => result.samples.length > 0)
    .map((result) => ({
      label: `${result.pagePath} - ${result.label} - run ${result.runIndex}`,
      values: result.samples.map((sample) => ({
        x: sample.elapsedMs,
        y: (sample.cdp?.jsHeapUsedSize || sample.heap?.usedJSHeapSize || 0) / 1024 / 1024,
      })),
    }));

  const maxX = Math.max(1, ...series.flatMap((item) => item.values.map((point) => point.x)));
  const maxY = Math.max(1, ...series.flatMap((item) => item.values.map((point) => point.y)));
  const colors = ['#2563eb', '#059669', '#dc2626', '#7c3aed', '#ea580c', '#0891b2', '#4b5563', '#be123c'];

  const xFor = (x) => left + (x / maxX) * (width - left - right);
  const yFor = (y) => top + (1 - y / maxY) * (height - top - bottom);
  const lines = series
    .slice(0, 24)
    .map((item, index) => {
      const points = item.values.map((point) => `${xFor(point.x)},${yFor(point.y)}`).join(' ');
      return `<polyline points="${points}" fill="none" stroke="${colors[index % colors.length]}" stroke-width="2">
        <title>${escapeHtml(item.label)}</title>
      </polyline>`;
    })
    .join('\n');

  const legend = series
    .slice(0, 24)
    .map((item, index) => `<span><i style="background:${colors[index % colors.length]}"></i>${escapeHtml(item.label)}</span>`)
    .join('');

  return `<section>
    <h2>JS Heap Over Time</h2>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="JS heap over time">
      <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="#9ca3af"></line>
      <line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" stroke="#9ca3af"></line>
      <text x="12" y="${top + 8}" font-size="12" fill="#374151">MB</text>
      <text x="${width - right - 64}" y="${height - 12}" font-size="12" fill="#374151">time</text>
      ${lines}
    </svg>
    <div class="legend">${legend}</div>
  </section>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderReport(summary, results, metadata) {
  const sorted = [...summary].sort((a, b) => a.pagePath.localeCompare(b.pagePath) || a.variant.localeCompare(b.variant));
  const rows = sorted
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.variant)}</td>
        <td>${escapeHtml(row.pagePath)}</td>
        <td>${row.runs}</td>
        <td>${round(row.medianWallMs)}</td>
        <td>${round(row.medianFcpMs)}</td>
        <td>${round(row.medianTbtMs)}</td>
        <td>${round(row.medianTransferKb)}</td>
        <td>${round(row.medianHeapMb)}</td>
        <td>${round(row.maxHeapMb)}</td>
        <td>${row.errorCount}</td>
      </tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AGNT Performance Comparison</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f9fafb; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 24px 56px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    h2 { margin: 34px 0 14px; font-size: 18px; }
    .meta { color: #4b5563; margin: 0 0 20px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; }
    th, td { padding: 9px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; font-size: 13px; }
    th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
    th { background: #f3f4f6; font-weight: 700; }
    svg { display: block; width: 100%; height: auto; background: #fff; border: 1px solid #e5e7eb; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 10px; color: #374151; font-size: 12px; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 999px; }
  </style>
</head>
<body>
  <main>
    <h1>AGNT Performance Comparison</h1>
    <p class="meta">Generated ${escapeHtml(metadata.generatedAt)}. Runs per page: ${metadata.runs}. Viewport: ${metadata.viewport.width}x${metadata.viewport.height}. Sample window: ${metadata.sampleMs} ms.</p>
    <table>
      <thead>
        <tr>
          <th>Variant</th>
          <th>Page</th>
          <th>Runs</th>
          <th>Wall ms</th>
          <th>FCP ms</th>
          <th>TBT ms</th>
          <th>Transfer KB</th>
          <th>Heap MB</th>
          <th>Max Heap MB</th>
          <th>Errors</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${renderBarChart('Median Navigation Wall Time', sorted, 'medianWallMs', ' ms')}
    ${renderBarChart('Median Transfer Size', sorted, 'medianTransferKb', ' KB')}
    ${renderBarChart('Median JS Heap', sorted, 'medianHeapMb', ' MB')}
    ${renderBarChart('Median Total Blocking Time', sorted, 'medianTbtMs', ' ms')}
    ${renderHeapTimeline(results)}
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

  const options = await loadConfig(cliOptions);
  if (!options.variants.length) {
    throw new Error('At least one --variant NAME=URL is required');
  }
  if (!options.pages.length) {
    throw new Error('At least one page is required');
  }

  const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const outputDir = path.resolve(options.outputDir, runId);
  await mkdir(outputDir, { recursive: true });

  const results = [];
  for (const variant of options.variants) {
    for (const pagePath of options.pages.map(normalizePath)) {
      for (let runIndex = 1; runIndex <= options.runs; runIndex += 1) {
        const url = buildUrl(variant.baseUrl, pagePath);
        console.log(`[perf] ${variant.name} ${pagePath} run ${runIndex}/${options.runs}`);
        const result = await runProbe({
          url,
          label: variant.name,
          pagePath,
          viewport: options.viewport,
          sampleMs: options.sampleMs,
          sampleIntervalMs: options.sampleIntervalMs,
          headless: options.headless,
          waitUntil: 'networkidle',
          warmupMs: 250,
        });
        results.push({ ...result, runIndex });
      }
    }
  }

  const summary = summarizeResults(results);
  const metadata = {
    generatedAt: new Date().toISOString(),
    variants: options.variants,
    pages: options.pages.map(normalizePath),
    runs: options.runs,
    sampleMs: options.sampleMs,
    sampleIntervalMs: options.sampleIntervalMs,
    viewport: options.viewport,
  };

  await writeFile(path.join(outputDir, 'results.json'), JSON.stringify({ metadata, summary, results }, null, 2));
  await writeFile(path.join(outputDir, 'summary.csv'), `${toCsv(summary)}\n`);
  await writeFile(path.join(outputDir, 'report.html'), renderReport(summary, results, metadata));

  console.log(`[perf] wrote ${path.join(outputDir, 'report.html')}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
