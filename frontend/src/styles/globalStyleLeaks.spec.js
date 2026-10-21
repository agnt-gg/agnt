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
 * It blanked the Workspaces pane headers — title, maximise, and close — and
 * the symptom ("I don't see a close button") pointed nowhere near the cause.
 * That is the defining property of this bug class: the blast radius is the
 * whole app, and the evidence is in a file nobody would think to open.
 *
 * A one-line fix to that rule would not stop the next one. This does: it fails
 * the build for ANY unscoped rule that hides a bare element selector.
 *
 * PAGE-WIDE IS STILL APP-WIDE (2026-10-21)
 * ─────────────────────────
 * The fix above qualified the rule as `body[data-page='terminal-workflow-forge']
 * header`, and this guard allowed it. That still hides every <header> while the
 * page is open, the app's own frame included: AGNT One's top bar is a <header>,
 * so on the Workflow Forge the window had no minimize/maximize/close and no
 * drag bar. A qualifier made only of the document (body, html, :root, with any
 * attributes or classes) names a PAGE, not an owner, so it is flagged too.
 *
 * What is deliberately still allowed:
 *   - scoped / module blocks (they cannot leak by construction)
 *   - unscoped rules whose target or an ancestor is a component's own class,
 *     id, or attribute (e.g. `.foo img`, `.content p:empty`)
 *   - pseudo-elements (`body::-webkit-scrollbar`): they style a scrollbar,
 *     they do not remove an element
 *   - unscoped element rules that do not HIDE (typography, resets, iframe
 *     bodies); those are visible in review and rarely catastrophic
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Negative-control fixtures are written OUTSIDE src/. Vitest runs spec files in
// parallel workers, and other guards (__guards__/uiContracts.spec.js) walk src/ from disk —
// a fixture that exists at readdir() time and is gone by readFileSync() time
// makes those guards fail with ENOENT at random. findLeaks() only needs a
// readable path, so keeping fixtures out of the scanned tree removes the race
// entirely rather than making every reader defend against it.
const tmpFixture = (name, contents) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-style-leak-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

function vueFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out; // removed mid-walk
    throw err;
  }
  for (const entry of entries) {
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

/** A compound that names the document: body / html / :root, with any attributes, classes or pseudo-classes. */
const isDocumentCompound = (compound) => /^(body|html|:root)(?![\w-])/.test(compound);

/**
 * `body[data-page='x'] header`: a bare element whose only qualifiers are the
 * document itself. It reaches that element everywhere on the page.
 */
const isPageWideElementSelector = (selector) =>
  selector
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((part) => {
      const compounds = part.split(/\s*[\s>+~]\s*/).filter(Boolean);
      const tail = compounds.pop() || '';
      return compounds.length > 0 && /^[a-zA-Z][\w-]*$/.test(tail) && compounds.every(isDocumentCompound);
    });

function findLeaks(file) {
  const source = fs.readFileSync(file, 'utf8');
  const leaks = [];

  const styleBlocks = source.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g);
  for (const block of styleBlocks) {
    const attrs = block[1] || '';
    if (/\bscoped\b|\bmodule\b/.test(attrs)) continue;

    // Comments go first, from the whole block: one that quotes a rule (the
    // WorkflowDesigner comment quoted `header { display: none }`) has braces
    // that split the parse, and the real rule after it was never examined.
    const css = block[2].replace(/\/\*[\s\S]*?\*\//g, '');
    // Rule-level scan. At-rules (@media/@keyframes) nest braces, so skip any
    // selector that is actually an at-rule preamble.
    const rules = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
    for (const rule of rules) {
      const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!selector || selector.startsWith('@') || selector.startsWith('%')) continue;
      if (!isBareElementSelector(selector) && !isPageWideElementSelector(selector)) continue;
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
    const leaks = files.flatMap((file) => {
      try {
        return findLeaks(file);
      } catch (err) {
        if (err.code === 'ENOENT') return []; // vanished between listing and read
        throw err;
      }
    });
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
    const { file: tmp, cleanup } = tmpFixture(
      '__leak_probe__.vue',
      '<template><div/></template>\n<style>\nheader { display: none !important; }\n</style>\n',
    );
    try {
      const found = findLeaks(tmp);
      expect(found).toHaveLength(1);
      expect(found[0].selector).toBe('header');
    } finally {
      cleanup();
    }
  });

  it('sees a rule that follows a comment quoting a rule', () => {
    const { file: tmp, cleanup } = tmpFixture(
      '__leak_probe_comment__.vue',
      '<template><div/></template>\n<style>\n/* was `header { display: none }` */\nheader { display: none; }\n</style>\n',
    );
    try {
      expect(findLeaks(tmp).map((l) => l.selector)).toEqual(['header']);
    } finally {
      cleanup();
    }
  });

  it('detects a page-wide rule: a bare element qualified only by the document', () => {
    const { file: tmp, cleanup } = tmpFixture(
      '__leak_probe_page__.vue',
      '<template><div/></template>\n' +
        "<style>\nbody[data-page='terminal-workflow-forge'] header { display: none !important; }\nbody.dark > nav { visibility: hidden; }\nhtml:not(.x) aside { display:none }\n</style>\n",
    );
    try {
      expect(findLeaks(tmp).map((l) => l.selector)).toEqual([
        "body[data-page='terminal-workflow-forge'] header",
        'body.dark > nav',
        'html:not(.x) aside',
      ]);
    } finally {
      cleanup();
    }
  });

  it('does not flag correctly-qualified or scoped rules', () => {
    const { file: tmp, cleanup } = tmpFixture(
      '__leak_probe_ok__.vue',
      '<template><div/></template>\n' +
        "<style>\nbody[data-page='terminal-workflow-forge'] .forge-header { display: none !important; }\n.thing img { display: none; }\n" +
        "body[data-page='docs'] .content p:empty { display: none; }\nbody::-webkit-scrollbar { display: none; }\n</style>\n" +
        '<style scoped>\nheader { display: none; }\n</style>\n',
    );
    try {
      expect(findLeaks(tmp)).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
