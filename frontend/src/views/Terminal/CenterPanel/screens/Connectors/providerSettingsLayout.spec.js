/**
 * Default AI Provider page — the LAYOUT CONTRACT.
 *
 * WHY A TEST FOR A LAYOUT
 * ───────────────────────
 * This page rotted once already, and it rotted in a way no functional test
 * could see: nine sibling blocks in one flat scroll, three different toggle
 * patterns, three different "saved" indicators, two heading levels, and the
 * newest feature parked on top of the one people actually came for. Every
 * individual control worked perfectly. The PAGE was the defect.
 *
 * Nothing in a unit test that mounts a component catches "these four sections
 * are in the wrong order" or "this is the fourth way to draw a toggle". So the
 * contract is asserted at the source level, the same way this repo already
 * guards token usage (themeTokens.spec.js) and provider containment.
 *
 * THE CONTRACT
 *   1. Cards render in frequency order: Model → Fallback → Instructions → Limits.
 *   2. Dynamic routing is a MODE inside card 01, never a card of its own.
 *   3. Every card body has top padding.  ← the reported bug
 *   4. One card idiom, one toggle idiom per behaviour, one save idiom.
 *   5. Collapsed cards print their value in the header.
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
const CARD = read('../../../../_components/common/SettingsCard.vue');

/**
 * The `<style>` block, with comments stripped.
 *
 * Both halves matter. Templates and prose mention colours legitimately, so a
 * whole-file scan produces false positives — and so does a comment DOCUMENTING
 * a colour that was removed, which is exactly what tripped the first version of
 * this file. themeTokens.spec.js strips comments for the same reason.
 */
const styleOf = (src) => {
  const m = src.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  return m ? m[1].replace(/\/\*[\s\S]*?\*\//g, '') : '';
};

describe('the cards render in frequency order', () => {
  it('Connectors renders Model → Fallback → Behaviour, in that order', () => {
    const stack = CONNECTORS.match(/<div class="provider-settings-stack">([\s\S]*?)<\/div>/);
    expect(stack, 'provider-settings-stack not found').toBeTruthy();

    const order = ['ProviderSelector', 'FallbackProviders', 'ChatBehaviorSettings']
      .map((c) => stack[1].indexOf(`<${c}`));

    expect(order.every((i) => i > -1), 'a card component is missing from the stack').toBe(true);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it('the rank numbers match that order and are unique', () => {
    const numOf = (src) => [...src.matchAll(/<SettingsCard[^>]*\snum="(\d+)"/g)].map((m) => m[1]);

    expect(numOf(PROVIDER)).toEqual(['01']);
    expect(numOf(FALLBACK)).toEqual(['02']);
    expect(numOf(BEHAVIOR)).toEqual(['03', '04']);

    const all = [...numOf(PROVIDER), ...numOf(FALLBACK), ...numOf(BEHAVIOR)];
    expect(new Set(all).size, 'duplicate card numbers').toBe(all.length);
  });

  it('exactly one card is the hero, and it is the model card', () => {
    const heroes = [PROVIDER, FALLBACK, BEHAVIOR].filter((s) => /<SettingsCard[^>]*\shero/.test(s));
    expect(heroes).toHaveLength(1);
    expect(heroes[0]).toBe(PROVIDER);
  });
});

describe('dynamic routing is a MODE, not a section', () => {
  /**
   * The whole point of the redesign. Routing is the second answer to "which
   * model answers?", so it belongs inside that card. Given its own card it
   * would sit above the model pickers — the rarest decision above the most
   * common one — and would force the pickers to explain themselves whenever it
   * was on.
   */
  it('the routing controls live inside the model card', () => {
    expect(PROVIDER).toMatch(/policy-btn/);
    expect(PROVIDER).toMatch(/setMode\('dynamic'\)/);
    expect(PROVIDER).toMatch(/setMode\('static'\)/);
  });

  it('no other component owns routing CONTROLS', () => {
    // Controls, not prose. The fallback card's "Managed by Annie" banner names
    // the feature on purpose — telling the user why their list is read-only is
    // the entire job of that banner. Asserting on the words would forbid the
    // explanation; asserting on the widgets forbids the duplication.
    for (const [name, src] of [['Connectors', CONNECTORS], ['Behaviour', BEHAVIOR], ['Fallback', FALLBACK]]) {
      expect(src, `${name} must not own routing controls`).not.toMatch(/policy-btn|setRoutingMode|setRoutingPolicy/);
    }
    // And the old standalone card markup is gone for good.
    expect(PROVIDER).not.toMatch(/dyn-routing-card/);
  });

  it('the fallback card still EXPLAINS itself when routing manages it', () => {
    // The complement of the rule above: no controls, but the reason must be
    // stated, and the saved rows must be preserved rather than deleted.
    expect(FALLBACK).toMatch(/fb-managed/);
    expect(FALLBACK).toMatch(/Managed by Annie/);
    expect(FALLBACK).toMatch(/routingMode === 'dynamic'/);
  });

  it('the two modes are mutually exclusive in the template', () => {
    // v-if / v-else, not two independent v-ifs that could both render.
    expect(PROVIDER).toMatch(/v-if="!isDynamic"[\s\S]*?v-else/);
  });
});

describe('THE PADDING BUG — a card body is never flush against its header', () => {
  /**
   * Reported symptom: "the buttons are shoved to the very top with no padding
   * between it and the header" — on every card. The rule was
   * `padding: 0 18px 18px 45px`, i.e. a literal zero on the top edge, directly
   * beneath a 1px header rule.
   */
  it('.settings-card-body declares real padding on all four sides', () => {
    const css = styleOf(CARD);
    const rule = css.match(/\.settings-card-body\s*\{([^}]*)\}/);
    expect(rule, '.settings-card-body rule not found').toBeTruthy();

    const padding = rule[1].match(/padding:\s*([^;]+);/);
    expect(padding, 'no padding declared').toBeTruthy();

    // Reject any shorthand whose FIRST value (the top edge) is zero.
    const first = padding[1].trim().split(/\s+/)[0];
    expect(first, 'top padding is zero — the bug').not.toMatch(/^0(px|em|rem|%)?$/);
  });

  it('the indent variant only overrides the LEFT edge', () => {
    const css = styleOf(CARD);
    const rule = css.match(/\.settings-card-body\.is-indented\s*\{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule[1]).toMatch(/padding-left:/);
    // A full `padding:` shorthand here would silently reset the top edge again.
    expect(rule[1], 'shorthand would clobber the top padding').not.toMatch(/[^-]padding:/);
  });
});

describe('one idiom per job', () => {
  it('every card on the page uses SettingsCard — none rolls its own chrome', () => {
    for (const [name, src] of [['Provider', PROVIDER], ['Fallback', FALLBACK], ['Behaviour', BEHAVIOR]]) {
      expect(src, `${name} must use <SettingsCard>`).toMatch(/<SettingsCard/);
      // The card owns border+radius+padding. A component re-declaring them is
      // drawing a second card inside the first.
      const css = styleOf(src);
      expect(css, `${name} redeclares card chrome`).not.toMatch(/\.(fallback-providers|provider-selector-wrapper)\s*\{[^}]*border-radius:\s*12px/);
    }
  });

  it('the model card no longer owns instructions or tool limits', () => {
    // Those govern every chat surface, not the provider. Keeping them here is
    // what made the page impossible to order.
    for (const dead of ['custom-instructions-textarea', 'tool-output-cap-input', 'max-tool-rounds-input', 'async-tools-switch']) {
      expect(PROVIDER, `${dead} should have moved to ChatBehaviorSettings`).not.toContain(dead);
    }
    for (const moved of ['custom-instructions-textarea', 'tool-output-cap-input', 'max-tool-rounds-input', 'async-tools-switch']) {
      expect(BEHAVIOR).toContain(moved);
    }
  });

  it('there is exactly one save-status idiom', () => {
    // Three different ones was the old state.
    expect([...BEHAVIOR.matchAll(/class="status-indicator/g)].length).toBeGreaterThan(0);
    expect(BEHAVIOR).not.toMatch(/class="save-status|class="saved-badge/);
  });
});

describe('a collapsed card still shows its value', () => {
  /**
   * Collapsing may hide CONTROLS. It must never hide INFORMATION — nobody
   * should have to open a drawer to find out what a setting is currently set to.
   */
  it('the collapsible card supplies a header value', () => {
    const card = BEHAVIOR.match(/<SettingsCard[^>]*\scollapsible[\s\S]*?<\/SettingsCard>/);
    expect(card, 'no collapsible card found').toBeTruthy();
    expect(card[0]).toMatch(/<template #value>/);
    expect(card[0]).toMatch(/limitsSummary/);
  });

  it('that summary names all three of the settings it hides', () => {
    const summary = BEHAVIOR.match(/const limitsSummary = computed\(\(\) => \{([\s\S]*?)\}\);/);
    expect(summary).toBeTruthy();
    expect(summary[1]).toMatch(/toolOutputCapDraft/);
    expect(summary[1]).toMatch(/maxToolRoundsDraft/);
    expect(summary[1]).toMatch(/asyncToolsEnabled/);
  });

  it('SettingsCard renders the value slot even while collapsed', () => {
    // The slot must sit OUTSIDE the v-show'd body, or collapsing hides it.
    const head = CARD.match(/<div\s+class="settings-card-head"[\s\S]*?<\/div>/);
    expect(head[0]).toMatch(/<slot name="value" \/>/);
  });
});

describe('brand fidelity', () => {
  it('no component invents an accent colour', () => {
    for (const [name, src] of [['Card', CARD], ['Provider', PROVIDER], ['Fallback', FALLBACK], ['Behaviour', BEHAVIOR]]) {
      const css = styleOf(src);
      // The blue that a `var(--color-accent, #4a9eff)` fallback would paint.
      expect(css, `${name} contains a non-brand hardcoded accent`).not.toMatch(/#4a9eff/i);
    }
  });

  it('accent tints use the rgb channel token, matching the rest of the app', () => {
    for (const [name, src] of [['Card', CARD], ['Provider', PROVIDER], ['Behaviour', BEHAVIOR]]) {
      const css = styleOf(src);
      if (!/rgba\(var\(--green-rgb\)/.test(css)) continue;
      expect(css, `${name} should not mix color-mix with the rgb idiom`).not.toMatch(/color-mix\(/);
    }
  });
});
