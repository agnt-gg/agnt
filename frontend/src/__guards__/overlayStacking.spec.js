/**
 * OVERLAY STACKING CONTRACTS — two guards against a defect z-index cannot fix.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT
 * ---------------------------------------------------------------------------
 * `z-index` is only comparable WITHIN a stacking context. Both side panels are
 * `position: relative; z-index: 3` (LeftPanel.vue `.left-panel`,
 * RightPanel.vue `.controls-panel`), so each establishes its own stacking
 * context and every descendant is flattened to that 3 when compared against
 * anything outside the panel.
 *
 * A modal rendered inside a panel therefore does not get z-index 1000 against
 * the app — it gets 3. Marketplace's pinned toolbar (`.mk-toolbar`, z-index 5,
 * in the centre column) outranked it and painted straight over the modal.
 * Raising the modal's z-index cannot help: 10000 caps to 3 exactly as 1000
 * does. That is the "no matter what" signature of a stacking-context cap, and
 * it is diagnosed by walking ancestors, never by reading the element's own
 * z-index.
 *
 * ---------------------------------------------------------------------------
 * GUARD 1 — viewport overlays inside panels must be teleported to <body>
 * ---------------------------------------------------------------------------
 * A viewport-covering overlay is by definition supposed to cover the whole
 * app, so it must be a child of <body> and not of any subtree that can trap
 * it. Vue's <Teleport to="body"> does exactly that and keeps scoped styles
 * working (the data-v attribute travels with the element).
 *
 * Scope is the two panel trees plus the shared component library (whose
 * components are mounted INTO those panels — MarketplaceFormModal is used by
 * four different panels). Those are the subtrees where a capping ancestor
 * provably exists today, so the rule holds with no exceptions and no debt.
 *
 * ---------------------------------------------------------------------------
 * GUARD 2 — a screen may only outrank the chrome if it isolates
 * ---------------------------------------------------------------------------
 * Guard 1 fixes overlays. It does not stop a screen from shipping a local
 * z-index that outranks the panels for some other element. `isolation:
 * isolate` on the screen root confines the whole screen's z-index space to a
 * private stacking context, which makes screen-internal layering literally
 * inexpressible against app chrome. This guard pins that for Marketplace,
 * which needs z-index 5 on its sticky toolbar to sit above card internals.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Subtrees whose components are mounted inside a stacking-context-forming panel. */
const PANEL_TREES = [
  'views/Terminal/LeftPanel',
  'views/Terminal/RightPanel',
  'views/_components',
];

/** Overlay-scale z-index. Below this a value is ordinary in-flow layering. */
const OVERLAY_Z = 50;

const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function vueFilesUnder(rel) {
  const root = path.join(SRC, rel);
  if (!fs.existsSync(root)) return [];
  const out = [];
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // raced with another process; nothing to check here
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.vue')) out.push(p);
    }
  })(root);
  return out;
}

/** Rules that position a viewport-covering fixed overlay at overlay-scale z-index. */
function viewportOverlayRules(css) {
  const found = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2];
    if (!/position\s*:\s*fixed/.test(body)) continue;
    const z = /(?:^|[;{\s])z-index\s*:\s*(-?\d+)/.exec(body);
    if (!z || parseInt(z[1], 10) < OVERLAY_Z) continue;
    const coversViewport =
      /inset\s*:\s*0/.test(body) ||
      (/top\s*:\s*0/.test(body) &&
        /left\s*:\s*0/.test(body) &&
        (/right\s*:\s*0/.test(body) || /width\s*:\s*100(?:vw|%)/.test(body))) ||
      (/width\s*:\s*100vw/.test(body) && /height\s*:\s*100vh/.test(body));
    if (!coversViewport) continue;
    found.push({ selector: m[1].trim().replace(/\s+/g, ' '), z: parseInt(z[1], 10) });
  }
  return found;
}

/**
 * Is the element bearing `cls` inside a <Teleport>?
 *
 * Matches the element that actually CARRIES the class. A plain substring
 * search for "modal" finds `<SimpleModal>` first and answers about the wrong
 * node — which reported a correctly teleported component as broken.
 */
function classIsInsideTeleport(src, cls) {
  const template = /<template>([\s\S]*)<\/template>/.exec(src)?.[1] ?? src;
  const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bearer = new RegExp(`class="[^"]*\\b${escaped}\\b[^"]*"`);
  const hit = bearer.exec(template);
  if (!hit) return null; // selector is not a literal class in this template
  const before = template.slice(0, hit.index);
  const opens = (before.match(/<Teleport\b/gi) || []).length;
  const closes = (before.match(/<\/Teleport>/gi) || []).length;
  return opens > closes;
}

describe('overlay stacking contracts', () => {
  it('every viewport-covering fixed overlay in a panel subtree is teleported to <body>', () => {
    const offenders = [];
    let overlaysChecked = 0;

    for (const tree of PANEL_TREES) {
      for (const file of vueFilesUnder(tree)) {
        let src;
        try {
          src = fs.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
          .map((m) => stripCssComments(m[1]))
          .join('\n');
        if (!css) continue;

        for (const rule of viewportOverlayRules(css)) {
          const cls = /\.([a-zA-Z0-9_-]+)/.exec(rule.selector)?.[1];
          if (!cls) continue;
          const inside = classIsInsideTeleport(src, cls);
          if (inside === null) continue; // not a literal class in this template
          overlaysChecked++;
          if (!inside) {
            offenders.push(
              `${path.relative(SRC, file).replace(/\\/g, '/')}  ${rule.selector} (z-index: ${rule.z})`
            );
          }
        }
      }
    }

    // Anti-vacuity: if the detector stops finding overlays the guard is dead.
    expect(overlaysChecked).toBeGreaterThanOrEqual(6);

    expect(
      offenders,
      `These overlays cover the viewport but render inside a side panel, which is\n` +
        `position: relative; z-index: 3 and therefore caps them. Their z-index is\n` +
        `inert against anything outside the panel no matter how large it is.\n` +
        `Wrap each in <Teleport to="body">:\n  ` +
        offenders.join('\n  ')
    ).toEqual([]);
  });

  it('the panel z-index this guard exists for is still in the source', () => {
    // If the panels stop establishing stacking contexts, guard 1's rationale
    // changes and should be re-derived rather than silently kept.
    const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
    const rightCss = stripCssComments(read('views/Terminal/RightPanel/RightPanel.vue'));
    const leftCss = stripCssComments(read('views/Terminal/LeftPanel/LeftPanel.vue'));
    const zOf = (css, sel) => {
      const m = new RegExp(`(?:^|[}\\s])${sel.replace('.', '\\.')}\\s*\\{([^{}]*)\\}`).exec(css);
      const z = m && /(?:^|[;{\s])z-index\s*:\s*(-?\d+)/.exec(m[1]);
      return z ? parseInt(z[1], 10) : null;
    };
    expect(zOf(rightCss, '.controls-panel')).toBe(3);
    expect(zOf(leftCss, '.left-panel')).toBe(3);
  });

  it('Marketplace isolates, because its toolbar z-index outranks the chrome', () => {
    const src = fs.readFileSync(
      path.join(SRC, 'views/Terminal/CenterPanel/screens/Marketplace/Marketplace.vue'),
      'utf8'
    );
    const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((m) => stripCssComments(m[1]))
      .join('\n');

    const toolbar = /(?:^|[}\s])\.mk-toolbar\s*\{([^{}]*)\}/.exec(css);
    expect(toolbar, '.mk-toolbar rule not found').toBeTruthy();
    // The toolbar moved out of the scroll container and dropped its z-index
    // along with the sticky positioning it existed to order. A rule with no
    // z-index cannot outrank anything, so read it as absent rather than
    // indexing a null match — that threw instead of reporting.
    const zMatch = /(?:^|[;{\s])z-index\s*:\s*(-?\d+)/.exec(toolbar[1]);
    const toolbarZ = zMatch ? parseInt(zMatch[1], 10) : null;

    // Whenever it DOES carry one it has to outrank card internals (.mk-art-*
    // use 2 and 3), which is exactly what makes it outrank the panels too —
    // unless the screen root isolates. Assert the specific rule body, not
    // merely "the string appears somewhere in the file".
    // Check EVERY .marketplace-panel rule body, not just the first: a selector
    // can legitimately appear more than once, and matching only the first
    // reports a correct declaration as missing.
    const panelRules = [...css.matchAll(/(?:^|[}\s])\.marketplace-panel\s*\{([^{}]*)\}/g)];
    expect(panelRules.length, '.marketplace-panel rule not found').toBeGreaterThan(0);
    const isolates = panelRules.some((m) => /isolation\s*:\s*isolate/.test(m[1]));

    expect(
      toolbarZ === null || toolbarZ <= 3 || isolates,
      `.mk-toolbar has z-index ${toolbarZ}, which outranks the side panels (3).\n` +
        `That is only safe while .marketplace-panel declares isolation: isolate,\n` +
        `which confines the screen's z-index space to its own stacking context.`
    ).toBe(true);

    // The confinement is still required by the card internals even now that the
    // toolbar has no z-index, so it must not be deleted as newly-unused.
    expect(isolates, '.marketplace-panel must keep isolation: isolate').toBe(true);
  });
});
