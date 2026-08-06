// The spend panel in the dashboard credits area (PRD-122).
//
// Three properties matter here, and each one is a bug this panel already had:
//
// 1. THE HEADLINE IS MONEY. It briefly showed charged + seat value summed under
//    the word "Spend", so a user who had paid $182 read "$18,645 spent". Seat
//    value is what the same tokens WOULD have cost metered — the best news on
//    the page, but not a charge.
// 2. THE PARTS ADD UP. Every bar and model row must reconcile to a stated
//    total. They once picked per-row between charged and seat value, so the
//    two lists disagreed with each other by three orders of magnitude.
// 3. SAVINGS ARE NOT GUESSES. The "saved" percentage is a share of money, not
//    the cache hit rate, and the leverage multiple only appears once the user
//    has actually told AGNT what a seat costs.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import SpendLedger from './SpendLedger.vue';

const EXPANDED_KEY = 'spendLedger_expanded';

const summaryOf = (over = {}) => ({
  costUsd: 0,
  notionalUsd: 0,
  uncachedCostUsd: 0,
  savedUsd: 0,
  notionalUncachedUsd: 0,
  notionalSavedUsd: 0,
  unpricedCalls: 0,
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ledgerHealth: { totalFailures: 0, byProcess: [], thisProcess: {} },
  ...over,
});

const BY_ORIGIN = [
  { bucket: 'workflow_node', costUsd: 0, notionalUsd: 0.17, calls: 4 },
  { bucket: 'chat', costUsd: 0, notionalUsd: 16.5, calls: 5 },
];

let saveSubscriptionCosts;

const mountWith = ({
  summary = null,
  byOrigin = [],
  byModel = [],
  byProvider = [],
  subscriptionCosts = {},
  isLoading = false,
  activityDays = 14,
} = {}) => {
  saveSubscriptionCosts = vi.fn(() => Promise.resolve());
  const store = createStore({
    modules: {
      userStats: {
        namespaced: true,
        getters: {
          ledger: () => ({
            summary, byOrigin, byModel, byProvider, subscriptionCosts, isLoading, activityDays,
          }),
          isLedgerLoading: () => isLoading,
        },
        actions: { saveSubscriptionCosts: (_ctx, payload) => saveSubscriptionCosts(payload) },
      },
    },
  });
  return mount(SpendLedger, {
    global: { plugins: [store], stubs: { Tooltip: { template: '<div><slot /></div>' } } },
  });
};

/** Open the details panel through the real affordance, not by poking state. */
const expand = async (w) => {
  await w.find('.expand-toggle').trigger('click');
};

const usd = (node) => parseFloat(node.text().replace(/[$,]/g, ''));

beforeEach(() => {
  // jsdom keeps localStorage across tests in a file, and this component reads a
  // persisted preference at setup — without this, one test's toggle silently
  // changes the next test's starting state.
  localStorage.clear();
});

describe('the headline is money, and only money', () => {
  const MIXED = {
    summary: summaryOf({
      costUsd: 182.25,
      notionalUsd: 18463.47,
      savedUsd: 40,
      notionalSavedUsd: 41200,
      calls: 15291,
      inputTokens: 5_000_000,
      cacheReadTokens: 3_700_000,
    }),
  };

  it('shows charged spend, not charged plus seat value', () => {
    // The reported defect: "$18,645.72 total value" in the biggest type on a
    // panel headed "Spend", when the user had actually paid $182.25.
    const w = mountWith(MIXED);
    expect(usd(w.find('.headline-value'))).toBeCloseTo(182.25, 2);
    // The label carries the scope now that the heading is just "Spend", and it
    // is what tells this figure apart from the subscription one beside it.
    expect(w.find('.headline-label').text()).toBe('billed via API');
  });

  it('never puts a rate-shaped word in any label directly under a number', () => {
    // That slot is read as the number's UNIT. "billed per token" turned
    // "$3.96" into "$3.96 per token" — a rate, and an alarming one.
    const fixtures = [
      MIXED,
      { summary: summaryOf({ costUsd: 0, notionalUsd: 9, calls: 2 }) },
      // ...including the seat-fee row, which adds two more labels.
      {
        ...MIXED,
        activityDays: 30,
        byProvider: [{ bucket: 'claude-code', costUsd: 0, notionalUsd: 18463.47, calls: 400 }],
        subscriptionCosts: { 'claude-code': 200 },
      },
    ];
    for (const fixture of fixtures) {
      for (const node of mountWith(fixture).findAll('.headline-label')) {
        expect(node.text(), node.text()).not.toMatch(/\bper\b|\/|each|token/i);
      }
    }
  });

  it('never labels the headline as a total', () => {
    const w = mountWith(MIXED);
    expect(w.find('.headline').text()).not.toMatch(/total/i);
  });

  it('says $0.00 for a seat-only user, alongside what was avoided', () => {
    // $0.00 alone would read as broken. Followed by what the seat absorbed it
    // reads as free, which is the truth and the better story.
    const w = mountWith({
      summary: summaryOf({ costUsd: 0, notionalUsd: 16.67, notionalSavedUsd: 52.88, calls: 9 }),
    });
    expect(usd(w.find('.headline-value'))).toBe(0);
    expect(w.find('.headline-label').text()).toBe('billed via API');
    const line = w.find('.ledger-summary').text();
    expect(line).toContain('$69.55'); // 52.88 saved by cache + 16.67 on the seat
    expect(line).toContain('avoided');
  });

  it('carries the savings total while collapsed — it is why the headline is small', () => {
    const w = mountWith(MIXED);
    expect(w.find('.ledger-detail').exists()).toBe(false);
    const line = w.find('.ledger-summary').text();
    expect(line).toContain('$59,703.47'); // 40 + 41,200 cache + 18,463.47 seats
    expect(line).toContain('avoided');
  });
});

describe('out of pocket', () => {
  // Once seat fees are known, the two halves of REAL money can finally sit
  // together. Neither figure alone deserves the phrase "out of pocket" — a
  // subscription is money too — so this is the only place it is strictly true.
  const SEATED = {
    summary: summaryOf({ costUsd: 3.96, notionalUsd: 6472.85, savedUsd: 1, notionalSavedUsd: 900, calls: 1919 }),
    byProvider: [
      { bucket: 'claude-code', costUsd: 0, notionalUsd: 6000, calls: 1500 },
      { bucket: 'openai-codex', costUsd: 0, notionalUsd: 472.85, calls: 400 },
    ],
    activityDays: 30,
    subscriptionCosts: { 'claude-code': 200, 'openai-codex': 20 },
  };

  it('shows nothing extra until the user has supplied seat fees', () => {
    // A $0 stand-in would understate the total rather than admit it is
    // unknown, and it would put a wrong number in the largest type on screen.
    const w = mountWith({ ...SEATED, subscriptionCosts: {} });
    expect(w.findAll('.headline')).toHaveLength(1);
    expect(w.find('.headline-total').exists()).toBe(false);
  });

  it('puts the seat fee beside the API spend once it knows it', () => {
    const w = mountWith(SEATED);
    const labels = w.findAll('.headline-label').map((n) => n.text());
    expect(labels).toEqual(['billed via API', 'subscriptions', 'out of pocket']);
    expect(usd(w.findAll('.headline-value')[1])).toBeCloseTo(220, 2); // $220/mo over 30 days
  });

  it('totals the two halves of real money, and only those two', () => {
    // Seat VALUE ($6,472.85) is not money; the seat FEE ($220) is. Adding the
    // wrong one here would restate the $18k total the headline exists to stop.
    const w = mountWith(SEATED);
    expect(usd(w.find('.headline-total .headline-value'))).toBeCloseTo(3.96 + 220, 2);
  });

  it('prorates the fee to the window, like the leverage figure does', () => {
    const w = mountWith({ ...SEATED, activityDays: 15 });
    expect(usd(w.findAll('.headline-value')[1])).toBeCloseTo(110, 2);
    expect(usd(w.find('.headline-total .headline-value'))).toBeCloseTo(3.96 + 110, 2);
  });
});

describe('effective rate per million tokens', () => {
  // The number that makes every other figure on the panel interpretable: what
  // a million tokens actually cost once caching and seats are accounted for.
  //
  // It is an EFFECTIVE rate, blending input, output, cached reads, cache
  // writes and every model used — so it lands far below any provider's list
  // price. That gap is the point, and it is also why the metered counterpart
  // has to be stated next to it.
  const RATE = {
    summary: summaryOf({
      costUsd: 49.09,
      notionalUsd: 11000,
      savedUsd: 10,
      notionalSavedUsd: 30000,
      calls: 5531,
      inputTokens: 7_500_000_000,
      outputTokens: 100_000_000, // 7.6B total → 7,600 M
    }),
    byOrigin: BY_ORIGIN,
    byProvider: [{ bucket: 'claude-code', costUsd: 0, notionalUsd: 11000, calls: 5000 }],
    activityDays: 30,
  };
  const WITH_FEES = { ...RATE, subscriptionCosts: { 'claude-code': 340 } };

  const summaryText = (w) => w.find('.ledger-summary').text();

  it('divides true out-of-pocket by tokens once seat fees are known', () => {
    // ($49.09 billed + $340.00 seats) / 7,600M = $0.051 per M.
    const line = summaryText(mountWith(WITH_FEES));
    expect(line).toContain('$0.051/M');
    expect(line).toContain('all-in');
  });

  it('falls back to API billing, and says so, until fees are entered', () => {
    // Quietly folding an unknown seat fee into a "what you paid" rate would
    // understate it without ever admitting to the gap. The label is the
    // admission.
    const line = summaryText(mountWith(RATE));
    expect(line).toContain('$0.006/M');
    expect(line).toContain('billed');
    expect(line).not.toContain('all-in');
  });

  it('reconciles by hand against the two chips beside it', () => {
    // The whole reason the rate uses the same token figure the panel already
    // shows: a reader can divide the two adjacent chips and land on the third.
    const w = mountWith(WITH_FEES);
    const money = usd(w.find('.headline-total .headline-value'));
    const line = summaryText(w);

    const tokens = parseFloat(line.match(/([\d.]+)B\s*tokens/)[1]) * 1000; // B → M
    const rate = parseFloat(line.match(/\$([\d.]+)\/M/)[1]);

    expect(rate).toBeCloseTo(money / tokens, 3);
  });

  it('states the metered rate alongside, so a small number does not read as an error', () => {
    // $0.051/M against a $5 list price looks broken without the comparison.
    const w = mountWith(WITH_FEES);
    w.vm.showSeatEditor = false;
    const detail = mountWith(WITH_FEES);
    detail.vm.isExpanded = true;
    return detail.vm.$nextTick().then(() => {
      const rateLine = detail.find('.saving-rate').text();
      expect(rateLine).toContain('$0.051 per million tokens');
      expect(rateLine).toContain('all-in');
      expect(rateLine).toContain('$5.40'); // $41,059.09 / 7,600M at metered rates
      expect(rateLine).toContain('7.6B tokens');
    });
  });

  it('keeps cent-scale precision, which a 2-decimal format would flatten', () => {
    // $0.051 and $0.054 are a materially different window; both round to
    // "$0.05" under the money formatter used everywhere else.
    // 0.0546 rather than a x.xxx5 tie: those are not exactly representable in
    // binary, so toFixed rounds them by whichever side the float actually
    // lands on. Asserting that would test IEEE-754, not this formatter.
    expect(mountWith(WITH_FEES).vm.formatRate(0.0512)).toBe('$0.051');
    expect(mountWith(WITH_FEES).vm.formatRate(0.0546)).toBe('$0.055');
    expect(mountWith(WITH_FEES).vm.formatRate(5.4025)).toBe('$5.40');
    expect(mountWith(WITH_FEES).vm.formatRate(0.0002)).toBe('$0.0002');
  });

  it('shows no rate when no tokens have moved', () => {
    // Dividing by zero would render "$Infinity/M".
    const w = mountWith({
      summary: summaryOf({ costUsd: 5, calls: 1, inputTokens: 0, outputTokens: 0 }),
    });
    expect(summaryText(w)).not.toMatch(/\/M/);
  });

  it('shows no rate when nothing was paid', () => {
    // A seat user who has not entered fees paid $0 through the API, and
    // "$0.0000/M" would read as free rather than as unknown.
    const w = mountWith({
      summary: summaryOf({ costUsd: 0, notionalUsd: 500, calls: 10, inputTokens: 1_000_000 }),
      byProvider: [{ bucket: 'claude-code', costUsd: 0, notionalUsd: 500, calls: 10 }],
    });
    expect(summaryText(w)).not.toMatch(/\/M/);
  });
});

describe('total avoided', () => {
  const MIXED = {
    summary: summaryOf({
      costUsd: 182.25,
      notionalUsd: 18463.47,
      savedUsd: 40,
      notionalSavedUsd: 41200,
      calls: 15291,
      inputTokens: 5_000_000,
      cacheReadTokens: 3_700_000,
    }),
    byOrigin: BY_ORIGIN,
  };

  it('sums both mechanisms into one figure', async () => {
    const w = mountWith(MIXED);
    await expand(w);
    expect(usd(w.find('.saving-total-value'))).toBeCloseTo(40 + 41200 + 18463.47, 2);
  });

  it('reconciles: metered baseline minus avoided is exactly what was billed', async () => {
    // The identity that makes adding the two mechanisms legitimate — both are
    // measured against the same metered baseline. If it ever stops holding,
    // one of them is being counted on the wrong axis.
    //
    // Asserted on the computeds rather than on rendered text: the line that
    // spelled this out has been removed from the panel, but the property it
    // described is still what keeps the section honest.
    const w = mountWith(MIXED);
    await expand(w);
    expect(w.vm.wouldHaveCost).toBeCloseTo(59885.72, 2);
    expect(w.vm.totalAvoided).toBeCloseTo(59703.47, 2);
    expect(w.vm.wouldHaveCost - w.vm.totalAvoided).toBeCloseTo(w.vm.charged, 6);
  });

  it('uses the same words as the Context & Cost panel, not a second vocabulary', async () => {
    const w = mountWith(MIXED);
    await expand(w);
    expect(w.find('.saving-total-label').text()).toBe('Total avoided');
    const block = w.find('.savings-block').text();
    expect(block).toMatch(/saved by caching/i);
    expect(block).toMatch(/saved by subscription/i);
  });

  it('states that seat fees are not netted off, rather than quietly implying they are', async () => {
    // "Saved by subscription" is gross: the seat itself costs real money. One
    // line has to say so, and it doubles as the reason to enter the fees.
    const w = mountWith({ ...MIXED, byProvider: [{ bucket: 'claude-code', costUsd: 0, notionalUsd: 18463.47, calls: 400 }] });
    await expand(w);
    expect(w.find('.seat-cost-cta').text()).toMatch(/not counted above/i);
  });

  it('shows no savings block at all when nothing was avoided', async () => {
    const w = mountWith({
      summary: summaryOf({ costUsd: 5, savedUsd: 0, calls: 1, inputTokens: 1000 }),
      byOrigin: BY_ORIGIN,
    });
    await expand(w);
    expect(w.find('.savings-block').exists()).toBe(false);
  });
});

describe('the parts add up to the stated total', () => {
  // The breakdowns describe total USAGE VALUE while the headline describes
  // charges, so the reconciliation anchor is the explicit total in the detail
  // — not the headline. Without a stated anchor the bars would reconcile to
  // nothing visible, which is how the original mismatch went unnoticed.
  const MIXED = {
    summary: summaryOf({
      costUsd: 3.96,
      notionalUsd: 6472.85,
      savedUsd: 1.96,
      notionalSavedUsd: 900,
      calls: 1919,
      inputTokens: 5_000_000,
      cacheReadTokens: 4_450_000,
    }),
    byOrigin: [
      { bucket: 'chat', costUsd: 3.96, notionalUsd: 6472.21, calls: 1900 },
      { bucket: 'workflow_node', costUsd: 0, notionalUsd: 0.64, calls: 19 },
    ],
    // Model notionals sum to summary.notionalUsd and model charges to
    // summary.costUsd — the fixture has to add up, or the test asserts against
    // a contradiction rather than against the component.
    byModel: [
      { bucket: 'claude-opus-5', costUsd: 0, notionalUsd: 3564.27, calls: 745 },
      { bucket: 'claude-fable-5', costUsd: 0, notionalUsd: 2225.26, calls: 484 },
      { bucket: 'gpt-5.6-sol', costUsd: 0, notionalUsd: 439.97, calls: 347 },
      { bucket: 'claude-opus-4-8', costUsd: 0, notionalUsd: 146.5, calls: 61 },
      { bucket: 'claude-opus-4-7', costUsd: 3.96, notionalUsd: 96.85, calls: 31 },
    ],
  };

  it('states the total usage value the breakdowns describe', async () => {
    const w = mountWith(MIXED);
    await expand(w);
    expect(usd(w.find('.value-anchor-total'))).toBeCloseTo(3.96 + 6472.85, 2);
  });

  it('every origin bar sums to that total', async () => {
    const w = mountWith(MIXED);
    await expand(w);
    const anchor = usd(w.find('.value-anchor-total'));
    const bars = w.findAll('.bar-value').map(usd);
    expect(bars.reduce((a, b) => a + b, 0)).toBeCloseTo(anchor, 2);
  });

  it('every model row sums to that total', async () => {
    const w = mountWith(MIXED);
    await expand(w);
    const anchor = usd(w.find('.value-anchor-total'));
    const models = w.findAll('.model-value').map(usd);
    expect(models.reduce((a, b) => a + b, 0)).toBeCloseTo(anchor, 2);
  });

  it('no row can exceed the total it belongs to', async () => {
    const w = mountWith(MIXED);
    await expand(w);
    const anchor = usd(w.find('.value-anchor-total'));
    for (const n of [...w.findAll('.bar-value'), ...w.findAll('.model-value')]) {
      expect(usd(n)).toBeLessThanOrEqual(anchor + 0.01);
    }
  });

  it('shows each model\u2019s charged share as a proportion, not a yes/no marker', async () => {
    // It was a dot switched on `costUsd > 0`, which drew the SAME mark for a
    // model that was entirely charged and one with $3.96 of charges against
    // $96.85 of seat value — a threshold standing in for a proportion, the
    // same defect as the old per-row axis switch.
    const w = mountWith(MIXED);
    await expand(w);
    const pct = (n) => parseFloat(n.attributes('style').match(/[\d.]+/)[0]);
    const splits = w.findAll('.model-split');
    expect(splits).toHaveLength(5);

    // claude-opus-5 is pure seat value; claude-opus-4-7 is mostly seat value
    // with a real sliver of charges. Those must not render identically.
    const chargedOf = (i) => pct(splits[i].findAll('.seg-charged')[0]);
    expect(chargedOf(0)).toBe(0);
    expect(chargedOf(4)).toBeGreaterThan(0);
    expect(chargedOf(4)).toBeLessThan(100);
    // and each split always describes the whole row
    splits.forEach((s) => {
      const segs = s.findAll('.seg').map(pct);
      expect(segs[0] + segs[1]).toBeCloseTo(100, 6);
    });
  });

  it('uses one visual language: no marker shape the legend does not explain', async () => {
    const w = mountWith(MIXED);
    await expand(w);
    // The legend describes bar segments; a circular dot for the same meaning
    // is what made the model column unreadable.
    expect(w.find('.model-dot').exists()).toBe(false);
    expect(w.findAll('.model-split .seg-charged').length).toBeGreaterThan(0);
  });

  it('stacks each bar so charged money stays visible inside seat value', async () => {
    const w = mountWith(MIXED);
    await expand(w);
    const pct = (n) => parseFloat(n.attributes('style').match(/[\d.]+/)[0]);
    // Chat is $3.96 charged of $6,476.17 — a sliver, but a real one, and the
    // two segments must always describe the whole bar.
    const charged = w.findAll('.seg-charged').map(pct);
    const seat = w.findAll('.seg-seat').map(pct);
    expect(charged[0] + seat[0]).toBeCloseTo(100, 6);
    expect(charged[0]).toBeGreaterThan(0);
    expect(charged[0]).toBeLessThan(1);
  });
});

describe('savings are stated as money, never as a token ratio', () => {
  // 93% of input tokens served from cache is a TOKEN ratio; cached reads still
  // bill at a fraction of the input rate and output never caches, so the share
  // of the bill removed is materially lower. Printing the hit rate under a
  // "saved" label would be a false claim about money.
  const MIXED_RATES = {
    summary: summaryOf({
      costUsd: 10,
      savedUsd: 30,          // would have cost 40 → 75% of the bill saved
      calls: 5,
      inputTokens: 1000,
      cacheReadTokens: 930,  // 93% hit rate — deliberately ≠ 75%
    }),
    byOrigin: BY_ORIGIN,
  };

  it('states the share of the bill saved, not the share of tokens cached', async () => {
    const w = mountWith(MIXED_RATES);
    await expand(w);
    const row = w.findAll('.saving-row')[0].text();
    expect(row).toContain('75%');
    expect(row).not.toContain('93%');
  });

  it('never says "cached" in the compact line', () => {
    expect(mountWith(MIXED_RATES).find('.ledger-summary').text()).not.toMatch(/cached/i);
  });

  it('keeps the cache hit rate, correctly labelled, in the expanded detail', async () => {
    const w = mountWith(MIXED_RATES);
    await expand(w);
    expect(w.find('.cache-label').text()).toBe('93% of input served from cache');
  });

  it('names caching and seats as separate savings, since they are separate mechanisms', async () => {
    const w = mountWith({
      summary: summaryOf({ costUsd: 10, notionalUsd: 500, savedUsd: 30, calls: 5, inputTokens: 1000 }),
      byOrigin: BY_ORIGIN,
    });
    await expand(w);
    const block = w.find('.savings-block').text();
    expect(block).toMatch(/saved by caching/i);
    expect(block).toMatch(/saved by subscription/i);
    expect(block).toContain('$30.00');
    expect(block).toContain('$500.00');
  });

  it('states the counterfactual as an amount, not a percentage of something unnamed', async () => {
    // "69% of what this usage would have cost without it" forced the reader to
    // derive the baseline in their head just to learn what the 69% was a share
    // OF. Naming both numbers removes the arithmetic.
    const w = mountWith({
      summary: summaryOf({ costUsd: 10, notionalUsd: 500, savedUsd: 30, calls: 5, inputTokens: 1000 }),
      byOrigin: BY_ORIGIN,
    });
    await expand(w);
    const row = w.findAll('.saving-row')[0].text();
    expect(row).toContain('$540.00'); // at metered rates: 10 + 500 + 30
    expect(row).toContain('$510.00'); // after caching: 10 + 500
    expect(row).not.toMatch(/% of what this usage/i);
  });

  it('omits the savings metric entirely when caching saved nothing', () => {
    // A cache-write turn is an investment, not a saving. "0% saved" is noise
    // and a negative share is nonsense.
    const line = mountWith({
      summary: summaryOf({ costUsd: 5, savedUsd: 0, calls: 1, inputTokens: 1000 }),
    }).find('.ledger-summary').text();
    expect(line).not.toMatch(/saved/i);
  });

  it('never divides by zero on a run with no input tokens', async () => {
    const w = mountWith({
      summary: summaryOf({ costUsd: 1, calls: 1, inputTokens: 0 }),
      byOrigin: BY_ORIGIN,
    });
    await expand(w);
    expect(w.find('.cache-row').exists()).toBe(false);
  });
});

describe('seat leverage', () => {
  const SEATS = {
    summary: summaryOf({
      costUsd: 0,
      notionalUsd: 1800,          // seat usage AFTER caching
      notionalSavedUsd: 2600,     // cache savings on those same seat rows
      notionalUncachedUsd: 4400,  // ← what the seats actually processed
      calls: 500,
      inputTokens: 1000,
    }),
    byOrigin: BY_ORIGIN,
    byProvider: [
      { bucket: 'claude-code', costUsd: 0, notionalUsd: 1500, calls: 400 },
      { bucket: 'openai-codex', costUsd: 0, notionalUsd: 300, calls: 100 },
    ],
  };

  it('offers to collect seat costs when it does not know them', async () => {
    const w = mountWith(SEATS);
    await expand(w);
    expect(w.find('.leverage-row').exists()).toBe(false);
    expect(w.find('.seat-cost-cta').exists()).toBe(true);
  });

  it('measures the work the seats PROCESSED, not the savings figure restated', async () => {
    // THE defect. It used to show `notionalUsd` — seat usage AFTER caching —
    // which is byte-for-byte the same number already on screen as "saved by
    // subscription" two rows above. So the row said "did $1,800 of metered
    // work" while the seats had actually processed $4,400 of it, understating
    // by the entire cache saving on those very rows.
    const w = mountWith({
      ...SEATS,
      activityDays: 30,
      subscriptionCosts: { 'claude-code': 200, 'openai-codex': 20 },
    });
    await expand(w);
    const row = w.find('.leverage-row');
    expect(row.text()).toContain('$4,400.00');   // notionalUncachedUsd
    expect(row.text()).not.toMatch(/ran\s+\$1,800\.00/); // never the post-cache figure
    expect(row.text()).toContain('$220.00');     // $220/mo over a 30-day window
    expect(w.find('.leverage-multiple').text()).toContain('20.0');
  });

  it('never states the same number as both work done and money saved', async () => {
    // A guard on the shape of the mistake rather than on one figure: if these
    // two ever coincide again, one of them is being computed on the wrong axis.
    const w = mountWith({
      ...SEATS,
      activityDays: 30,
      subscriptionCosts: { 'claude-code': 200 },
    });
    await expand(w);
    const savedBySubscription = usd(w.findAll('.saving-value')[1]);
    const meteredWork = w.vm.leverage.meteredWork;
    expect(savedBySubscription).toBeCloseTo(1800, 2);
    expect(meteredWork).toBeCloseTo(4400, 2);
    expect(meteredWork).not.toBeCloseTo(savedBySubscription, 2);
  });

  it('falls back to the post-cache figure when the backend does not report the full one', async () => {
    // An older server understates rather than crashes.
    const w = mountWith({
      ...SEATS,
      summary: summaryOf({ costUsd: 0, notionalUsd: 1800, calls: 500, inputTokens: 1000 }),
      activityDays: 30,
      subscriptionCosts: { 'claude-code': 200, 'openai-codex': 20 },
    });
    await expand(w);
    expect(w.vm.leverage.meteredWork).toBeCloseTo(1800, 2);
    expect(w.find('.leverage-multiple').text()).toContain('8.2');
  });

  it('prorates a monthly fee to a shorter window rather than comparing a month to a week', async () => {
    // Same $220/mo over 15 days is $110 of subscription, so the same $4,400 of
    // work is 40x — not 20x. Comparing a month of fees to a week of usage
    // would understate leverage by the ratio of the window.
    const w = mountWith({
      ...SEATS,
      activityDays: 15,
      subscriptionCosts: { 'claude-code': 200, 'openai-codex': 20 },
    });
    await expand(w);
    expect(w.find('.leverage-row').text()).toContain('$110.00');
    expect(w.find('.leverage-multiple').text()).toContain('40.0');
  });

  it('ignores fees for seats that were not used in this window', async () => {
    // Charging leverage for a subscription the user did not touch would
    // understate it for no reason.
    const w = mountWith({
      ...SEATS,
      activityDays: 30,
      subscriptionCosts: { 'claude-code': 200, 'gemini-cli': 999 },
    });
    await expand(w);
    expect(w.find('.leverage-row').text()).toContain('$200.00');
  });

  it('stays silent when no fee has been supplied for any used seat', async () => {
    const w = mountWith({ ...SEATS, subscriptionCosts: { 'gemini-cli': 999 } });
    await expand(w);
    expect(w.find('.leverage-row').exists()).toBe(false);
  });

  it('offers nothing to a user with no seat usage at all', async () => {
    const w = mountWith({
      summary: summaryOf({ costUsd: 50, calls: 10, inputTokens: 1000 }),
      byOrigin: BY_ORIGIN,
      byProvider: [{ bucket: 'anthropic', costUsd: 50, notionalUsd: 0, calls: 10 }],
    });
    await expand(w);
    expect(w.find('.seat-cost-cta').exists()).toBe(false);
    expect(w.find('.leverage-row').exists()).toBe(false);
  });

  it('saves entered fees, keyed by provider', async () => {
    const w = mountWith(SEATS);
    await expand(w);
    await w.find('.seat-cost-cta').trigger('click');

    const inputs = w.findAll('.seat-input input');
    expect(inputs).toHaveLength(2);
    await inputs[0].setValue('200');
    await inputs[1].setValue('20');
    await w.find('.btn-save').trigger('click');

    expect(saveSubscriptionCosts).toHaveBeenCalledWith({ 'claude-code': 200, 'openai-codex': 20 });
  });

  it('treats a blank fee as "not told", never as a zero-cost seat', async () => {
    // A stored 0 would make the leverage denominator zero and the multiple
    // infinite. Clearing a value has to remove it, not record it.
    const w = mountWith({ ...SEATS, subscriptionCosts: { 'claude-code': 200, 'openai-codex': 20 } });
    await expand(w);
    // Fees are already known, so the panel shows leverage rather than the CTA;
    // open the editor the way the leverage row's own affordance would.
    w.vm.showSeatEditor = true;
    await w.vm.$nextTick();

    const inputs = w.findAll('.seat-input input');
    await inputs[0].setValue('');
    await w.find('.btn-save').trigger('click');

    expect(saveSubscriptionCosts).toHaveBeenCalledWith({ 'openai-codex': 20 });
  });
});

describe('compact by default', () => {
  const full = {
    summary: summaryOf({
      costUsd: 0,
      notionalUsd: 16.67,
      notionalSavedUsd: 52.88,
      calls: 9,
      inputTokens: 1000,
      cacheReadTokens: 930,
    }),
    byOrigin: BY_ORIGIN,
    byModel: [{ bucket: 'claude-opus-5', costUsd: 0, notionalUsd: 16.5, calls: 5 }],
  };

  it('renders collapsed, with no breakdown on screen', () => {
    const w = mountWith(full);
    expect(w.find('.ledger-detail').exists()).toBe(false);
    expect(w.find('.ledger-columns').exists()).toBe(false);
    expect(w.find('.savings-block').exists()).toBe(false);
  });

  it('keeps the honesty flags visible while collapsed', () => {
    // These say the totals cannot be trusted. Hiding them behind an expand
    // would defeat the only reason they exist.
    const w = mountWith({
      ...full,
      summary: summaryOf({
        costUsd: 1,
        calls: 10,
        unpricedCalls: 3,
        ledgerHealth: { totalFailures: 2, byProcess: [], thisProcess: {} },
      }),
    });
    expect(w.find('.ledger-detail').exists()).toBe(false);
    expect(w.find('.flag-warn').text()).toContain('3 unpriced');
    expect(w.find('.flag-error').text()).toContain('2');
  });

  it('reveals the breakdown on expand and hides it again on collapse', async () => {
    const w = mountWith(full);
    await expand(w);
    expect(w.find('.ledger-detail').exists()).toBe(true);
    await expand(w);
    expect(w.find('.ledger-detail').exists()).toBe(false);
  });

  it('reports its state to assistive tech', async () => {
    const w = mountWith(full);
    const btn = w.find('.expand-toggle');
    expect(btn.attributes('aria-expanded')).toBe('false');
    expect(btn.text()).toContain('Details');
    await expand(w);
    expect(w.find('.expand-toggle').attributes('aria-expanded')).toBe('true');
    expect(w.find('.expand-toggle').text()).toContain('Less');
  });

  it('remembers the choice, so a user who wants detail is not re-collapsed every visit', async () => {
    const first = mountWith(full);
    await expand(first);
    expect(localStorage.getItem(EXPANDED_KEY)).toBe('true');
    expect(mountWith(full).find('.ledger-detail').exists()).toBe(true);
  });

  it('offers no toggle when there is nothing behind it', () => {
    const w = mountWith({ summary: summaryOf({ costUsd: 1, calls: 3 }), byOrigin: [], byModel: [] });
    expect(w.find('.expand-toggle').exists()).toBe(false);
  });

  it('shows an empty state instead of a fake zero when nothing was recorded', () => {
    const w = mountWith({ summary: summaryOf({ calls: 0 }) });
    expect(w.find('.ledger-empty').exists()).toBe(true);
    expect(w.find('.headline').exists()).toBe(false);
  });
});

describe('says what timeframe it covers', () => {
  const full = { summary: summaryOf({ costUsd: 3.42, calls: 12 }) };

  it('states the range in the header', () => {
    expect(mountWith({ ...full, activityDays: 30 }).find('.range-label').text()).toBe('Last 30 days');
  });

  it('follows the chart selector rather than hard-coding a default', () => {
    expect(mountWith({ ...full, activityDays: 7 }).find('.range-label').text()).toBe('Last 7 days');
    expect(mountWith({ ...full, activityDays: 365 }).find('.range-label').text()).toBe('Last 365 days');
  });

  it('describes the data on screen, not a range still in flight', () => {
    // The store stamps activityDays only on a successful load, so a label that
    // tracked the selector would claim a window whose figures had not arrived.
    const w = mountWith({ ...full, activityDays: 7, isLoading: true });
    expect(w.find('.range-label').text()).toBe('Last 7 days');
  });
});

describe('breakdowns', () => {
  it('orders buckets by size and names them for humans', async () => {
    const w = mountWith({ summary: summaryOf({ notionalUsd: 16.67, calls: 9 }), byOrigin: BY_ORIGIN });
    await expand(w);
    expect(w.findAll('.bar-label').map((n) => n.text())).toEqual(['Chat', 'Workflow runs']);
  });

  it('reports one Chat row, not a legacy half and a current half', async () => {
    // REGRESSION: the breakdown listed "Chat (legacy) $17,517.39" above
    // "Orchestrator $2,029.30". Same surface, two database values, and the
    // reader left to do the addition. `chat` is the pre-split origin for the
    // very rows `orchestrator` writes now, so they are one source.
    const w = mountWith({
      summary: summaryOf({ notionalUsd: 20, calls: 9 }),
      byOrigin: [
        { bucket: 'chat', costUsd: 0, notionalUsd: 17, calls: 6 },
        { bucket: 'orchestrator', costUsd: 0, notionalUsd: 2, calls: 2 },
        { bucket: 'widget', costUsd: 0, notionalUsd: 1, calls: 1 },
      ],
    });
    await expand(w);
    const labels = w.findAll('.bar-label').map((n) => n.text());
    expect(labels).toEqual(['Chat', 'Widget Forge']);
    expect(labels.filter((l) => l === 'Chat')).toHaveLength(1);
    // Summed, not merely relabelled: 17 + 2.
    expect(w.findAll('.bar-value')[0].text()).toContain('19');
  });

  it('names a chat-surface origin instead of printing the database token', async () => {
    // REGRESSION: when the chat surfaces were split apart the backend began
    // writing orchestrator/widget/workflow/tool, none of which were in this
    // component's local label map. The `|| bucket` fallback then rendered them
    // verbatim, so one list read "Chat · orchestrator · Workflows · widget" —
    // two naming conventions and a duplicate-looking pair. Labels now come
    // from @/utils/originLabels, which has no pass-through.
    const w = mountWith({
      summary: summaryOf({ notionalUsd: 10, calls: 4 }),
      byOrigin: [
        { bucket: 'orchestrator', costUsd: 0, notionalUsd: 6, calls: 2 },
        { bucket: 'widget', costUsd: 0, notionalUsd: 3, calls: 1 },
        { bucket: 'workflow', costUsd: 0, notionalUsd: 1, calls: 1 },
      ],
    });
    await expand(w);
    const labels = w.findAll('.bar-label').map((n) => n.text());
    expect(labels).toEqual(['Chat', 'Widget Forge', 'Workflow Forge']);
    for (const label of labels) {
      expect(label).toMatch(/^[A-Z]/);
      expect(label).not.toMatch(/_/);
    }
  });

  it('keeps a tiny-but-real bucket visible instead of rendering it as nothing', async () => {
    const w = mountWith({ summary: summaryOf({ notionalUsd: 16.67, calls: 9 }), byOrigin: BY_ORIGIN });
    await expand(w);
    const widths = w.findAll('.bar-stack').map((n) => parseFloat(n.attributes('style').match(/[\d.]+/)[0]));
    expect(widths[0]).toBe(100);
    expect(widths[1]).toBeGreaterThanOrEqual(2);
  });

  it('caps the model list so one busy day cannot flood the panel', async () => {
    const byModel = Array.from({ length: 9 }, (_, i) => ({
      bucket: `model-${i}`, costUsd: i, notionalUsd: 0, calls: 1,
    }));
    const w = mountWith({ summary: summaryOf({ costUsd: 36, calls: 9 }), byModel });
    await expand(w);
    expect(w.findAll('.model-row')).toHaveLength(5);
  });
});
