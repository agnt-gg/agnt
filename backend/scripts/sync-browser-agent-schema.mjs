/**
 * Copy the Browser Agent's schema from the action class into the two
 * toolLibrary.json manifests.
 *
 * The manifests are hand-maintained duplicates of every action's schema — the
 * backend serves one, the frontend bundles the other, and nothing regenerates
 * either. That is how the node's provider dropdown kept offering three
 * providers long after two of them had stopped working.
 *
 * Run after changing ai-browser-use.js:
 *   node backend/scripts/sync-browser-agent-schema.mjs
 *
 * ai-browser-use.schema.test.js fails if you forget.
 *
 * Splices only the one object rather than re-serialising the file: these
 * manifests are not canonically formatted, so a whole-file rewrite would bury
 * a twenty-line change in a three-thousand-line diff.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const { default: action } = await import('../src/tools/library/actions/ai-browser-use.js');
const schema = JSON.parse(JSON.stringify(action.constructor.schema));

/** Byte span of the JSON object containing `marker`. */
function objectSpan(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) throw new Error(`marker not found: ${marker}`);

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

const manifests = [
  path.join(repoRoot, 'backend', 'src', 'tools', 'toolLibrary.json'),
  path.join(repoRoot, 'frontend', 'src', 'tools', '_toolLibrary.json'),
];

for (const manifestPath of manifests) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const { start, end } = objectSpan(raw, '"ai-browser-use"');

  const existing = JSON.parse(raw.slice(start, end));
  const merged = { ...existing, ...schema };

  const lineStart = raw.lastIndexOf('\n', start) + 1;
  const indent = ' '.repeat(start - lineStart);
  const rendered = JSON.stringify(merged, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : indent + line))
    .join('\n');

  const next = raw.slice(0, start) + rendered + raw.slice(end);
  if (next === raw) {
    console.log(`unchanged ${path.relative(repoRoot, manifestPath)}`);
    continue;
  }
  fs.writeFileSync(manifestPath, next, 'utf8');
  console.log(`updated   ${path.relative(repoRoot, manifestPath)}`);
}

process.exit(0);
