/**
 * Guard: every stylesheet block is balanced.
 *
 * WHY (2026-08-02)
 * ────────────────
 * A codemod rewrote `box-shadow: 0 0 8px var(--color-green)}` and swallowed the
 * closing brace, because on a MINIFIED single-line <style> the last declaration
 * in a block has no trailing semicolon and the value capture ran past `}`.
 *
 * The result was an "Unclosed block" that failed `vite build` — but the unit
 * suite stayed fully green, because vitest never parses component CSS. So the
 * repo was in a state where every test passed and the app could not be built.
 *
 * That gap is worth closing permanently: brace balance is cheap to check and a
 * broken one is always a defect, whoever introduced it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|dist|\.git/.test(e.name)) walk(p, out);
    } else if (/\.(vue|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Strip comments and strings so braces inside them do not count. */
function sanitise(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/url\([^)]*\)/gi, 'url()');
}

/**
 * Style blocks with their starting line, so a failure points somewhere real.
 *
 * The <script> section is blanked first. Several components build iframe
 * `srcdoc` documents inside template literals, and those contain their own
 * <style> tags with `${...}` interpolation. Scanning them reports unbalanced
 * braces that are not real — MessageItem.vue tripped exactly this on the first
 * run while `vite build` was perfectly happy. A guard with false positives gets
 * switched off, so it only looks at what the SFC compiler actually compiles.
 */
function styleBlocks(file, raw) {
  if (file.endsWith('.css')) return [{ css: raw, line: 1 }];
  const withoutScript = raw.replace(/<script[\s\S]*?<\/script>/gi, (m) => m.replace(/[^\n]/g, ' '));
  return [...withoutScript.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => ({
    css: m[1],
    line: withoutScript.slice(0, m.index).split('\n').length,
  }));
}

/** Brace balance of a stylesheet: 0 = balanced, <0 = a stray `}`. */
function balance(css) {
  let depth = 0;
  for (const c of sanitise(css)) {
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth < 0) return -1;
    }
  }
  return depth;
}

describe('css integrity', () => {
  const files = walk(SRC).filter((f) => !/base[\\/]js[\\/]libs|\.min\.|__old-/.test(f));

  it('detects the exact damage that caused this guard to exist (negative control)', () => {
    // Verbatim shape of the codemod bug: the closing brace was consumed by the
    // replacement, so the next selector became part of this block.
    const damaged = '.status-dot{width:7px;background:var(--color-green);box-shadow:var(--glow-success)\n'
      + '.mode-grid{display:flex}';
    const repaired = '.status-dot{width:7px;background:var(--color-green);box-shadow:var(--glow-success)}\n'
      + '.mode-grid{display:flex}';
    expect(balance(damaged), 'checker failed to notice a swallowed brace').not.toBe(0);
    expect(balance(repaired)).toBe(0);
    expect(balance('a{b:c}}'), 'checker failed to notice a stray closing brace').toBe(-1);
    // Braces inside comments and strings must NOT count.
    expect(balance('/* } } } */ a{content:"}"}')).toBe(0);
  });

  it('scans a realistic number of stylesheets (anti-vacuity)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('every <style> block and .css file has balanced braces', () => {
    const broken = [];
    for (const file of files) {
      const raw = fs.readFileSync(file, 'utf8');
      for (const block of styleBlocks(file, raw)) {
        const css = sanitise(block.css);
        let depth = 0;
        let negative = false;
        for (const c of css) {
          if (c === '{') depth += 1;
          else if (c === '}') {
            depth -= 1;
            if (depth < 0) { negative = true; break; }
          }
        }
        if (depth !== 0 || negative) {
          broken.push(
            `${path.relative(SRC, file).replace(/\\/g, '/')} (style block at line ${block.line}): `
            + (negative ? 'a `}` closes a block that was never opened' : `${depth > 0 ? depth : -depth} `
              + `${depth > 0 ? 'unclosed `{`' : 'extra `}`'}`)
          );
        }
      }
    }
    expect(
      broken.join('\n') || 'balanced',
      'Unbalanced CSS. This fails `vite build` with "Unclosed block" while the unit\n'
      + 'suite stays green, so it can be committed without anything going red.\n'
    ).toBe('balanced');
  });

  it('no declaration value swallowed its closing brace', () => {
    /**
     * The specific shape the codemod produced: a var() or value immediately
     * followed by end-of-line inside a minified block, where the next line
     * starts a new selector. Balance alone catches most of it, but this pins
     * the exact regression so the message is actionable.
     */
    const suspicious = [];
    for (const file of files) {
      const raw = fs.readFileSync(file, 'utf8');
      for (const block of styleBlocks(file, raw)) {
        sanitise(block.css).split('\n').forEach((line, i) => {
          // A minified line (many declarations) that ends mid-declaration.
          if ((line.match(/[{]/g) || []).length < 2) return;
          if (/[;{]\s*[a-z-]+\s*:\s*[^;{}]+$/i.test(line.trimEnd())) {
            suspicious.push(`${path.relative(SRC, file).replace(/\\/g, '/')}:${block.line + i}`);
          }
        });
      }
    }
    expect(suspicious.join('\n') || 'clean', 'A minified style line ends in the middle of a declaration.').toBe('clean');
  });
});
