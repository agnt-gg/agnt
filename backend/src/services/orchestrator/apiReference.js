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
const DOCS_PATH = path.resolve(__dirname, '../../../../docs/_API-DOCUMENTATION.md');

const BOILERPLATE = `// -- AGNT API Helper --
// Drop this into your widget <script> to call any AGNT endpoint.
const API = 'http://localhost:${process.env.PORT || 3333}/api';
function getToken() { try { return localStorage.getItem('token') || null; } catch(e) { return null; } }
function headers() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json', 'Accept': 'application/json' }; }

// Usage examples:
// const res = await fetch(API + '/agents/', { headers: headers() });
// const data = await res.json();
//
// const res = await fetch(API + '/workflows/save', {
//   method: 'POST', headers: headers(),
//   body: JSON.stringify({ name: 'My Workflow', nodes: [], edges: [] })
// });`;

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

/**
 * Parse the Local API portion of the docs into sections.
 * Re-reads the file each call so changes are picked up without restart.
 */
function parseSections() {
  let raw;
  try {
    raw = fs.readFileSync(DOCS_PATH, 'utf-8');
  } catch (err) {
    console.error('[apiReference] Could not read API docs:', err.message);
    return {};
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

    // Extract endpoint overview lines: pair ### headings with **METHOD** `path`
    const endpoints = [];
    const epRegex = /###\s+(.+)\r?\n[\r\n]+\*\*(GET|POST|PUT|DELETE|PATCH)\*\*\s+`([^`]+)`/g;
    let epMatch;
    while ((epMatch = epRegex.exec(content)) !== null) {
      endpoints.push(`${epMatch[2].padEnd(7)} ${epMatch[3].padEnd(30)} ${epMatch[1].trim()}`);
    }

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
    _cachedNames = Object.keys(parseSections());
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

  let out = `AGNT API Reference — Overview
Base URL: http://localhost:${process.env.PORT || 3333}/api
Auth: Bearer token — get from localStorage.getItem('token')

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
  const data = sections[section];
  if (!data) {
    return `Unknown section: "${section}". Available sections: ${Object.keys(sections).join(', ')}`;
  }

  return `${data.content}

────────────────────────────────────────────
API Helper (drop into your widget <script>):

${BOILERPLATE}`;
}

export { getOverview, getSectionDetail, SECTION_NAMES };
