/**
 * GUARD — screens use the shared parts instead of re-rolling them.
 *
 * Every rule here exists because the codebase had already drifted: five
 * screens carried a byte-identical filter-tab stylesheet, four carried a
 * byte-identical content wrapper, and the card grids had quietly diverged on
 * padding (`16px` vs `16px 0`) and column width (300px vs 320px). Nobody chose
 * any of that — it is what happens when the next screen is made by copying the
 * last one.
 *
 * These tests fail the moment a copy comes back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = path.resolve(__dirname, '..');
const SCREENS = path.join(SRC, 'views/Terminal/CenterPanel/screens');
const SHARED_CSS = path.join(SRC, 'styles/components/_screen-layout.css');

/** Every .vue under screens/, with its scoped CSS isolated. */
const screenFiles = () => {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.vue')) {
        const raw = fs.readFileSync(p, 'utf8');
        out.push({
          rel: path.relative(SCREENS, p).replace(/\\/g, '/'),
          raw,
          css: (raw.match(/<style[\s\S]*?<\/style>/g) || []).join('\n'),
        });
      }
    }
  };
  walk(SCREENS);
  return out;
};

/** Declarations of a top-level rule for `selector`, ignoring @media variants. */
const ruleBodies = (css, selector) => {
  const re = new RegExp(`(^|\\})\\s*\\${selector}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[2].trim());
};

describe('the shared screen layout is the only definition', () => {
  const shared = fs.readFileSync(SHARED_CSS, 'utf8');

  it('defines the layout primitives once, globally', () => {
    for (const cls of ['.screen-content', '.screen-main-content', '.card-grid', '.card-row']) {
      expect(shared, `${cls} missing from _screen-layout.css`).toContain(cls);
    }
  });

  it('is imported by main.css so it is actually loaded', () => {
    const main = fs.readFileSync(path.join(SRC, 'styles/main.css'), 'utf8');
    expect(main).toContain('_screen-layout.css');
  });

  it('no screen re-declares the shared layout classes', () => {
    const offenders = [];
    for (const { rel, css } of screenFiles()) {
      for (const cls of ['.screen-content', '.screen-main-content', '.card-grid', '.card-row']) {
        if (ruleBodies(css, cls).length) offenders.push(`${rel} re-declares ${cls}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('the filter tab strip lives in one component', () => {
  it('no screen carries its own .wm-tab stylesheet', () => {
    const offenders = [];
    for (const { rel, css } of screenFiles()) {
      // A bare `.wm-tab { … }` or `.wm-tabs { … }` rule means a copy is back.
      // Parent-scoped overrides (`.agents-panel.has-details.expanded .wm-tabs`)
      // are legitimate and deliberately not matched here.
      if (ruleBodies(css, '.wm-tab').length) offenders.push(`${rel} re-declares .wm-tab`);
      if (ruleBodies(css, '.wm-tabs').length) offenders.push(`${rel} re-declares .wm-tabs`);
    }
    expect(offenders, `use _components/FilterTabs.vue:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('screens that render tabs use the FilterTabs component', () => {
    const offenders = [];
    for (const { rel, raw } of screenFiles()) {
      const markup = raw.split('<style')[0];
      // Hand-rolled tab buttons: a `class="wm-tab"` written in a screen.
      if (/class="wm-tab"/.test(markup)) offenders.push(rel);
    }
    expect(offenders, `hand-rolled tab buttons:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('the entity cards share one frame', () => {
  const CARDS = [
    'Experiments/_components/ExperimentCard.vue',
    'Experiments/_components/InsightCard.vue',
    'EvalDatasets/_components/DatasetCard.vue',
  ];

  /** Rules that belong to EntityCard. A copy here means the fork is back. */
  const FRAME_SELECTORS = [
    '.card-header',
    '.card-title-block',
    '.card-name',
    '.card-category',
    '.card-actions',
    '.card-btn',
    '.card-description',
  ];

  it('every entity card delegates to EntityCard', () => {
    const offenders = [];
    for (const rel of CARDS) {
      const file = path.join(SCREENS, rel);
      if (!fs.existsSync(file)) {
        offenders.push(`${rel} is missing`);
        continue;
      }
      if (!fs.readFileSync(file, 'utf8').includes('EntityCard')) offenders.push(`${rel} no longer uses EntityCard`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('no entity card re-declares the shared frame', () => {
    const offenders = [];
    for (const rel of CARDS) {
      const file = path.join(SCREENS, rel);
      if (!fs.existsSync(file)) continue;
      const css = (fs.readFileSync(file, 'utf8').match(/<style[\s\S]*?<\/style>/g) || []).join('\n');
      for (const selector of FRAME_SELECTORS) {
        if (ruleBodies(css, selector).length) offenders.push(`${rel} re-declares ${selector}`);
      }
    }
    expect(offenders, `these belong to _components/cards/EntityCard.vue:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('the category nav panel lives in one component', () => {
  const TYPES = path.join(SRC, 'views/Terminal/LeftPanel/types');

  it('the browse panels delegate to CategoryNavPanel', () => {
    const delegating = ['AgentsPanel', 'ToolsPanel', 'WorkflowsPanel', 'SkillsPanel', 'WidgetManagerPanel'];
    const offenders = [];
    for (const name of delegating) {
      const file = path.join(TYPES, name, `${name}.vue`);
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw.includes('CategoryNavPanel')) offenders.push(`${name} no longer uses CategoryNavPanel`);
      // Re-growing a local stylesheet is how the five copies started.
      if (/<style/.test(raw)) offenders.push(`${name} grew its own <style> block`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
