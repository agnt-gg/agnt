/**
 * Copy the browser tools' schemas from their action classes into the two
 * toolLibrary.json manifests.
 *
 * The manifests are hand-maintained duplicates of every action's schema — the
 * backend serves one, the frontend bundles the other, and nothing regenerates
 * either. That is how the Browser Agent's provider dropdown kept offering three
 * providers long after two of them had stopped working.
 *
 * Run after changing ai-browser-use.js or ai-browser-control.js:
 *   node backend/scripts/sync-browser-tool-schemas.mjs
 *
 * ai-browser-use.schema.test.js fails if you forget.
 *
 * Splices only the objects it owns rather than re-serialising the file: these
 * manifests are not canonically formatted, so a whole-file rewrite would bury a
 * twenty-line change in a three-thousand-line diff.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** Ordered: each tool is placed after the one before it when first inserted. */
const TOOLS = [
  { type: 'ai-browser-use', module: '../src/tools/library/actions/ai-browser-use.js' },
  { type: 'ai-browser-control', module: '../src/tools/library/actions/ai-browser-control.js' },
];

/** Byte span of the JSON object containing `marker`. */
function objectSpan(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return null;

  let depth = 0;
  let start = -1;
  for (let i = markerIndex; i >= 0; i -= 1) {
    if (text[i] === '}') depth += 1;
    else if (text[i] === '{') {
      if (depth === 0) { start = i; break; }
      depth -= 1;
    }
  }
  if (start === -1) throw new Error('could not find the opening brace');

  depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  throw new Error('could not find the closing brace');
}

function render(value, indent) {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : indent + line))
    .join('\n');
}

function indentAt(raw, start) {
  const lineStart = raw.lastIndexOf('\n', start) + 1;
  return ' '.repeat(start - lineStart);
}

const schemas = new Map();
for (const tool of TOOLS) {
  const { default: action } = await import(tool.module);
  schemas.set(tool.type, JSON.parse(JSON.stringify(action.constructor.schema)));
}

const manifests = [
  path.join(repoRoot, 'backend', 'src', 'tools', 'toolLibrary.json'),
  path.join(repoRoot, 'frontend', 'src', 'tools', '_toolLibrary.json'),
];

for (const manifestPath of manifests) {
  let raw = fs.readFileSync(manifestPath, 'utf8');
  const relative = path.relative(repoRoot, manifestPath);
  let changed = false;

  for (let i = 0; i < TOOLS.length; i += 1) {
    const { type } = TOOLS[i];
    const schema = schemas.get(type);
    const span = objectSpan(raw, `"${type}"`);

    if (span) {
      // Already present: merge over whatever else the manifest records.
      const existing = JSON.parse(raw.slice(span.start, span.end));
      const indent = indentAt(raw, span.start);
      const next = raw.slice(0, span.start)
        + render({ ...existing, ...schema }, indent)
        + raw.slice(span.end);
      if (next !== raw) { raw = next; changed = true; console.log(`  updated  ${type}`); }
      continue;
    }

    // Missing: insert it directly after the tool before it, so the manifest
    // keeps the browser tools together instead of appending to the end of a
    // 3,000-line array where nobody will find them.
    const anchorType = TOOLS[i - 1]?.type;
    if (!anchorType) throw new Error(`${type} is missing from ${relative} and has no anchor to insert after`);
    const anchor = objectSpan(raw, `"${anchorType}"`);
    if (!anchor) throw new Error(`cannot insert ${type}: anchor ${anchorType} is missing from ${relative}`);

    const indent = indentAt(raw, anchor.start);
    raw = raw.slice(0, anchor.end)
      + ',\n' + indent + render(schema, indent)
      + raw.slice(anchor.end);
    changed = true;
    console.log(`  inserted ${type} after ${anchorType}`);
  }

  // The splice is textual, so prove the result is still valid JSON and still
  // contains every tool before writing it back.
  const parsed = JSON.parse(raw);
  for (const { type } of TOOLS) {
    if (!parsed.actions.some((entry) => entry?.type === type)) {
      throw new Error(`${type} is not in ${relative}.actions after the splice`);
    }
  }

  if (!changed) {
    console.log(`unchanged ${relative}`);
    continue;
  }
  fs.writeFileSync(manifestPath, raw, 'utf8');
  console.log(`written   ${relative}`);
}

process.exit(0);
