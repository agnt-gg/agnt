export const SCRAPE_POLICY_VERSION = '2026-09-24-scrape-v1';
// One page or one document is one unit: every requested format comes from the same visit.
export const SCRAPE_RATES = Object.freeze({ page: 4000 });
export const SCRAPE_TIERS = Object.freeze({
  starter: { id: 'starter', name: 'Starter', price: 5000000, includedPages: 2250, includedUnits: 2250 },
  pro: { id: 'pro', name: 'Pro', price: 15000000, includedPages: 7000, includedUnits: 7000 },
  business: { id: 'business', name: 'Business', price: 39000000, includedPages: 18000, includedUnits: 18000 },
});
// AGNT subscribers receive the matching standalone tier; no second quantity table to drift.
const bundleFor = tier => Object.freeze({ pages: tier.includedPages });
export const SCRAPE_BUNDLES = Object.freeze({
  personal: bundleFor(SCRAPE_TIERS.starter),
  always_on: bundleFor(SCRAPE_TIERS.pro),
  business: bundleFor(SCRAPE_TIERS.business),
  enterprise: bundleFor(SCRAPE_TIERS.business),
});
export const SCRAPE_FORMATS = Object.freeze(['markdown', 'html', 'text', 'links', 'code', 'screenshot', 'bytes']);
// An uploaded file IS the original bytes and has no viewport, so parse offers the rest.
export const PARSE_FORMATS = Object.freeze(SCRAPE_FORMATS.filter(name => !['screenshot', 'bytes'].includes(name)));
export const SCRAPE_LIMITS = Object.freeze({
  navigationMs: 25000, deadlineMs: 45000, maxWaitForMs: 10000,
  resultBytes: 6291456, documentBytes: 10485760, transferBytes: 52428800,
  requestBytes: 16384, requestsPerMinute: 30, queueDepth: 16, failuresPerHour: 60,
  fileBytes: 20971520, bytesFormatBytes: 4194304, maxUnzippedBytes: 104857600, maxZipEntries: 5000,
  maxPdfPages: 500, maxSheetRows: 2000, maxSheetColumns: 100,
});
// Source files keep their language on the fenced block.
const CODE_LANGUAGES = Object.freeze({
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python', rb: 'ruby',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php',
  swift: 'swift', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', sql: 'sql', css: 'css', scss: 'scss', less: 'less',
  toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini', lua: 'lua', r: 'r', dart: 'dart', scala: 'scala', pl: 'perl', ex: 'elixir',
  exs: 'elixir', vue: 'vue', svelte: 'svelte', graphql: 'graphql', proto: 'protobuf', tf: 'hcl', jsonl: 'json',
});
export const codeLanguage = extension => CODE_LANGUAGES[extension] || '';
// Every file extension Scrape converts, and the converter that handles it.
export const SCRAPE_FILE_TYPES = Object.freeze({
  pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', xlsm: 'xlsx', pptx: 'pptx', csv: 'csv', tsv: 'tsv',
  json: 'json', geojson: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml', rss: 'xml', atom: 'xml', svg: 'svg',
  html: 'html', htm: 'html', xhtml: 'html', md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  txt: 'text', text: 'text', log: 'text', rtf: 'rtf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
  ...Object.fromEntries(Object.keys(CODE_LANGUAGES).map(extension => [extension, 'code'])),
});
// A sensitivity model, NOT measured profit. Seconds per successful page include the
// compute of attempts that fail, which are never billed: measured 5.66s per success
// plus failed-attempt time amortised over successes at the observed 77% success rate.
export const SCRAPE_COST_MODEL = Object.freeze({ workerHourUSD: 0.10, otherUSDPer1000: 0.10, secondsPerPage: 7.0, paymentFraction: 0.059, targetContribution: 0.80 });
export function pageCostUSD(model = SCRAPE_COST_MODEL) {
  return model.secondsPerPage * (model.workerHourUSD / 3600) + model.otherUSDPer1000 / 1000;
}
// Modelled worst case: every included page used.
export function tierContribution(tier, model = SCRAPE_COST_MODEL) {
  const price = tier.price / 1e6;
  return (price * (1 - model.paymentFraction) - tier.includedPages * pageCostUSD(model)) / price;
}
export function operationPrice() { return SCRAPE_RATES.page; }
export function usesIncluded(_operation, _input, status) { return (status.remainingPages ?? 0) > 0; }
export const plans = () => ({
  version: SCRAPE_POLICY_VERSION, tiers: SCRAPE_TIERS, monthlyPlansAvailable: true, bundledUnits: SCRAPE_BUNDLES,
  ratesMicroUSD: SCRAPE_RATES, formats: SCRAPE_FORMATS,
  unit: 'One page or document: every requested format comes from the same visit. Blocked and failed pages are never charged.',
  fileTypes: Object.keys(SCRAPE_FILE_TYPES),
  payAsYouGo: true, fundingUSD: [10, 25, 50], minimumFundingUSD: 10,
  allowanceReset: 'Monthly plans: the purchased month. AGNT bundles: UTC calendar month. No rollover.',
  limits: SCRAPE_LIMITS,
});
// Formats arrive as {markdown:true}, as the normalised array, or as "markdown,links" from a query string.
function normalizeFormats(raw, allowed, fallback = { markdown: true }) {
  if (raw === undefined || raw === '') raw = fallback;
  if (typeof raw === 'string') raw = raw.split(',').map(name => name.trim()).filter(Boolean);
  const requested = Array.isArray(raw) && raw.every(name => typeof name === 'string') ? Object.fromEntries(raw.map(name => [name, true])) : raw;
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) throw Error('invalid_formats');
  for (const [name, value] of Object.entries(requested)) if (!allowed.includes(name) || typeof value !== 'boolean') throw Error('invalid_formats');
  const formats = allowed.filter(name => requested[name] === true);
  if (!formats.length) throw Error('invalid_formats');
  return formats;
}
// "5" or "2-9", one-based and inclusive. Applies to PDF pages.
function normalizePageRange(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const match = typeof value === 'string' && /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(value.trim());
  if (!match) throw Error('invalid_page_range');
  const from = Number(match[1]), to = Number(match[2] ?? match[1]);
  if (from < 1 || to < from) throw Error('invalid_page_range');
  return from === to ? String(from) : from + '-' + to;
}
function normalizeParse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('invalid_request');
  const extension = String(body.extension ?? '').trim().toLowerCase().replace(/^\./, '');
  if (!SCRAPE_FILE_TYPES[extension]) throw Error('unsupported_file_type');
  if (!Number.isSafeInteger(body.size) || body.size < 1) throw Error('invalid_request');
  if (body.size > SCRAPE_LIMITS.fileBytes) throw Error('result_too_large');
  if (typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256)) throw Error('invalid_request');
  const mainContentOnly = body.mainContentOnly ?? true;
  if (typeof mainContentOnly !== 'boolean') throw Error('invalid_request');
  const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase().slice(0, 200).replace(/[^\w.+\-/=;" ]/g, '') : '';
  const filename = typeof body.filename === 'string' ? body.filename.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200) : '';
  const pageRange = normalizePageRange(body.pageRange);
  return {
    extension, formats: normalizeFormats(body.formats, PARSE_FORMATS), size: body.size, sha256: body.sha256, mainContentOnly,
    ...(contentType ? { contentType } : {}), ...(filename ? { filename } : {}), ...(pageRange ? { pageRange } : {}),
  };
}
export function normalizeOperation(operation, body) {
  if (operation === 'parse') return normalizeParse(body);
  if (operation !== 'scrape') throw Error('unsupported_operation');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('invalid_request');
  if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > 4096) throw Error('invalid_url');
  let url;
  try { url = new URL(body.url.includes('://') ? body.url.trim() : 'https://' + body.url.trim()); } catch { throw Error('invalid_url'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)) throw Error('invalid_url');
  // Idempotent: the gateway normalises once and the worker validates the SAME input
  // again, so the normalised form (an array of format names) must be accepted too.
  const formats = normalizeFormats(body.formats, SCRAPE_FORMATS);
  const mainContentOnly = body.mainContentOnly ?? true, waitForMs = body.waitForMs ?? 0;
  if (typeof mainContentOnly !== 'boolean' || !Number.isInteger(waitForMs) || waitForMs < 0 || waitForMs > SCRAPE_LIMITS.maxWaitForMs) throw Error('invalid_request');
  const pageRange = normalizePageRange(body.pageRange);
  return { url: url.href, formats, mainContentOnly, waitForMs, ...(pageRange ? { pageRange } : {}) };
}
