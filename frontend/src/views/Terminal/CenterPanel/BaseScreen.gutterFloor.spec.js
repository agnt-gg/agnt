/**
 * Gutter floor for the centered-column list screens.
 *
 * These screens' content columns are capped at 1048px and centered — a cap
 * that only creates side gutters when the center column is WIDER than 1048px.
 * For years they also carried per-page `.main-panel { padding: 16px 0 }`
 * overrides, so the moment the center column dropped below ~1048px (narrow
 * window, wide side panels) the only gutter source vanished and every toolbar,
 * tab row and card sat flush against the panel edge (measured live
 * 2026-07-31: 0px gutter on marketplace/agents/workflows/tools/widget-manager
 * at a 1011px center column).
 *
 * The fix: those overrides were DELETED so the screens inherit the base
 * `.main-panel { padding: 16px 12px }` — the 12px side padding is the floor.
 * /traces proved this layout live (its stale 'terminal-runs' override had
 * silently stopped matching after the Runs→Traces rename, landing it on the
 * base rule — the only clean list screen before the fix).
 *
 * This spec pins:
 *   1. none of the list pages regrows a horizontal-zero padding override
 *   2. the base .main-panel rule keeps its nonzero side padding
 *
 * NOTE: `.scrollable-content` is NOT the place for this padding — it has
 * `width: 100%` with no border-box, so horizontal padding there overflows the
 * panel and produces zero visible gutter (measured before this fix landed).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'BaseScreen.vue'), 'utf8');

/** Strip CSS comments so prose mentioning selectors can never satisfy (or trip) an assertion. */
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

const css = stripCssComments(src);

/** List screens whose gutters must survive a sub-1048px center column. */
const LIST_PAGES = [
  'terminal-marketplace',
  'terminal-workflows',
  'terminal-widget-manager',
  'terminal-tools',
  'terminal-agents',
  'terminal-runs', // stale since the Runs→Traces rename; must not come back either
  'terminal-traces',
];

/** Extract every rule ({selector, body}) from the comment-stripped source. */
function extractRules(text) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    rules.push({ selector: m[1].trim(), body: m[2].trim() });
  }
  return rules;
}

const rules = extractRules(css);

/** Does this padding shorthand zero the horizontal axis? (e.g. "16px 0", "0", "16px 0px") */
function zeroesHorizontal(padding) {
  const parts = padding.trim().split(/\s+/);
  // 1 value: all sides; 2 values: v h; 3 values: t h b; 4 values: t r b l
  const horizontal =
    parts.length === 1 ? [parts[0], parts[0]]
    : parts.length === 2 ? [parts[1], parts[1]]
    : parts.length === 3 ? [parts[1], parts[1]]
    : [parts[1], parts[3]];
  return horizontal.some((v) => /^0(px)?$/.test(v));
}

describe('BaseScreen gutter floor (centered-column list screens)', () => {
  it.each(LIST_PAGES)('%s has no .main-panel override zeroing horizontal padding', (page) => {
    const offenders = rules.filter((r) => {
      if (!r.selector.includes(`body[data-page='${page}'] .main-panel`)) return false;
      const pad = (r.body.match(/(?:^|;)\s*padding:\s*([^;]+)/) || [])[1];
      return pad ? zeroesHorizontal(pad) : false;
    });
    expect(offenders, `${page} regrew a flush-edge padding override: ${JSON.stringify(offenders)}`).toEqual([]);
  });

  it('the base .main-panel rule keeps nonzero side padding (the gutter floor itself)', () => {
    const base = rules.find((r) => r.selector === '.main-panel' && /padding:/.test(r.body));
    expect(base, 'base .main-panel padding rule missing').toBeTruthy();
    const pad = base.body.match(/padding:\s*([^;]+)/)[1];
    expect(zeroesHorizontal(pad), `base .main-panel padding "${pad}" must not zero the horizontal axis`).toBe(false);
  });

  it('anti-vacuity: pages that legitimately zero padding are still visible to the extractor', () => {
    // chat/artifacts/workflow-forge own their spacing end to end — their
    // zero-padding overrides are deliberate and prove the extractor works.
    const deliberate = rules.filter(
      (r) => /body\[data-page='terminal-(chat|artifacts|workflow-forge)'\] \.main-panel/.test(r.selector)
        && /padding:\s*0/.test(r.body)
    );
    expect(deliberate.length).toBeGreaterThan(0);
  });

  it('anti-vacuity: comment stripping is real (selectors named only in prose do not count)', () => {
    const probe = "/* body[data-page='terminal-marketplace'] .main-panel { padding: 16px 0 } */";
    expect(stripCssComments(probe)).not.toContain('padding: 16px 0');
  });

  it('the horizontal-zero detector reads every shorthand arity correctly', () => {
    expect(zeroesHorizontal('16px 0')).toBe(true);
    expect(zeroesHorizontal('16px 0px')).toBe(true);
    expect(zeroesHorizontal('0')).toBe(true);
    expect(zeroesHorizontal('16px 0 8px')).toBe(true);
    expect(zeroesHorizontal('16px 0 8px 12px')).toBe(true);
    expect(zeroesHorizontal('16px 12px')).toBe(false);
    expect(zeroesHorizontal('16px')).toBe(false);
    expect(zeroesHorizontal('16px 12px 8px 12px')).toBe(false);
  });
});
