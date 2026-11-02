/**
 * AGNT API Reference for Widget Forge
 *
 * Dynamically reads from docs/_API-DOCUMENTATION.md so the widget forge LLM
 * always has up-to-date endpoint information — no manual sync required.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the API docs path. In dev, __dirname is:
 *   <repo>/backend/src/services/orchestrator
 * so ../../../../docs works. In a built Electron app, __dirname is:
 *   <resources>/app.asar/backend/src/services/orchestrator
 * and the docs file must be packed into the ASAR at docs/_API-DOCUMENTATION.md
 * (see the "files" array in package.json build config).
 *
 * We also check process.resourcesPath (Electron) for an extraResources fallback.
 */
function resolveDocsPath() {
  // Primary: relative from __dirname (works in both dev and ASAR)
  const primary = path.resolve(__dirname, '../../../../docs/_API-DOCUMENTATION.md');
  if (fs.existsSync(primary)) return primary;

  // Fallback: Electron extraResources path
  if (process.resourcesPath) {
    const extra = path.join(process.resourcesPath, 'docs', '_API-DOCUMENTATION.md');
    if (fs.existsSync(extra)) return extra;
  }

  // Return primary anyway — parseSections will log the specific error
  return primary;
}

const DOCS_PATH = resolveDocsPath();

const BOILERPLATE = `// -- AGNT API helper --
// Use the right pattern for your runtime context:
//
// ─────────────────────────────────────────────────────────
// WIDGETS (browser iframe) — use the global agnt SDK
// ─────────────────────────────────────────────────────────
// Auth is handled automatically. The token never enters the iframe — every
// call is proxied through the parent via postMessage. Do NOT call
// localStorage.getItem('token'), do NOT set Authorization headers, do NOT
// write a getToken() helper. Bypassing the SDK will 401.
//
//   // Plugin / native / registry tool calls (most common)
//   const joke = await agnt.tool('chucknorris-get-joke', { category: 'dev' });
//
//   // Any /api/* endpoint
//   const agents = await agnt.fetch('/api/agents');
//   const created = await agnt.fetch('/api/agents/save', {
//     method: 'POST',
//     body: { agent: { name: 'My Agent' } }   // object or JSON.stringify(...) both work
//   });   // -> { message, agentId }
//
//   // User context (synchronous)
//   console.log(agnt.user);   // { id, email, name } | null
//
// agnt.tool returns the tool's result directly (not the {success, result}
// envelope) and throws on tool failure. agnt.fetch returns the parsed
// response body and throws on non-2xx.
//
// ─────────────────────────────────────────────────────────
// SERVER (execute_javascript_code, Node.js) — manual token
// ─────────────────────────────────────────────────────────
// In a Node.js context there is no \`agnt\` object. The auth token is
// injected as an env var by the orchestrator.
//
const API = 'http://localhost:${process.env.PORT || 3333}/api';

function apiFetch(url, options = {}) {
  const token = process.env.AGNT_AUTH_TOKEN;
  const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(url, { ...options, headers });
}

// Server-side usage examples:
// const res = await apiFetch(API + '/agents/');
// const data = await res.json();
//
// const res = await apiFetch(API + '/workflows/save', {
//   method: 'POST',
//   body: JSON.stringify({ workflow: { name: 'My Workflow', nodes: [], edges: [] } })
// });   // -> 201 { message, workflowId }. Every node needs id, type and text (its display name).`;

// Header prefixes to skip when parsing (not route sections)
const SKIP_PREFIXES = [
  'local api',
  'table of contents',
  'authentication',
  'error responses',
  'rate limiting',
  'pagination',
  'file uploads',
  'server-sent events',
  'websocket support',
  'remote api',
];

/**
 * Convert a markdown section header to a section key.
 * "Agent Routes" -> "agents", "Widget Definition Routes" -> "widget-definitions"
 */
function headerToKey(header) {
  return header
    .replace(/\s+Routes?$/i, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

const METHODS = 'GET|POST|PUT|DELETE|PATCH';
// `**GET** `/path``, optionally a list item, optionally followed by ": what it does".
const INLINE_ENDPOINT = new RegExp(`^\\s*(?:[-*]\\s+)?\\*\\*(${METHODS})\\*\\*\\s+\`([^\`]+)\`(?:\\s*[:\u2014-]\\s*(.*))?`);
// `| GET | `/path` | ... | what it does |`
const TABLE_ENDPOINT = new RegExp(`^\\|\\s*(${METHODS})\\s*\\|\\s*\`([^\`]+)\`\\s*\\|(.*)\\|\\s*$`);

/**
 * Every endpoint a section documents, in order, once each.
 *
 * The docs use three styles: a `### Heading` followed by `**METHOD** `path``, a bare (or bulleted)
 * `**METHOD** `path`: description`, and a table row. Reading only the first made sections written in
 * the others (Team, Workspace File) list zero endpoints in the overview, as if they had none.
 */
export function extractEndpoints(content) {
  const endpoints = [];
  const seen = new Set();
  let heading = null;
  let fenced = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const headingMatch = line.match(/^###\s+(.+)$/);
    if (headingMatch) { heading = headingMatch[1].trim(); continue; }
    let method, route, label;
    const inline = line.match(INLINE_ENDPOINT);
    const table = inline ? null : line.match(TABLE_ENDPOINT);
    if (inline) [, method, route, label] = inline;
    else if (table) { [, method, route] = table; label = table[3].split('|').map((cell) => cell.trim()).filter(Boolean).pop(); }
    else {
      // A heading names only the endpoint directly beneath it (blank lines allowed), as before.
      if (line.trim() !== '') heading = null;
      continue;
    }
    label = (heading || label || '').replace(/\*\*/g, '').trim();
    if (label.length > 80) label = label.slice(0, 77) + '...';
    heading = null;
    const key = `${method} ${route}`;
    if (seen.has(key)) continue;
    seen.add(key);
    endpoints.push({ method, path: route, label });
  }
  return endpoints;
}

/**
 * Parse the Local API portion of the docs into sections.
 * Re-reads the file each call so changes are picked up without restart.
 */
function parseSections() {
  let raw;
  try {
    raw = fs.readFileSync(DOCS_PATH, 'utf-8');
  } catch (err) {
    console.error(`[apiReference] Could not read API docs at ${DOCS_PATH}:`, err.message);
    return null;
  }

  // Only use Local API section (everything before Remote API)
  const localOnly = raw.split(/^## Remote API/m)[0];

  // Find all ## headers and their positions
  const headerRegex = /^## (.+)$/gm;
  let match;
  const headers = [];
  while ((match = headerRegex.exec(localOnly)) !== null) {
    headers.push({ name: match[1].trim(), index: match.index });
  }

  const sections = {};

  for (let i = 0; i < headers.length; i++) {
    const { name, index } = headers[i];
    const nameLower = name.toLowerCase();
    if (SKIP_PREFIXES.some((prefix) => nameLower.startsWith(prefix))) continue;

    const key = headerToKey(name);
    const endIndex = i + 1 < headers.length ? headers[i + 1].index : localOnly.length;
    const content = localOnly.slice(index, endIndex).trim();

    // Extract base path from "Base path: `/api/...`"
    const basePathMatch = content.match(/Base path:\s*`([^`]+)`/);
    const basePath = basePathMatch ? basePathMatch[1] : '';

    const endpoints = extractEndpoints(content).map(
      ({ method, path: route, label }) => `${method.padEnd(7)} ${route.padEnd(30)} ${label}`.trimEnd()
    );

    sections[key] = {
      title: name.replace(/\s+Routes?$/i, ''),
      basePath,
      overview: endpoints,
      content,
    };
  }

  return sections;
}

// Valid section names (computed once at startup, refreshed if docs change)
let _cachedNames = null;
let _cachedMtime = 0;

function getSectionNames() {
  try {
    const stat = fs.statSync(DOCS_PATH);
    const mtime = stat.mtimeMs;
    if (_cachedNames && mtime === _cachedMtime) return _cachedNames;
    _cachedNames = Object.keys(parseSections() || {});
    _cachedMtime = mtime;
  } catch {
    if (_cachedNames) return _cachedNames;
    _cachedNames = [];
  }
  return _cachedNames;
}

const SECTION_NAMES = new Proxy([], {
  get(target, prop) {
    const names = getSectionNames();
    if (prop === 'length') return names.length;
    if (prop === Symbol.iterator) return names[Symbol.iterator].bind(names);
    if (typeof prop === 'string' && !isNaN(prop)) return names[Number(prop)];
    if (typeof names[prop] === 'function') return names[prop].bind(names);
    return names[prop];
  },
});

/**
 * Build a compact overview of all API sections
 */
function getOverview() {
  const sections = parseSections();

  if (!sections) {
    return `AGNT API Reference — ERROR\n\nCould not load API documentation file.\nExpected path: ${DOCS_PATH}\n\nThis usually means the docs/_API-DOCUMENTATION.md file was not included in the Electron build.\nThe get_agnt_api tool is unavailable until this is fixed.\n\n${BOILERPLATE}`;
  }

  let out = `AGNT API Reference — Overview
Base URL: http://localhost:${process.env.PORT || 3333}/api
Auth: widgets call through the agnt SDK (no token handling); server code sends process.env.AGNT_AUTH_TOKEN as the Bearer token (see below)

${BOILERPLATE}

────────────────────────────────────────────
`;

  for (const [key, section] of Object.entries(sections)) {
    out += `\n── ${section.title} (${section.basePath}) ──\n`;
    for (const line of section.overview) {
      out += `  ${line}\n`;
    }
  }

  out += `\n────────────────────────────────────────────
Call get_agnt_api with a section name for full endpoint details.
Available sections: ${Object.keys(sections).join(', ')}`;

  return out;
}

/**
 * Get detailed reference for a specific API section.
 * Returns the full markdown documentation for that section.
 */
function getSectionDetail(section) {
  const sections = parseSections();

  if (!sections) {
    return `Could not load API documentation. The docs file is missing from this installation. Expected: ${DOCS_PATH}`;
  }
  // Tolerate singular/plural variants — LLMs frequently default to plural
  // ("plugins") when the canonical key is singular ("plugin").
  let data = sections[section];
  if (!data && typeof section === 'string') {
    if (section.endsWith('s')) data = sections[section.slice(0, -1)];
    if (!data) data = sections[`${section}s`];
  }
  if (!data) {
    return `Unknown section: "${section}". Available sections: ${Object.keys(sections).join(', ')}`;
  }

  return `${data.content}

────────────────────────────────────────────
API Helper (drop into your widget <script>):

${BOILERPLATE}`;
}

export { getOverview, getSectionDetail, SECTION_NAMES };
