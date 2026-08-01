/**
 * The per-call-site fix is not the fix.
 *
 * A bare `defineAsyncComponent(() => import(...))` renders NOTHING when its
 * loader rejects, so any new one silently reintroduces the blank-screen bug the
 * next time a rebuild retires a hash. There were six such call sites, spread
 * across two registries and three components, and finding them all by reading
 * was luck. This makes the seventh a test failure instead of a bug report.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The one file allowed to call it — lazyComponent() is built on top of it. */
const ALLOWED = [path.join('utils', 'chunkRecovery.js')];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(full));
    } else if (/\.(js|ts|vue)$/.test(entry.name) && !/\.(spec|test)\.[jt]s$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('lazy component adoption', () => {
  const files = walk(SRC);

  it('finds source to scan (guards against a broken walker)', () => {
    expect(files.length).toBeGreaterThan(400);
  });

  it('routes every dynamic component through lazyComponent()', () => {
    const offenders = [];

    for (const file of files) {
      const rel = path.relative(SRC, file);
      if (ALLOWED.includes(rel)) continue;

      const source = fs.readFileSync(file, 'utf8');
      // Calls only — the word may legitimately appear in prose/comments.
      if (/(?<!\/\/.*)\bdefineAsyncComponent\s*\(/.test(source.replace(/^\s*(\/\/|\*).*$/gm, ''))) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      'Use lazyComponent() from @/utils/chunkRecovery.js instead — a bare '
        + 'defineAsyncComponent renders an empty div when its chunk 404s.',
    ).toEqual([]);
  });

  it('keeps both screen registries on the shared wrapper', () => {
    // These two are the ones that actually load screens. If either regresses to
    // a raw import the blank page comes back on that surface only, which is
    // exactly how it hid for so long.
    const terminal = fs.readFileSync(path.join(SRC, 'views', 'Terminal', 'Terminal.vue'), 'utf8');
    const widgets = fs.readFileSync(path.join(SRC, 'canvas', 'widgets', 'index.js'), 'utf8');

    expect(terminal).toMatch(/lazyComponent\(/);
    expect(widgets).toMatch(/lazyComponent\(/);
  });

  it('registers every screen up front, not only on successful preload', () => {
    const terminal = fs.readFileSync(path.join(SRC, 'views', 'Terminal', 'Terminal.vue'), 'utf8');

    // The registry must be seeded FROM screenLoaders. Before this fix a failed
    // preload left the screen absent from the map entirely, and navigating to
    // it rendered the placeholder forever.
    expect(terminal).toMatch(/screenLoaders\.map\(\s*\(\[name, loader\]\)\s*=>\s*\[name, markRaw\(lazyComponent\(/);
    expect(terminal).toMatch(/SettingsScreen', \(\) => import\(/);
  });
});
