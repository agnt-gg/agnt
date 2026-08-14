/**
 * Default AI Provider page — IT MUST LOOK LIKE EVERY OTHER SETTINGS PAGE.
 *
 * WHY THIS EXISTS
 * ───────────────
 * I rebuilt this page twice and got the chrome wrong both times, because I
 * designed a "card" idiom instead of reading what the app already does. The
 * result was a page that worked correctly and looked like it came from a
 * different product: solid raised panels and a green accent border, on a page
 * whose every other section is transparent and borderless.
 *
 * THE HOUSE IDIOM, read out of the files rather than invented:
 *
 *   Connectors.vue        .connectors-section  background: transparent;
 *                                              border: none;
 *                                              padding: 24px;
 *                                              border-radius: 16px;
 *   Webhooks.vue          .webhooks-header     margin-bottom: 24px;
 *   Plugins.vue           ...-header h3        margin: 0 0 8px 0;
 *                                              font-size: 1.5em;
 *                                              color: var(--color-text);
 *   Webhooks.vue          .subtitle            color: var(--color-light-med-navy);
 *                                              font-size: 0.9em;
 *
 * A visual mismatch is invisible to every test that mounts a component — it
 * renders perfectly, it just belongs to another app. So the contract is
 * asserted at the source level, the same way this repo already guards token
 * usage (themeTokens.spec.js).
 *
 * If you are changing this page: copy the rules above. Do not improve them.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(DIR, rel), 'utf8');

const CONNECTORS = read('./Connectors.vue');
const PROVIDER = read('../Settings/components/ProviderSelector/ProviderSelector.vue');
const FALLBACK = read('./components/FallbackProviders.vue');
const BEHAVIOR = read('./components/ChatBehaviorSettings.vue');

/** The reference implementations. These are the source of truth, not me. */
const WEBHOOKS = read('./components/Webhooks.vue');

const SECTIONS = [
  ['ProviderSelector', PROVIDER, '.provider-section'],
  ['FallbackProviders', FALLBACK, '.fallback-providers'],
  ['ChatBehaviorSettings', BEHAVIOR, '.behavior-section'],
];

/**
 * The `<style>` block with comments stripped.
 *
 * Both halves matter. Templates and prose mention colours legitimately, and so
 * does a comment DOCUMENTING a colour that was removed — which is exactly what
 * tripped an earlier version of this file. themeTokens.spec.js strips comments
 * for the same reason.
 */
const styleOf = (src) => {
  const m = src.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  return m ? m[1].replace(/\/\*[\s\S]*?\*\//g, '') : '';
};

/** The declaration block of one CSS rule, by exact selector. */
const ruleOf = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return m ? m[2] : null;
};

const decl = (block, prop) => {
  const m = block && block.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm'));
  return m ? m[1].trim() : null;
};

describe('the page is laid out the way every other settings page is', () => {
  it('renders its sections inside .connectors-grid, like every other section', () => {
    // .connectors-content (max-width 1048px, margin 0 auto) + .connectors-grid
    // (flex column, gap 16px) is what gives every other page its margins. An
    // earlier version used a bespoke .provider-settings-stack, which dropped
    // the 24px section padding and made the page run edge to edge.
    const grid = CONNECTORS.match(/<div class="connectors-grid">\s*<ProviderSelector[\s\S]*?<\/div>/);
    expect(grid, 'sections are not inside .connectors-grid').toBeTruthy();
    expect(CONNECTORS, 'the bespoke stack wrapper is back').not.toMatch(/provider-settings-stack/);
  });

  it('renders the sections in order: model, fallback, behaviour', () => {
    const stack = CONNECTORS.match(/<div class="connectors-grid">([\s\S]*?)<\/div>/);
    const order = ['ProviderSelector', 'FallbackProviders', 'ChatBehaviorSettings']
      .map((c) => stack[1].indexOf(`<${c}`));

    expect(order.every((i) => i > -1), 'a section is missing').toBe(true);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });
});

describe('every section uses the .connectors-section chrome verbatim', () => {
  it.each(SECTIONS)('%s root is transparent, borderless, 24px, 16px radius', (_name, src, selector) => {
    const block = ruleOf(styleOf(src), selector);
    expect(block, `${selector} rule not found`).toBeTruthy();

    expect(decl(block, 'background')).toBe('transparent');
    expect(decl(block, 'border')).toBe('none');
    expect(decl(block, 'padding')).toBe('24px');
    expect(decl(block, 'border-radius')).toBe('16px');
  });

  it.each(SECTIONS)('%s draws no panel of its own', (_name, src, selector) => {
    // SCOPED TO THE SECTION ROOT ON PURPOSE.
    //
    // Green borders are house style on CONTROLS — .preset-chip.active and
    // .fb-tier both use them, and so does the Managed-by-Annie banner. A
    // stylesheet-wide ban on accent borders would forbid the very idiom this
    // spec exists to enforce. What must never carry an accent is the SECTION
    // CHROME, because no other section on the page has any chrome at all.
    const css = styleOf(src);
    const root = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rootRules = [...css.matchAll(new RegExp(`(?:^|\\})\\s*(${root}[^{,}]*)\\{([^}]*)\\}`, 'gm'))];

    expect(rootRules.length, `no rule found for ${selector}`).toBeGreaterThan(0);

    for (const [, sel, block] of rootRules) {
      expect(block, `${sel.trim()} paints a raised surface`).not.toMatch(/background:\s*var\(--surface-raised\)/);
      expect(block, `${sel.trim()} paints an accent border`).not.toMatch(/border(-color)?:[^;]*(--green-rgb|--color-green|--color-primary|--color-accent)/);
      // Checked as a VALUE, not with a negative lookahead: `\s*` backtracks to
      // zero-width and lets `(?!transparent)` pass on the very string it is
      // meant to reject, so the lookahead form silently accepts everything.
      const bg = decl(block, 'background');
      if (bg !== null) {
        expect(['transparent', 'none'], `${sel.trim()} paints a solid background: ${bg}`).toContain(bg);
      }
    }
  });
});

describe('every section header is the house header', () => {
  /** The reference values, read out of Webhooks.vue at run time. */
  const refHeader = ruleOf(styleOf(WEBHOOKS), '.webhooks-header');
  const refH3 = ruleOf(styleOf(WEBHOOKS), '.webhooks-header h3');
  const refSub = ruleOf(styleOf(WEBHOOKS), '.subtitle');

  it('the reference implementation still says what this spec thinks it says', () => {
    // If Webhooks.vue changes, this spec should fail loudly rather than keep
    // enforcing values that are no longer the house style.
    expect(decl(refHeader, 'margin-bottom')).toBe('24px');
    expect(decl(refH3, 'font-size')).toBe('1.5em');
    expect(decl(refH3, 'color')).toBe('var(--color-text)');
    expect(decl(refSub, 'font-size')).toBe('0.9em');
    expect(decl(refSub, 'color')).toBe('var(--color-light-med-navy)');
  });

  it.each(SECTIONS)('%s header matches Webhooks.vue exactly', (_name, src) => {
    const css = styleOf(src);

    const header = ruleOf(css, '.section-header');
    expect(header, '.section-header rule not found').toBeTruthy();
    expect(decl(header, 'margin-bottom')).toBe(decl(refHeader, 'margin-bottom'));

    const h3 = ruleOf(css, '.section-header h3');
    expect(h3, '.section-header h3 rule not found').toBeTruthy();
    expect(decl(h3, 'font-size')).toBe(decl(refH3, 'font-size'));
    expect(decl(h3, 'color')).toBe(decl(refH3, 'color'));
    expect(decl(h3, 'margin')).toBe(decl(refH3, 'margin'));

    const sub = ruleOf(css, '.subtitle');
    expect(sub, '.subtitle rule not found').toBeTruthy();
    expect(decl(sub, 'font-size')).toBe(decl(refSub, 'font-size'));
    expect(decl(sub, 'color')).toBe(decl(refSub, 'color'));
  });

  it.each(SECTIONS)('%s uses an h3 with a subtitle, not a bespoke title element', (_name, src) => {
    expect(src).toMatch(/<div class="section-header">/);
    expect(src).toMatch(/<h3>/);
    expect(src).toMatch(/class="subtitle"/);
  });

  it('no section invents card chrome or rank numbering', () => {
    for (const [name, src] of SECTIONS.map(([n, s]) => [n, s])) {
      expect(src, `${name} still uses the removed card component`).not.toMatch(/SettingsCard/);
      expect(src, `${name} still renders rank numbers`).not.toMatch(/settings-card-num/);
    }
  });
});

describe('dynamic routing is a MODE, not a section', () => {
  /**
   * Routing is the second answer to "which model?", so it belongs inside that
   * section. Given its own section it would sit above the model pickers — the
   * rarest decision above the most common one — and would force the pickers to
   * explain themselves whenever it was on.
   */
  it('the routing controls live inside the model section', () => {
    expect(PROVIDER).toMatch(/policy-btn/);
    expect(PROVIDER).toMatch(/setMode\('dynamic'\)/);
    expect(PROVIDER).toMatch(/setMode\('static'\)/);
  });

  it('the two modes are mutually exclusive in the template', () => {
    // v-if / v-else, not two independent v-ifs that could both render.
    expect(PROVIDER).toMatch(/v-if="!isDynamic"[\s\S]*?v-else/);
  });

  it('no other component owns routing CONTROLS', () => {
    // Controls, not prose. The fallback section's "Managed by Annie" banner
    // names the feature on purpose — telling the user why their list is
    // read-only is the entire job of that banner. Asserting on the words would
    // forbid the explanation; asserting on the widgets forbids the duplication.
    for (const [name, src] of [['Connectors', CONNECTORS], ['Behaviour', BEHAVIOR], ['Fallback', FALLBACK]]) {
      expect(src, `${name} must not own routing controls`).not.toMatch(/policy-btn|setRoutingMode|setRoutingPolicy/);
    }
  });

  it('the fallback section still EXPLAINS itself when routing manages it', () => {
    expect(FALLBACK).toMatch(/fb-managed/);
    expect(FALLBACK).toMatch(/Managed by Annie/);
    expect(FALLBACK).toMatch(/routingMode === 'dynamic'/);
  });
});

describe('one idiom per job', () => {
  it('the model section no longer owns instructions or tool limits', () => {
    // Those govern every chat surface, not the provider. Keeping them there is
    // what made the page impossible to order.
    for (const moved of ['custom-instructions-textarea', 'tool-output-cap-input', 'max-tool-rounds-input', 'async-tools-switch']) {
      expect(PROVIDER, `${moved} should have moved to ChatBehaviorSettings`).not.toContain(moved);
      expect(BEHAVIOR, `${moved} should live in ChatBehaviorSettings`).toContain(moved);
    }
  });

  it('there is exactly one save-status idiom', () => {
    expect([...BEHAVIOR.matchAll(/class="status-indicator/g)].length).toBeGreaterThan(0);
    expect(BEHAVIOR).not.toMatch(/class="save-status|class="saved-badge/);
  });
});

describe('brand fidelity', () => {
  it('no component invents an accent colour', () => {
    for (const [name, src] of SECTIONS.map(([n, s]) => [n, s])) {
      // The blue a `var(--color-accent, #4a9eff)` fallback would paint.
      expect(styleOf(src), `${name} contains a non-brand hardcoded accent`).not.toMatch(/#4a9eff/i);
    }
  });

  it('accent tints use the rgb channel token, matching the rest of the app', () => {
    for (const [name, src] of SECTIONS.map(([n, s]) => [n, s])) {
      const css = styleOf(src);
      if (!/rgba\(var\(--green-rgb\)/.test(css)) continue;
      expect(css, `${name} should not mix color-mix with the rgb idiom`).not.toMatch(/color-mix\(/);
    }
  });
});
