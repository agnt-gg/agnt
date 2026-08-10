import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * THE DESCRIPTOR MUST STAY ISOMORPHIC.
 *
 * Everything in this directory is bundled into the browser by Vite (alias
 * `@llm`) as well as imported by the Node backend. The moment one file here
 * reaches for `fs`, `path`, `process` or an SDK, the frontend build breaks —
 * and the natural "fix" is to copy the logic back into the frontend, which is
 * exactly the three-copy problem this directory was created to end.
 *
 * So the constraint is enforced here rather than discovered at build time:
 * a descriptor module may import nothing at all except other descriptor
 * modules.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_BUILTINS = /^(node:)?(fs|path|os|crypto|process|child_process|http|https|net|url|util|stream|worker_threads|events|zlib|dns|tls|buffer)(\/|$)/;

function descriptorFiles() {
  return fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.js') && !/\.(test|spec)\.js$/.test(f));
}

function importsOf(src) {
  const out = [];
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  const dyn = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dyn.exec(src))) out.push(m[1]);
  const req = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = req.exec(src))) out.push(m[1]);
  return out;
}

describe('shared descriptor purity', () => {
  const files = descriptorFiles();

  it('ANTI-VACUITY: there are descriptor modules to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s imports no Node built-in', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const bad = importsOf(src).filter((s) => FORBIDDEN_BUILTINS.test(s));
    expect(bad, `${file} must stay browser-safe — it is bundled by Vite`).toEqual([]);
  });

  it.each(files)('%s imports only sibling descriptor modules', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const escaping = importsOf(src).filter((s) => s.startsWith('..') || !s.startsWith('.'));
    expect(
      escaping,
      `${file} may only import other descriptor modules — anything else can drag Node or SDK code into the browser bundle`
    ).toEqual([]);
  });

  it.each(files)('%s touches no ambient runtime globals', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const g of ['process.', '__dirname', '__filename', 'globalThis.process', 'window.', 'document.']) {
      expect(src.includes(g), `${file} references ${g}`).toBe(false);
    }
  });
});
