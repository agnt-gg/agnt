/**
 * No template may interpolate a LEDGER origin directly.
 *
 * WHY THIS GUARD EXISTS
 * --------------------
 * `originLabels.mirror.spec.js` proves the vocabulary is complete. It cannot
 * prove anybody USES it — and the defect that started this was precisely a
 * render site bypassing the map:
 *
 *     <span class="tree-origin">{{ node.origin }}</span>
 *
 * That printed `workflow_node` into the run tree, and no test noticed, because
 * printing a string that exists is not an error. The dashboard's parallel
 * defect was subtler (a map with a pass-through fallback) but had the same
 * observable: a snake_case database token rendered as a user-facing label.
 *
 * So: any `{{ ... .origin ... }}` in a .vue template must route through
 * `originLabel()`. The exception is a NETWORK origin — a paired server's
 * scheme+host, e.g. `https://192.168.1.5:3333` — which is a URL, already
 * capitalised by nothing and correctly shown verbatim. Those files are listed
 * explicitly below with that reason attached, so an addition to the list is a
 * deliberate, reviewable act rather than a silent one.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

/**
 * Files whose `.origin` is a URL origin (scheme + host of a paired AGNT
 * server), not a `llm_calls.origin` bucket. Nothing to label.
 */
const NETWORK_ORIGIN_FILES = new Set([
  'views/MobileLite/MobileHome.vue',
  'views/Terminal/CenterPanel/screens/Settings/components/PhoneAccessSection/PhoneAccessSection.vue',
]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out; // directory removed mid-walk
    throw err;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, out);
    else if (e.name.endsWith('.vue')) out.push(fp);
  }
  return out;
}

const rel = (p) => path.relative(SRC, p).replace(/\\/g, '/');

/** The `<template>` block only — a JS comment mentioning `{{ x.origin }}` is prose. */
function templateOf(source) {
  const open = source.indexOf('<template>');
  if (open === -1) return '';
  const close = source.lastIndexOf('</template>');
  if (close <= open) return '';
  return source
    .slice(open, close)
    .replace(/<!--[\s\S]*?-->/g, ''); // HTML comments are prose too
}

/** Every `{{ ... }}` interpolation that mentions `.origin`. */
function originInterpolations(template) {
  return [...template.matchAll(/\{\{([\s\S]*?)\}\}/g)]
    .map((m) => m[1])
    .filter((expr) => /\borigin\b/.test(expr));
}

describe('ledger origins are never rendered raw', () => {
  const files = walk(SRC);

  it('scans a plausible number of .vue files (anti-vacuity)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('finds the interpolations it claims to check (anti-vacuity)', () => {
    const total = files.reduce(
      (n, f) => n + originInterpolations(templateOf(fs.readFileSync(f, 'utf8'))).length,
      0
    );
    // Three render sites today: two ledger (now wrapped), plus the network ones.
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it('routes every ledger origin interpolation through originLabel()', () => {
    const offenders = [];
    for (const file of files) {
      const name = rel(file);
      if (NETWORK_ORIGIN_FILES.has(name)) continue;
      for (const expr of originInterpolations(templateOf(fs.readFileSync(file, 'utf8')))) {
        if (!/originLabel\s*\(/.test(expr)) offenders.push(`${name}: {{${expr.trim()}}}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the network-origin exemption honest', () => {
    // An exemption for a file that no longer renders an origin is dead weight
    // that will one day excuse a real offender.
    for (const name of NETWORK_ORIGIN_FILES) {
      const file = path.join(SRC, name);
      expect(fs.existsSync(file), name).toBe(true);
      expect(originInterpolations(templateOf(fs.readFileSync(file, 'utf8'))).length, name)
        .toBeGreaterThan(0);
    }
  });
});
