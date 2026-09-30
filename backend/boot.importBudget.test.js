import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * What the backend must NOT load before it can listen.
 *
 * Every static import reachable from server.js is evaluated before the first
 * line of server.js runs, and before the port is bound. These packages are
 * heavy and serve one feature each, so they are imported where that feature
 * runs. Measured import time in a fresh process (cold / warm cache):
 *
 *   jsdom 601/594 ms (506 files), cheerio 816/196, @google/genai 210/122,
 *   @cerebras/cerebras_cloud_sdk 222/62, mammoth 143/139, mailparser 102/101;
 *   pdfreader (pulls in pdf2json) showed up on a boot CPU profile after these.
 *
 * jsdom came back onto the boot path unnoticed once already (commit 4dd9adc0,
 * a static import in utils/webScrape.js). This walks the real static graph so
 * the next one fails a test instead of a user's patience.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, 'server.js');

const MUST_BE_LAZY = [
  'jsdom',
  'cheerio',
  'mammoth',
  '@google/genai',
  '@google/generative-ai',
  '@cerebras/cerebras_cloud_sdk',
  'imap',
  'mailparser',
  'pdfreader',
];

// Static forms only; `import('x')` inside a function is exactly what we want.
const STATIC_IMPORT = /^\s*import\s+(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]|^\s*export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm;

function resolveLocal(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function packageName(specifier) {
  if (specifier.startsWith('node:')) return null;
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}

/** @returns {Map<string, string>} package -> first first-party file that statically imports it */
function staticBootPackages() {
  const seen = new Set();
  const packages = new Map();
  const stack = [ENTRY];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const specifier = match[1] || match[2];
      if (specifier.startsWith('.')) {
        const resolved = resolveLocal(file, specifier);
        if (resolved) stack.push(resolved);
      } else {
        const name = packageName(specifier);
        if (name && !packages.has(name)) packages.set(name, path.relative(HERE, file));
      }
    }
  }
  return { packages, fileCount: seen.size };
}

describe('backend boot import budget', () => {
  const { packages, fileCount } = staticBootPackages();

  it('walks the real graph (guards against a vacuous pass)', () => {
    expect(fileCount).toBeGreaterThan(200);
    expect(packages.has('express')).toBe(true);
    expect(packages.has('sqlite3')).toBe(true);
  });

  it.each(MUST_BE_LAZY)('does not load %s before listening', (pkg) => {
    expect(packages.get(pkg), `${pkg} is statically imported by ${packages.get(pkg)}; import it where it is used`).toBeUndefined();
  });
});
