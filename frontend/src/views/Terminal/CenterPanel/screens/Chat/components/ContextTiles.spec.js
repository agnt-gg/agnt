import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ContextTiles from './ContextTiles.vue';

const economics = {
  rate: 0.000003,
  cachedRate: 0.0000003,
  floorTokens: 69_079,
  floorCost: 0.207237,
  floorCostCached: 0.0207237,
  systemTokens: 31_645,
  toolTokens: 37_434,
};

const manifest = {
  mode: 'auto',
  economics,
  system: {
    total: 31_645,
    sections: [
      { id: 'memory', label: 'Memory', tokens: 15_310, frozen: true, cost: 0.04593 },
      { id: 'static', label: 'Core instructions', tokens: 10_612, frozen: true, cost: 0.031836 },
      { id: 'skills', label: 'Skills catalog', tokens: 2_863, frozen: true, cost: 0.008589 },
    ],
  },
  tools: {
    total: 37_434,
    count: 3,
    registryTotal: 296,
    hiddenCount: 272,
    droppedCount: 0,
    deniedCount: 0,
    items: [
      { name: 'github_api', tokens: 3_812, reason: 'group', group: 'core', cost: 0.011436 },
      { name: 'execute_shell_command', tokens: 1_104, reason: 'group', group: 'core', cost: 0.003312 },
      { name: 'discover_tools', tokens: 412, reason: 'default', group: null, cost: 0.001236 },
    ],
  },
  messages: { total: 712_011, count: 42, managed: false, reduction: 0 },
  cache: { prefixStable: true },
};

const contextStatus = {
  currentTokens: 781_090,
  tokenLimit: 1_000_000,
  model: 'claude-opus-5',
  messagesCount: 42,
  breakdown: {
    systemTokens: 31_645,
    toolTokens: 37_434,
    messagesTokens: 712_011,
    outputBufferTokens: 32_000,
    calibration: 1.61,
  },
};

const rounds = [
  { round: 1, tokens: 132_540, limit: 1_000_000, prefixBroke: false },
  { round: 2, tokens: 388_120, limit: 1_000_000, prefixBroke: false },
  { round: 3, tokens: 781_090, limit: 1_000_000, prefixBroke: false },
];

const defaults = {
  collapsed: false,
  contextStatus,
  manifest,
  totalTokenUsage: { inputTokens: 8_420_000, outputTokens: 214_000, totalTokens: 8_634_000 },
  totalCost: 12.8433,
  totalUncachedCost: 47.2041,
  totalCacheMetrics: { cacheReadTokens: 7_610_000, cacheCreationTokens: 412_000, uncachedTokens: 398_000, hitRate: '90.4' },
  executionsCount: 42,
  subscriptionBased: false,
  rounds,
  growthPerTurn: 73_000,
  lastTurnCost: 2.4108,
};

const make = (props = {}, slots = {}) =>
  mount(ContextTiles, { props: { ...defaults, ...props }, slots });

const tileKeys = (w) => w.findAll('.tile').map((t) => t.find('.tile-key').text());
const tileByLabel = (w, label) =>
  w.findAll('.tile').find((t) => t.find('.tile-key').text() === label);

describe('ContextTiles — collapsed strip', () => {
  it('carries real numbers in the collapsed state', () => {
    const w = make({ collapsed: true });
    const text = w.find('.tiles-strip').text();
    expect(text).toContain('78%');
    expect(text).toContain('$12.84');
    expect(text).toContain('$34.36');
  });

  it('hides the tiles but keeps the strip when collapsed', () => {
    const w = make({ collapsed: true });
    expect(w.find('.tiles-strip').exists()).toBe(true);
    expect(w.find('.tiles-body').attributes('style')).toContain('display: none');
  });

  it('emits toggle when the strip is clicked', async () => {
    const w = make();
    await w.find('.tiles-strip').trigger('click');
    expect(w.emitted('toggle')).toHaveLength(1);
  });

  it('shows a drift pip only once the estimator is materially off', () => {
    expect(make().find('.strip-pip').exists()).toBe(true);
    const calm = make({
      contextStatus: { ...contextStatus, breakdown: { ...contextStatus.breakdown, calibration: 1.02 } },
    });
    expect(calm.find('.strip-pip').exists()).toBe(false);
  });

  it('renders no cost stats at all on a fresh conversation', () => {
    const w = make({ totalCost: 0, totalUncachedCost: null, executionsCount: 0 });
    const keys = w.findAll('.strip-key').map((k) => k.text());
    expect(keys).not.toContain('spent');
    expect(keys).not.toContain('saved');
    expect(keys).toContain('full');
  });
});

describe('ContextTiles — tiles', () => {
  it('renders the six summary tiles with full data', () => {
    expect(tileKeys(make())).toEqual(['Request', 'Floor / turn', 'Spent', 'Saved', 'Drift', 'This turn']);
  });

  it('shows utilization and the token pair on the request tile', () => {
    const t = tileByLabel(make(), 'Request');
    expect(t.find('.tile-value').text()).toBe('78%');
    expect(t.find('.tile-sub').text()).toBe('781.1k / 1.0M');
  });

  it('states the floor as money, tokens and how many times it was paid', () => {
    const t = tileByLabel(make(), 'Floor / turn');
    expect(t.find('.tile-value').text()).toBe('$0.21');
    expect(t.find('.tile-sub').text()).toContain('69.1k re-sent');
    expect(t.find('.tile-sub').text()).toContain('42');
  });

  it('holds the floor slot with a placeholder when the model has no pricing', () => {
    // Dropping it let auto-fit stretch the surviving tiles across the whole
    // panel, which made a 4% context read as a nearly-full bar.
    const w = make({ manifest: { ...manifest, economics: null } });
    const t = tileByLabel(w, 'Floor / turn');
    expect(t.find('.tile-value').text()).toBe('\u2014');
    expect(t.classes()).toContain('placeholder');
    expect(t.attributes('disabled')).toBeDefined();
  });

  it('never expands a placeholder into an empty drawer', async () => {
    const w = make({ manifest: { ...manifest, economics: null } });
    await tileByLabel(w, 'Floor / turn').trigger('click');
    expect(w.find('.tiles-drawer').exists()).toBe(false);

    // The rendered button is also `disabled`, which alone would satisfy the
    // assertion above and leave the guard in selectTile untested. Drive the
    // handler directly so both layers of the protection are real.
    w.vm.selectTile('floor');
    await w.vm.$nextTick();
    expect(w.find('.tiles-drawer').exists()).toBe(false);
  });

  it('keeps the grid full on a brand-new conversation', () => {
    const w = make({
      totalCost: 0, totalUncachedCost: null, executionsCount: 0, rounds: [],
      manifest: { ...manifest, economics: null },
      contextStatus: { ...contextStatus, breakdown: { ...contextStatus.breakdown, calibration: 1 } },
    });
    expect(tileKeys(w)).toEqual(['Request', 'Floor / turn', 'Spent', 'Saved']);
    expect(w.findAll('.tile.placeholder')).toHaveLength(3);
  });

  it('drops the drift tile when the estimator is accurate', () => {
    const w = make({
      contextStatus: { ...contextStatus, breakdown: { ...contextStatus.breakdown, calibration: 1 } },
    });
    expect(tileKeys(w)).not.toContain('Drift');
  });

  it('drops the rounds tile before any request has been made', () => {
    expect(tileKeys(make({ rounds: [] }))).not.toContain('This turn');
  });

  it('labels a negative saving as a cache investment rather than a loss', () => {
    const w = make({ totalCost: 0.5, totalUncachedCost: 0.4 });
    const t = tileByLabel(w, 'Cache invested');
    expect(t).toBeTruthy();
    expect(t.find('.tile-value').classes()).toContain('warn');
    expect(t.find('.tile-sub').text()).toContain('pays back');
  });

  it('calls the spend notional on a subscription seat', () => {
    const w = make({ subscriptionBased: true });
    expect(tileKeys(w)).toContain('Notional');
    expect(tileKeys(w)).not.toContain('Spent');
  });

  it('fills the tile bar to the utilization it sits under, not to the track', () => {
    // Regression: segments were scaled against the request total, so they always
    // summed to ~100% of the track. A 4% context rendered as a full bar.
    const pct = (w) => w.findAll('.tile-mini .seg')
      .map((s) => parseFloat(s.attributes('style').match(/width:\s*([\d.]+)%/)[1]))
      .reduce((a, b) => a + b, 0);

    expect(pct(make())).toBeCloseTo(78.1, 0);

    const fresh = make({
      contextStatus: {
        ...contextStatus,
        currentTokens: 42800,
        breakdown: { ...contextStatus.breakdown, messagesTokens: 1200, systemTokens: 8000, toolTokens: 2000 },
      },
    });
    expect(pct(fresh)).toBeLessThan(5);
  });

  it('escalates the request tile colour past 90%', () => {
    const w = make({ contextStatus: { ...contextStatus, currentTokens: 960_000 } });
    expect(tileByLabel(w, 'Request').find('.tile-value').classes()).toContain('critical');
  });
});

describe('ContextTiles — drawer', () => {
  it('opens nothing by default', () => {
    expect(make().find('.tiles-drawer').exists()).toBe(false);
  });

  it('opens, switches and closes on tile clicks', async () => {
    const w = make();
    await tileByLabel(w, 'Floor / turn').trigger('click');
    expect(w.find('.tiles-drawer').exists()).toBe(true);
    expect(w.find('.accent-label').text()).toBe('Per-turn floor');

    await tileByLabel(w, 'Drift').trigger('click');
    expect(w.find('.accent-label').text()).toBe('Estimate drift');

    await tileByLabel(w, 'Drift').trigger('click');
    expect(w.find('.tiles-drawer').exists()).toBe(false);
  });

  it('multiplies the floor by the turns actually taken', async () => {
    const w = make();
    await tileByLabel(w, 'Floor / turn').trigger('click');
    // 0.207237 * 42 = 8.704
    expect(w.find('.tiles-drawer').text()).toContain('$8.70');
  });

  it('ranks recurring segments by cost, biggest first', async () => {
    const w = make();
    await tileByLabel(w, 'Floor / turn').trigger('click');
    const names = w.findAll('.driver-name').map((n) => n.text());
    expect(names[0]).toBe('Memory');
    expect(names[1]).toBe('Core instructions');
    // Tools and system sections are ranked together — both are re-sent every
    // turn, so splitting them would hide the comparison that matters.
    expect(names).toContain('github_api');
  });

  it('sums the top three into an actionable saving', async () => {
    const w = make();
    await tileByLabel(w, 'Floor / turn').trigger('click');
    // 0.04593 + 0.031836 + 0.011436 = 0.089202 -> $0.09, x42 = $3.75
    const text = w.find('.tiles-drawer').text();
    expect(text).toContain('$0.09');
    expect(text).toContain('$3.75');
  });

  it('forecasts the wall from measured growth', async () => {
    const w = make();
    await tileByLabel(w, 'Drift').trigger('click');
    // (1,000,000 - 781,090) / 73,000 = 2.99 -> 2 safe turns
    expect(w.find('.tiles-drawer').text()).toContain('2 turns');
  });

  it('says "not growing" rather than inventing a forecast', async () => {
    const w = make({ growthPerTurn: 0 });
    await tileByLabel(w, 'Drift').trigger('click');
    expect(w.find('.tiles-drawer').text()).toContain('not growing');
  });

  it('shows the composition legend on the request drawer', async () => {
    const w = make();
    await tileByLabel(w, 'Request').trigger('click');
    const labels = w.findAll('.legend-label').map((l) => l.text());
    expect(labels).toEqual(['System', 'Tools', 'Messages', 'Output reserve']);
  });

  it('closes a drawer whose tile stops existing', async () => {
    const w = make();
    await tileByLabel(w, 'Drift').trigger('click');
    expect(w.find('.tiles-drawer').exists()).toBe(true);
    await w.setProps({
      contextStatus: { ...contextStatus, breakdown: { ...contextStatus.breakdown, calibration: 1 } },
    });
    expect(w.find('.tiles-drawer').exists()).toBe(false);
  });
});

describe('ContextTiles — rounds', () => {
  it('renders one bar per request in the turn', async () => {
    const w = make();
    await tileByLabel(w, 'This turn').trigger('click');
    expect(w.findAll('.round')).toHaveLength(3);
  });

  it('lands on the round in flight when opened mid-turn', async () => {
    // Regression: selection used to stay on round 1 until the round count
    // changed, so opening the drawer during a long tool loop showed the
    // cheapest request in the turn.
    const w = make();
    await tileByLabel(w, 'This turn').trigger('click');
    expect(w.findAll('.round')[2].classes()).toContain('selected');
    expect(w.find('.rounds-sel').text()).toBe('r3 · 781.1k');
  });

  it('selects the newest round as a turn streams', async () => {
    const w = make({ rounds: rounds.slice(0, 1) });
    await tileByLabel(w, 'This turn').trigger('click');
    await w.setProps({ rounds });
    expect(w.findAll('.round')[2].classes()).toContain('selected');
  });

  it('stops following once the user pins an earlier round', async () => {
    const w = make();
    await tileByLabel(w, 'This turn').trigger('click');
    await w.findAll('.round')[0].trigger('click');
    await w.setProps({ rounds: [...rounds, { round: 4, tokens: 900_000, prefixBroke: false }] });
    expect(w.findAll('.round')[0].classes()).toContain('selected');
  });

  it('marks the round where the cache prefix broke', async () => {
    const w = make({ rounds: [{ ...rounds[0], prefixBroke: true }, rounds[1]] });
    await tileByLabel(w, 'This turn').trigger('click');
    expect(w.findAll('.round')[0].classes()).toContain('broke');
    expect(w.findAll('.round')[1].classes()).not.toContain('broke');
  });

  it('surfaces a broken prefix on the tile itself', () => {
    const w = make({ manifest: { ...manifest, cache: { prefixStable: false } } });
    expect(tileByLabel(w, 'This turn').find('.tile-sub').text()).toContain('prefix broke');
  });

  it('resets selection when a new turn shortens the round list', async () => {
    const w = make();
    await tileByLabel(w, 'This turn').trigger('click');
    await w.setProps({ rounds: [rounds[0]] });
    expect(w.findAll('.round')[0].classes()).toContain('selected');
  });
});

describe('ContextTiles — prompt cache freshness', () => {
  const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();
  const HOUR = 60 * 60 * 1000;
  // AGNT explicitly requests ttl:'1h' from Anthropic; the panel must use the
  // window we actually ask for, not the vendor's 5-minute default.
  const anthropic = (msAgo) => ({ lastCacheActivityAt: at(msAgo), cacheTtlMs: HOUR });

  it('says nothing at all when the cache age is unknown', () => {
    const w = make({ lastCacheActivityAt: null, cacheTtlMs: HOUR });
    const sub = tileByLabel(w, 'Saved').find('.tile-sub').text();
    expect(sub).not.toContain('warm');
    expect(sub).not.toContain('cold');
  });

  it('makes no claim when the provider window is unknown', () => {
    // A wrong TTL is a confident false statement about the user's money, so an
    // unlisted provider gets silence rather than a guess.
    const w = make({ lastCacheActivityAt: at(10 * 60_000), cacheTtlMs: null });
    const sub = tileByLabel(w, 'Saved').find('.tile-sub').text();
    expect(sub).not.toContain('warm');
    expect(sub).not.toContain('cold');
    expect(sub).toContain('cache 90.4%');
  });

  it('REGRESSION: 24 minutes is warm on a 1h window, not expired', () => {
    // Shipped bug: a hardcoded 5-minute constant reported four of eight live
    // conversations as cold when their prefixes were demonstrably alive.
    const w = make(anthropic(24 * 60_000));
    const sub = tileByLabel(w, 'Saved').find('.tile-sub');
    expect(sub.text()).toContain('cache warm');
    expect(sub.classes()).not.toContain('warn');
  });

  it('REGRESSION: 46 minutes is still warm on a 1h window', () => {
    const w = make(anthropic(46 * 60_000));
    expect(tileByLabel(w, 'Saved').find('.tile-sub').text()).toContain('cache warm');
  });

  it('reports remaining life in hours and minutes while warm', () => {
    const w = make(anthropic(5 * 60_000));
    expect(tileByLabel(w, 'Saved').find('.tile-sub').text()).toMatch(/~55m left/);
  });

  it('goes cold only past the real window', () => {
    const w = make(anthropic(77 * 60_000));
    const sub = tileByLabel(w, 'Saved').find('.tile-sub');
    expect(sub.text()).toContain('cache likely cold');
    expect(sub.classes()).toContain('warn');
  });

  it('honours a shorter window for providers that have one', () => {
    // OpenAI evicts on idle at ~5 minutes; the same age must read differently.
    const w = make({ lastCacheActivityAt: at(10 * 60_000), cacheTtlMs: 5 * 60_000 });
    expect(tileByLabel(w, 'Saved').find('.tile-sub').text()).toContain('cache likely cold');
  });

  it('prices the consequence of a cold prefix in the drawer', async () => {
    const w = make(anthropic(90 * 60_000));
    await tileByLabel(w, 'Saved').trigger('click');
    const text = w.find('.tiles-drawer').text();
    expect(text).toContain('probably gone cold');
    expect(text).toContain('$0.21');
  });

  it('contrasts warm against full price in the drawer', async () => {
    const w = make(anthropic(30_000));
    await tileByLabel(w, 'Saved').trigger('click');
    const text = w.find('.tiles-drawer').text();
    expect(text).toContain('should still be warm');
    // Cached prefix ($0.02) against full price ($0.21) — the contrast is the
    // point; a lone number would not be actionable.
    expect(text).toContain('$0.02');
    expect(text).toContain('$0.21');
  });

  it('shows the evidence behind the verdict so it can be overruled', async () => {
    const w = make(anthropic(24 * 60_000));
    await tileByLabel(w, 'Saved').trigger('click');
    const text = w.find('.tiles-drawer').text();
    // Both inputs to the inference are stated, not just the conclusion.
    expect(text).toMatch(/Last confirmed cache activity\s+24m\s+ago/);
    expect(text).toMatch(/window is\s+1h/);
  });

  it('ignores an unparseable timestamp instead of rendering NaN', () => {
    const w = make({ lastCacheActivityAt: 'not-a-date', cacheTtlMs: HOUR });
    expect(w.html()).not.toContain('NaN');
    const sub = tileByLabel(w, 'Saved').find('.tile-sub').text();
    expect(sub).not.toContain('warm');
    expect(sub).not.toContain('cold');
    expect(sub).toContain('cache 90.4%');
  });
});

describe('ContextTiles — slots', () => {
  it('renders the cost detail for both spend tiles', async () => {
    const w = make({}, { cost: '<div class="slot-cost">COST</div>' });
    await tileByLabel(w, 'Spent').trigger('click');
    expect(w.find('.slot-cost').exists()).toBe(true);
    await tileByLabel(w, 'Saved').trigger('click');
    expect(w.find('.slot-cost').exists()).toBe(true);
  });

  it('renders inventory under the request tile', async () => {
    const w = make({}, { inventory: '<div class="slot-inv">INV</div>' });
    await tileByLabel(w, 'Request').trigger('click');
    expect(w.find('.slot-inv').exists()).toBe(true);
  });

  it('renders health and activity under the turn tile', async () => {
    const w = make({}, {
      health: '<div class="slot-health">H</div>',
      activity: '<div class="slot-act">A</div>',
    });
    await tileByLabel(w, 'This turn').trigger('click');
    expect(w.find('.slot-health').exists()).toBe(true);
    expect(w.find('.slot-act').exists()).toBe(true);
  });

  it('does not mount slot content until its tile is opened', () => {
    const w = make({}, { cost: '<div class="slot-cost">COST</div>' });
    expect(w.find('.slot-cost').exists()).toBe(false);
  });
});

describe('ContextTiles — degenerate input', () => {
  it('renders a full row of placeholders with no data at all', () => {
    const w = mount(ContextTiles, { props: { collapsed: false } });
    expect(w.find('.tiles-strip').text()).toContain('Context & Cost');
    // Four slots, all placeholders, nothing expandable, no fabricated numbers.
    expect(w.findAll('.tile')).toHaveLength(4);
    expect(w.findAll('.tile.placeholder')).toHaveLength(4);
    expect(w.findAll('.tile-value').every((v) => v.text() === '\u2014')).toBe(true);
    expect(w.find('.tiles-drawer').exists()).toBe(false);
    expect(w.findAll('.strip-stat')).toHaveLength(0);
  });

  it('does not divide by zero when the token limit is missing', () => {
    const w = make({ contextStatus: { currentTokens: 500, tokenLimit: 0, breakdown: null } });
    expect(w.html()).not.toContain('NaN');
    expect(w.html()).not.toContain('Infinity');
  });

  it('survives a manifest with no sections or tools', async () => {
    const w = make({ manifest: { economics, system: { total: 0 }, tools: { total: 0 } } });
    await tileByLabel(w, 'Floor / turn').trigger('click');
    expect(w.findAll('.driver')).toHaveLength(0);
    expect(w.html()).not.toContain('NaN');
  });
});
