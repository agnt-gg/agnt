/**
 * Guard: no component may hide a bare HTML element globally.
 *
 * WHY (2026-07-26)
 * ────────────────
 * WorkflowDesigner.vue shipped this inside an UNSCOPED <style> block:
 *
 *     header { display: none !important; }
 *
 * Every other rule in that same block was prefixed
 * `body[data-page='terminal-workflow-forge']`, so the intent was clearly
 * page-scoped — but this one rule was not, and an unscoped rule in a Vue SFC
 * is global. The moment the Workflow Forge chunk loaded, EVERY <header>
 * element in the entire application disappeared, permanently, for the rest of
 * the session.
 *
 * It blanked the One Canvas pane headers — title, maximise, and close — and
 * the symptom ("I don't see a close button") pointed nowhere near the cause.
 * That is the defining property of this bug class: the blast radius is the
 * whole app, and the evidence is in a file nobody would think to open.
 *
 * A one-line fix to that rule would not stop the next one. This does: it fails
 * the build for ANY unscoped rule that hides a bare element selector.
 *
 * What is deliberately still allowed:
 *   - scoped / module blocks (they cannot leak by construction)
 *   - unscoped rules whose selector is qualified by a class, id, or attribute
 *     (e.g. `body[data-page='x'] header`, `.foo img`) — that is the correct
 *     way to write an intentional global
 *   - unscoped element rules that do not HIDE (typography, resets, iframe
 *     bodies); those are visible in review and rarely catastrophic
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function vueFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) vueFiles(p, out);
    else if (entry.name.endsWith('.vue')) out.push(p);
  }
  return out;
}

/** A selector that is nothing but element names — no class, id, or attribute. */
const isBareElementSelector = (selector) =>
  selector
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .every((s) => /^[a-zA-Z][\w-]*$/.test(s));

const HIDES = /(^|[;{\s])(display\s*:\s*none|visibility\s*:\s*hidden)/i;

function findLeaks(file) {
  const source = fs.readFileSync(file, 'utf8');
  const leaks = [];

  const styleBlocks = source.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g);
  for (const block of styleBlocks) {
    const attrs = block[1] || '';
    if (/\bscoped\b|\bmodule\b/.test(attrs)) continue;

    const css = block[2];
    // Rule-level scan. At-rules (@media/@keyframes) nest braces, so skip any
    // selector that is actually an at-rule preamble.
    const rules = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
    for (const rule of rules) {
      const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!selector || selector.startsWith('@') || selector.startsWith('%')) continue;
      if (!isBareElementSelector(selector)) continue;
      if (!HIDES.test(rule[2])) continue;
      leaks.push({ file: path.relative(SRC, file), selector, declarations: rule[2].trim().slice(0, 80) });
    }
  }
  return leaks;
}

describe('global style leaks', () => {
  const files = vueFiles(SRC);

  it('scans a meaningful number of components', () => {
    // Cheap sanity check: a broken walker returning [] would make the real
    // assertion below pass vacuously forever.
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no unscoped rule that hides a bare element selector', () => {
    const leaks = files.flatMap(findLeaks);
    const report = leaks
      .map((l) => `  ${l.file}\n    ${l.selector} { ${l.declarations} }`)
      .join('\n');
    expect(
      leaks,
      leaks.length
        ? `\nUnscoped global rule(s) hiding a bare element — this hides that element ` +
          `EVERYWHERE in the app once the chunk loads:\n${report}\n\n` +
          `Fix: add 'scoped' to the <style> block, or qualify the selector ` +
          `(e.g. body[data-page='...'] header).\n`
        : undefined,
    ).toEqual([]);
  });

  it('detects the exact pattern that caused the regression', () => {
    // Negative control: the detector must actually fire on the original bug,
    // otherwise the assertion above proves nothing.
    const tmp = path.join(SRC, '__leak_probe__.vue');
    fs.writeFileSync(tmp, '<template><div/></template>\n<style>\nheader { display: none !important; }\n</style>\n');
    try {
      const found = findLeaks(tmp);
      expect(found).toHaveLength(1);
      expect(found[0].selector).toBe('header');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('does not flag correctly-qualified or scoped rules', () => {
    const tmp = path.join(SRC, '__leak_probe_ok__.vue');
    fs.writeFileSync(
      tmp,
      '<template><div/></template>\n' +
        "<style>\nbody[data-page='terminal-workflow-forge'] header { display: none !important; }\n.thing img { display: none; }\n</style>\n" +
        '<style scoped>\nheader { display: none; }\n</style>\n',
    );
    try {
      expect(findLeaks(tmp)).toEqual([]);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
