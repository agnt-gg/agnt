import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ContextTiles from './ContextTiles.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'ContextTiles.vue'), 'utf8');

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
    residualDrift: 1.31,
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
      contextStatus: { ...contextStatus, breakdown: { ...contextStatus.breakdown, residualDrift: 1.02 } },
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
    expect(tileKeys(make())).toEqual(['Context used', 'Every turn', 'Tokens', 'Saved', 'Estimate off', 'This turn']);
  });

  it('shows utilization and the token pair on the request tile', () => {
    const t = tileByLabel(make(), 'Context used');
    expect(t.find('.tile-value').text()).toBe('78%');
    expect(t.find('.tile-sub').text()).toBe('781.1k of 1.0M');
  });

  it('states the floor as money, tokens and how many times it was paid', () => {
    const t = tileByLabel(make(), 'Every turn');
    expect(t.find('.tile-value').text()).toBe('$0.21');
    expect(t.find('.tile-sub').text()).toContain('69.1k tokens re-sent');
    expect(t.find('.tile-sub').text()).toContain('42');
  });

  it('holds the floor slot with a placeholder when the model has no pricing', () => {
    // Dropping it let auto-fit stretch the surviving tiles across the whole
    // panel, which made a 4% context read as a nearly-full bar.
    const w = make({ manifest: { ...manifest, economics: null } });
    const t = tileByLabel(w, 'Every turn');
    expect(t.find('.tile-value').text()).toBe('\u2014');
    expect(t.classes()).toContain('placeholder');
    expect(t.attributes('disabled')).toBeDefined();
  });

  it('never expands a placeholder into an empty drawer', async () => {
    const w = make({ manifest: { ...manifest, economics: null } });
    await tileByLabel(w, 'Every turn').trigger('click');
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
      totalTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      manifest: { ...manifest, economics: null },
      contextStatus: { ...contextStatus, breakdown: { ...contextStatus.breakdown, residualDrift: 1 } },
    });
    expect(tileKeys(w)).toEqual(['Context used', 'Every turn', 'Tokens', 'Saved']);
    expect(w.findAll('.tile.placeholder')).toHaveLength(3);
  });

  it('drops the drift tile when the estimator is accurate', () => {
    const w = make({
      contextStatus: { ...contextStatus, breakdown: { ...contextStatus.breakdown, residualDrift: 1 } },
    });
    expect(tileKeys(w)).not.toContain('Estimate off');
  });

  it('drops the rounds tile before any request has been made', () => {
    expect(tileKeys(make({ rounds: [] }))).not.toContain('This turn');
  });

  it('turns into a Cost tile when the number goes negative', () => {
    // Caching is not free — writing a prefix bills at 1.25x-2x — so a turn that
    // writes more than it reads genuinely costs money. "Saved −$0.10" is a
    // contradiction on its face; the label has to follow the sign.
    const w = make({ totalCost: 0.5, totalUncachedCost: 0.4 });
    expect(tileKeys(w)).toContain('Cost');
    expect(tileKeys(w)).not.toContain('Saved');

    const t = tileByLabel(w, 'Cost');
    // Absolute value: "Cost −$0.10" would be a double negative.
    expect(t.find('.tile-value').text()).toBe('$0.10');
    expect(t.find('.tile-value').classes()).toContain('warn');
    expect(t.find('.tile-sub').text()).toContain('pays back');
  });

  it('says so plainly when the prefix was rewritten rather than reused', () => {
    // A write that pays back next turn and a write thrown away by a broken
    // prefix are different problems, and only one of them is recoverable.
    const w = make({
      totalCost: 0.5,
      totalUncachedCost: 0.4,
      manifest: { ...manifest, cache: { prefixStable: false } },
    });
    expect(tileByLabel(w, 'Cost').find('.tile-sub').text()).toContain('rewritten');
  });

  it('stays Saved when a seat absorbs a write turn', () => {
    // The label follows the DISPLAYED total, not the cache saving alone: the
    // seat pulls a −$0.10 cache write back to +$0.40 avoided.
    const w = make({ totalCost: 0.5, totalUncachedCost: 0.4, subscriptionBased: true });
    const t = tileByLabel(w, 'Saved');
    expect(t.find('.tile-value').text()).toBe('$0.40');
    expect(t.find('.tile-value').classes()).toContain('good');
  });

  it('mirrors the flip on the collapsed strip, using the same word', () => {
    const cost = make({ totalCost: 0.5, totalUncachedCost: 0.4 });
    expect(cost.findAll('.strip-key').map((n) => n.text())).toContain('cost');
    const saved = make();
    expect(saved.findAll('.strip-key').map((n) => n.text())).toContain('saved');
  });

  it('counts a seat\u2019s metered value as avoided, in one number with the cache saving', () => {
    // THE defect this replaces. "Would cost $355.74" beside "Saved $917.78"
    // put two figures on two different baselines next to each other: the
    // phrase promised the uncached counterfactual ($1,273.52) while showing
    // the post-cache metered figure. Neither tile could be reconciled with the
    // other, and the seat money was never counted as avoided at all.
    const w = make({ subscriptionBased: true });
    expect(tileKeys(w)).not.toContain('Would cost');
    expect(tileKeys(w)).not.toContain('Notional');
    expect(tileKeys(w)).not.toContain('Spent');

    // 34.3608 saved by caching + 12.8433 absorbed by the seat.
    const saved = tileByLabel(w, 'Saved');
    expect(saved.find('.tile-value').text()).toBe('$47.20');
    expect(saved.find('.tile-sub').text()).toContain('caching + subscription');
  });

  it('on a seat, everything metered was avoided — the figure IS the uncached baseline', () => {
    // A seat user pays nothing per token, so avoided must equal what the whole
    // conversation would have cost without caching AND without the seat. If
    // these ever diverge, one of the two mechanisms is being double-counted or
    // dropped.
    const w = make({ subscriptionBased: true });
    const shown = parseFloat(tileByLabel(w, 'Saved').find('.tile-value').text().replace(/[$,]/g, ''));
    expect(shown).toBeCloseTo(defaults.totalUncachedCost, 2);
  });

  it('on a metered key, avoided is the cache saving alone', () => {
    const w = make({ subscriptionBased: false });
    const saved = tileByLabel(w, 'Saved');
    expect(saved.find('.tile-value').text()).toBe('$34.36');
    expect(saved.find('.tile-sub').text()).toContain('73% cheaper');
  });

  it('reports the size of the conversation, which no other tile carried', () => {
    const t = tileByLabel(make(), 'Tokens');
    expect(t.find('.tile-value').text()).toBe('8.6M');
    // Turns, not calls — each turn is however many requests the tool loop made.
    expect(t.find('.tile-sub').text()).toBe('42 turns · 90% cached');
  });

  it('holds the tokens slot with a placeholder before anything is sent', () => {
    const w = make({ totalTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
    const t = tileByLabel(w, 'Tokens');
    expect(t.find('.tile-value').text()).toBe('\u2014');
    expect(t.classes()).toContain('placeholder');
  });

  it('explains an unavailable per-turn cost honestly, never blaming pricing', () => {
    // All three states used to read "no pricing for this model", which is
    // false for a priced model that simply has no manifest yet — and it sat
    // next to a cost tile showing real money for that same model.
    const noManifest = make({ manifest: null });
    expect(tileByLabel(noManifest, 'Every turn').find('.tile-sub').text())
      .toBe('waiting for the first reply');

    const unpriced = make({ manifest: { ...manifest, economics: null } });
    expect(tileByLabel(unpriced, 'Every turn').find('.tile-sub').text())
      .toBe('no pricing for this model');

    const zeroFloor = make({ manifest: { ...manifest, economics: { ...economics, floorTokens: 0 } } });
    expect(tileByLabel(zeroFloor, 'Every turn').find('.tile-sub').text())
      .toBe('nothing fixed to re-send');
  });

  it('uses no accounting jargon anywhere in the tile strip', () => {
    const w = make({ subscriptionBased: true });
    const text = w.find('.tiles-grid').text();
    for (const word of ['Notional', 'Floor', 'Drift']) {
      expect(text, word).not.toContain(word);
    }
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
    expect(tileByLabel(w, 'Context used').find('.tile-value').classes()).toContain('critical');
  });
});

describe('ContextTiles — drawer', () => {
  it('opens nothing by default', () => {
    expect(make().find('.tiles-drawer').exists()).toBe(false);
  });

  it('opens, switches and closes on tile clicks', async () => {
    const w = make();
    await tileByLabel(w, 'Every turn').trigger('click');
    expect(w.find('.tiles-drawer').exists()).toBe(true);
    expect(w.find('.accent-label').text()).toBe('Every turn');

    await tileByLabel(w, 'Estimate off').trigger('click');
    expect(w.find('.accent-label').text()).toBe('Estimate off');

    await tileByLabel(w, 'Estimate off').trigger('click');
    expect(w.find('.tiles-drawer').exists()).toBe(false);
  });

  it('multiplies the floor by the turns actually taken', async () => {
    const w = make();
    await tileByLabel(w, 'Every turn').trigger('click');
    // 0.207237 * 42 = 8.704
    expect(w.find('.tiles-drawer').text()).toContain('$8.70');
  });

  it('ranks recurring segments by cost, biggest first', async () => {
    const w = make();
    await tileByLabel(w, 'Every turn').trigger('click');
    const names = w.findAll('.driver-name').map((n) => n.text());
    expect(names[0]).toBe('Memory');
    expect(names[1]).toBe('Core instructions');
    // Tools and system sections are ranked together — both are re-sent every
    // turn, so splitting them would hide the comparison that matters.
    expect(names).toContain('github_api');
  });

  it('sums the top three into an actionable saving', async () => {
    const w = make();
    await tileByLabel(w, 'Every turn').trigger('click');
    // 0.04593 + 0.031836 + 0.011436 = 0.089202 -> $0.09, x42 = $3.75
    const text = w.find('.tiles-drawer').text();
    expect(text).toContain('$0.09');
    expect(text).toContain('$3.75');
  });

  it('forecasts when compression will start, from measured growth', async () => {
    const w = make();
    await tileByLabel(w, 'Estimate off').trigger('click');
    // (1,000,000 - 781,090) / 73,000 = 2.99 -> 2 safe turns
    expect(w.find('.tiles-drawer').text()).toContain('~2 turns');
  });

  it('says "not growing" rather than inventing a forecast', async () => {
    const w = make({ growthPerTurn: 0 });
    await tileByLabel(w, 'Estimate off').trigger('click');
    expect(w.find('.tiles-drawer').text()).toContain('not growing');
  });

  it('shows the composition legend on the request drawer', async () => {
    const w = make();
    await tileByLabel(w, 'Context used').trigger('click');
    const labels = w.findAll('.legend-label').map((l) => l.text());
    expect(labels).toEqual(['System', 'Tools', 'Messages', 'Output reserve']);
  });

  it('closes a drawer whose tile stops existing', async () => {
    const w = make();
    await tileByLabel(w, 'Estimate off').trigger('click');
    expect(w.find('.tiles-drawer').exists()).toBe(true);
    await w.setProps({
      contextStatus: { ...contextStatus, breakdown: { ...contextStatus.breakdown, residualDrift: 1 } },
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

describe('ContextTiles — drift reports leftover error, not the correction', () => {
  const bd = (over) => ({
    contextStatus: { ...contextStatus, breakdown: { ...contextStatus.breakdown, ...over } },
  });

  it('REGRESSION: a large correction that is working shows no drift at all', () => {
    // The shipped bug. calibration 1.61 is already applied to every number on
    // screen; reporting it as drift told the user their figures were 61% wrong
    // when they were correct. Only the residual is error.
    const w = make(bd({ calibration: 1.61, residualDrift: 1.0 }));
    expect(tileKeys(w)).not.toContain('Estimate off');
    expect(w.find('.strip-pip').exists()).toBe(false);
  });

  it('ignores the correction factor entirely, however large', () => {
    const w = make(bd({ calibration: 2.9, residualDrift: 1.03 }));
    expect(tileKeys(w)).not.toContain('Estimate off');
  });

  it('flags genuine leftover error', () => {
    const w = make(bd({ calibration: 1.61, residualDrift: 1.4 }));
    const t = tileByLabel(w, 'Estimate off');
    expect(t.find('.tile-value').text()).toBe('\u00d71.40');
    expect(t.find('.tile-sub').text()).toBe('undercounts by 40%');
  });

  it('treats over-estimating as drift too', () => {
    // 0.75 means the provider counted a quarter LESS than we predicted. Being
    // wrong in the cheap direction is still being wrong.
    const w = make(bd({ calibration: 1.2, residualDrift: 0.75 }));
    const t = tileByLabel(w, 'Estimate off');
    expect(t).toBeTruthy();
    // ...and the copy must say which DIRECTION, or it states a falsehood in
    // one of the two cases it covers.
    expect(t.find('.tile-sub').text()).toBe('overcounts by 25%');
  });

  it('makes no claim when the backend has not measured a residual yet', () => {
    // Turn one, or an older backend. Silence beats a fabricated number.
    const w = make(bd({ calibration: 1.61, residualDrift: null }));
    expect(tileKeys(w)).not.toContain('Estimate off');
  });

  it('contrasts what the panel predicted against what the provider counted', async () => {
    const w = make(bd({ calibration: 1.61, residualDrift: 1.4 }));
    await tileByLabel(w, 'Estimate off').trigger('click');
    const text = w.find('.tiles-drawer').text();
    expect(text).toContain('already applies this correction');
    expect(text).toContain('781.1k');   // predicted (already calibrated)
    expect(text).toContain('1.1M');     // 781,090 x 1.4 = what the provider counted
  });
});

describe('ContextTiles — running out of window means compression, not a wall', () => {
  it('never calls the limit a wall', async () => {
    const w = make();
    await tileByLabel(w, 'Estimate off').trigger('click');
    // AGNT compresses and the conversation continues; "wall" claims otherwise.
    expect(w.find('.tiles-drawer').text().toLowerCase()).not.toContain('wall');
    expect(tileByLabel(w, 'Estimate off').find('.tile-sub').text().toLowerCase()).not.toContain('wall');
  });

  it('says what actually happens when the window fills', async () => {
    const w = make();
    await tileByLabel(w, 'Estimate off').trigger('click');
    const text = w.find('.tiles-drawer').text();
    expect(text).toContain('Compression starts in');
    expect(text).toContain('Nothing stops when the window fills');
    expect(text).toMatch(/compresses the\s+oldest turns/);
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

  it('REGRESSION: a fresh signal mid-turn flips a cold reading back to warm', async () => {
    // The clock used to advance only at turn end, so a long agentic turn read
    // as cold for its whole duration while it was hitting the cache every
    // round. The backend now reports per round; the panel must react to it.
    const w = make(anthropic(6.5 * HOUR));
    expect(tileByLabel(w, 'Saved').find('.tile-sub').text()).toContain('cache likely cold');

    await w.setProps({ lastCacheActivityAt: at(30_000) });
    const sub = tileByLabel(w, 'Saved').find('.tile-sub');
    expect(sub.text()).toContain('cache warm');
    expect(sub.classes()).not.toContain('warn');
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
  it('renders the cost detail for both money tiles', async () => {
    // Tokens and Saved are one story — the drawer breaks the same conversation
    // down into turns, tokens and the caching/subscription split.
    const w = make({}, { cost: '<div class="slot-cost">COST</div>' });
    await tileByLabel(w, 'Tokens').trigger('click');
    expect(w.find('.slot-cost').exists()).toBe(true);
    await tileByLabel(w, 'Saved').trigger('click');
    expect(w.find('.slot-cost').exists()).toBe(true);
  });

  it('renders inventory under the request tile', async () => {
    const w = make({}, { inventory: '<div class="slot-inv">INV</div>' });
    await tileByLabel(w, 'Context used').trigger('click');
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

describe('ContextTiles — an unmeasured conversation reports nothing', () => {
  // A model's window is populated as soon as a model is selected, so tokenLimit
  // arrives long before any request does. Reporting utilization off it alone
  // produced "0% full · 0 / 1.0M" on an empty chat.
  const untouched = {
    contextStatus: { currentTokens: 0, tokenLimit: 1_000_000, model: 'claude-opus-5', breakdown: null },
    manifest: null,
    totalTokenUsage: {},
    totalCost: 0,
    totalUncachedCost: null,
    totalCacheMetrics: {},
    executionsCount: 0,
    rounds: [],
    growthPerTurn: 0,
    lastTurnCost: null,
  };

  it('REGRESSION: shows no "0% full" on the strip when only the window is known', () => {
    const w = make(untouched);
    expect(w.findAll('.strip-key').map((k) => k.text())).not.toContain('full');
    expect(w.find('.tiles-strip').text()).not.toContain('0%');
  });

  it('REGRESSION: the request tile is a placeholder, not a measured zero', () => {
    const t = tileByLabel(make(untouched), 'Context used');
    expect(t.find('.tile-value').text()).toBe('\u2014');
    expect(t.find('.tile-sub').text()).toBe('nothing sent yet');
    expect(t.classes()).toContain('placeholder');
    expect(t.find('.tile-sub').text()).not.toContain('1.0M');
  });

  it('reports the moment a single token is actually measured', () => {
    const w = make({
      ...untouched,
      contextStatus: { ...untouched.contextStatus, currentTokens: 41_200 },
    });
    expect(w.findAll('.strip-key').map((k) => k.text())).toContain('full');
    expect(tileByLabel(w, 'Context used').find('.tile-sub').text()).toBe('41.2k of 1.0M');
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
    await tileByLabel(w, 'Every turn').trigger('click');
    expect(w.findAll('.driver')).toHaveLength(0);
    expect(w.html()).not.toContain('NaN');
  });
});

// jsdom computes no layout and resolves no custom properties, so a mounted
// component literally cannot see either of these failures. Scan the source.
describe('ContextTiles surfaces', () => {
  const rules = () => {
    // Comments are stripped FIRST: a rationale comment sitting above a rule is
    // otherwise captured as part of that rule's selector.
    const style = SOURCE.slice(SOURCE.indexOf('<style'), SOURCE.lastIndexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    return [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selector, body]) => ({ selector: selector.trim(), body }));
  };

  const declaration = (body, prop) => {
    // Last one wins.
    const hits = [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]+)`, 'g'))];
    return hits.length ? hits[hits.length - 1][1].trim() : null;
  };

  it('paints the tile grid on a surface token, not on the border colour', () => {
    // Regression: `background: var(--terminal-border-color)` used the 1px gaps
    // as dividers, but a background covers the whole element — so an opaque
    // border slab sat under every translucent tile and blacked out the strip.
    const grid = rules().find((r) => r.selector === '.tiles-grid');
    expect(grid, '.tiles-grid rule').toBeTruthy();
    expect(declaration(grid.body, 'background')).toBe('var(--color-darker-0)');
  });

  it('only lets a border token paint an element that is a line', () => {
    // Anti-vacuity: the parser must actually see this file's rules.
    expect(rules().length).toBeGreaterThan(40);

    const offenders = rules()
      .filter((r) => /border-color/.test(declaration(r.body, 'background') || ''))
      .filter((r) => !['1px', '2px'].includes(declaration(r.body, 'width'))
        && !['1px', '2px'].includes(declaration(r.body, 'height')));
    expect(offenders.map((r) => r.selector)).toEqual([]);
  });
});
