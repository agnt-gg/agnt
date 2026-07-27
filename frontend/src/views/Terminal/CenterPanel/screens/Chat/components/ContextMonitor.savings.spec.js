// Cache-savings display: original cost vs actual cost, and the three states
// that must never be confused — real saving, first-turn cache investment
// (genuinely negative), and "this provider has no cache pricing" (show
// nothing rather than a fake zero).
//
// This spec also mounts the component, which compiles the SFC — that alone
// pins the template against the malformed-markup class of regression.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ContextMonitor from './ContextMonitor.vue';

const base = {
  contextStatus: { currentTokens: 1000, tokenLimit: 100000, model: 'claude-opus-5' },
  totalTokenUsage: { inputTokens: 1_400_000, outputTokens: 24_100, totalTokens: 1_424_100 },
};

const mountWith = (props) => mount(ContextMonitor, { props: { ...base, ...props } });

describe('cost comparison', () => {
  it('shows both the uncached baseline and what was actually paid', () => {
    const w = mountWith({ totalCost: 3.614, totalUncachedCost: 7.6025 });
    const text = w.text();
    expect(text).toContain('Without Caching');
    expect(text).toContain('7.6025');
    expect(text).toContain('You Paid');
    expect(text).toContain('3.6140');
  });

  it('renders the saving with its percentage', () => {
    const w = mountWith({ totalCost: 3.614, totalUncachedCost: 7.6025 });
    expect(w.text()).toContain('Saved by Caching');
    expect(w.text()).toContain('3.9885');
    expect(w.text()).toContain('52.5%');
  });

  it('strikes through the baseline so the comparison reads at a glance', () => {
    const w = mountWith({ totalCost: 3.614, totalUncachedCost: 7.6025 });
    expect(w.find('.baseline-value').exists()).toBe(true);
  });

  it('splits the track between paid and saved', () => {
    const w = mountWith({ totalCost: 3.614, totalUncachedCost: 7.6025 });
    const paid = w.find('.savings-paid').attributes('style') || '';
    expect(paid).toMatch(/47\.5/);
  });

  // The label reports the SAVED share, so the saved segment must lead the bar
  // and carry the emphasis fill. Inverted, a 77.2% saving rendered as a bar
  // that looked 22.8% full and contradicted its own headline.
  it('draws the saved share first, sized to the reported percentage', () => {
    const w = mountWith({ totalCost: 209.8404, totalUncachedCost: 920.7626 });
    const segs = w.find('.savings-track').findAll('div');
    expect(segs[0].classes()).toContain('savings-free');
    expect(segs[1].classes()).toContain('savings-paid');
    const savedWidth = parseFloat((segs[0].attributes('style') || '').match(/([\d.]+)%/)[1]);
    expect(savedWidth).toBeCloseTo(77.2, 0);
  });
});

describe('first-turn cache investment (negative saving)', () => {
  const investment = { totalCost: 0.3375, totalUncachedCost: 0.275 };

  it('is reported honestly, not clamped to zero', () => {
    const w = mountWith(investment);
    expect(w.text()).toContain('Cache Investment');
    expect(w.text()).toContain('0.0625');
  });

  it('is visually distinct from a saving', () => {
    const w = mountWith(investment);
    expect(w.find('.savings-block').classes()).toContain('investment');
  });

  it('explains that it pays back', () => {
    expect(mountWith(investment).text()).toContain('pays back');
  });

  // "negative savings" forces a mental double-negative; state the direction.
  it('states the direction rather than showing a negative percentage', () => {
    const w = mountWith(investment);
    expect(w.find('.savings-pct').text()).toBe('more');
    // Scoped to the savings block: the request-size gauge legitimately shows
    // its own percentage elsewhere in the component.
    expect(w.find('.savings-block').text()).not.toMatch(/\d%/);
  });

  // Strikethrough is a retail idiom: "was more, now less". In this state the
  // baseline is LOWER than what was paid, so striking it would assert the
  // exact opposite of the amber number directly below it.
  it('does NOT strike through the baseline when it is the cheaper number', () => {
    const w = mountWith(investment);
    expect(w.find('.baseline-value').classes()).not.toContain('struck');
  });

  it('relabels the baseline so it is not read as a discount', () => {
    const w = mountWith(investment);
    expect(w.text()).toContain('Baseline (no cache)');
    expect(w.text()).not.toContain('Without Caching');
  });

  // A full, success-coloured progress track cannot appear in a loss state.
  it('hides the paid/saved track entirely', () => {
    expect(mountWith(investment).find('.savings-track').exists()).toBe(false);
  });

  it('still strikes through the baseline in the normal saving state', () => {
    const w = mountWith({ totalCost: 3.614, totalUncachedCost: 7.6025 });
    expect(w.find('.baseline-value').classes()).toContain('struck');
    expect(w.find('.savings-track').exists()).toBe(true);
  });
});

describe('sub-cent amounts keep 6dp precision', () => {
  it('formats a tiny cost without rounding it to nothing', () => {
    const w = mountWith({ totalCost: 0.000123, totalUncachedCost: null, estimatedCost: 0.000123 });
    expect(w.text()).toContain('0.000123');
  });
});

describe('providers with no cache pricing', () => {
  it('hides the savings block entirely rather than showing a fake zero', () => {
    const w = mountWith({ totalCost: 0.0598, totalUncachedCost: null });
    expect(w.find('.savings-block').exists()).toBe(false);
    expect(w.text()).not.toContain('Without Caching');
  });

  it('still shows the plain total cost', () => {
    const w = mountWith({ totalCost: 0.0598, totalUncachedCost: null });
    expect(w.text()).toContain('Total Cost');
    expect(w.text()).toContain('0.0598');
  });

  it('hides the block when the saving rounds to nothing', () => {
    const w = mountWith({ totalCost: 0.05, totalUncachedCost: 0.05 });
    expect(w.find('.savings-block').exists()).toBe(false);
  });
});

describe('last-call breakdown', () => {
  it('shows the per-turn baseline next to the per-turn cost', () => {
    const w = mountWith({
      totalCost: 3.614,
      totalUncachedCost: 7.6025,
      estimatedCost: 0.06,
      costBreakdown: { actual: 0.06, uncached: 0.285, saved: 0.225 },
    });
    expect(w.find('.baseline-inline').exists()).toBe(true);
    expect(w.text()).toContain('0.2850');
  });

  it('labels the inline baseline so two bare prices are not ambiguous', () => {
    const w = mountWith({
      totalCost: 3.614,
      totalUncachedCost: 7.6025,
      estimatedCost: 0.06,
      costBreakdown: { actual: 0.06, uncached: 0.285, saved: 0.225 },
    });
    expect(w.find('.baseline-inline').text()).toContain('was');
  });

  it('omits the "was" baseline on a write turn, where it would mislead', () => {
    const w = mountWith({
      totalCost: 0.3375,
      totalUncachedCost: 0.275,
      estimatedCost: 0.3375,
      costBreakdown: { actual: 0.3375, uncached: 0.275, saved: -0.0625 },
    });
    expect(w.find('.baseline-inline').exists()).toBe(false);
  });

  it('omits the inline baseline when unpriceable', () => {
    const w = mountWith({ totalCost: 3.614, estimatedCost: 0.06, costBreakdown: null });
    expect(w.find('.baseline-inline').exists()).toBe(false);
  });
});

describe('subscription seats (claude-code / codex)', () => {
  // The stored cost is what the METERED API would have charged. On a seat it
  // is not money the user was billed, so presenting it as "You Paid" asserts
  // a charge that does not exist.
  const seat = { totalCost: 209.8404, totalUncachedCost: 920.7626, subscriptionBased: true };

  it('never claims the notional figure was paid', () => {
    const w = mountWith(seat);
    expect(w.text()).toContain('Metered API Would Charge');
    expect(w.text()).not.toContain('You Paid $209');
  });

  it('states plainly that $0.00 was actually billed', () => {
    const w = mountWith(seat);
    expect(w.find('.paid-nothing').text()).toContain('$0.00');
    expect(w.find('.paid-note').text()).toContain('subscription');
  });

  it('reports what the subscription itself absorbed', () => {
    const w = mountWith(seat);
    const block = w.find('.savings-block.subscription');
    expect(block.exists()).toBe(true);
    expect(block.text()).toContain('Saved by Subscription');
    expect(block.text()).toContain('209.8404');
  });

  it('totals both layers to the full uncached baseline', () => {
    const w = mountWith(seat);
    // caching 710.9222 + subscription 209.8404 == 920.7626
    expect(w.find('.savings-total-value').text()).toContain('920.7626');
  });

  it('still shows the caching layer separately', () => {
    const w = mountWith(seat);
    expect(w.text()).toContain('Saved by Caching');
    expect(w.text()).toContain('710.9222');
  });

  it('shows none of this for a metered provider', () => {
    const w = mountWith({ totalCost: 3.614, totalUncachedCost: 7.6025, subscriptionBased: false });
    expect(w.find('.savings-block.subscription').exists()).toBe(false);
    expect(w.find('.paid-nothing').exists()).toBe(false);
    expect(w.text()).toContain('You Paid');
  });

  it('makes no claim when a conversation mixes seat and metered turns', () => {
    const w = mountWith({ totalCost: 3.614, totalUncachedCost: 7.6025, subscriptionBased: null });
    expect(w.find('.savings-block.subscription').exists()).toBe(false);
    expect(w.text()).toContain('You Paid');
  });
});

describe('token formatting at agentic scale', () => {
  // Tool loops re-send the whole context every round, so conversations reach
  // hundreds of millions of tokens. Stopping at 'k' rendered 170,781,100 as
  // "170781.1k".
  const withTokens = (n) => mountWith({
    totalTokenUsage: { inputTokens: n, outputTokens: 0, totalTokens: n },
    totalCost: 1,
  });

  it('scales to M', () => {
    expect(withTokens(170_781_100).text()).toContain('170.8M');
    expect(withTokens(170_781_100).text()).not.toContain('170781.1k');
  });

  it('scales to B', () => {
    expect(withTokens(2_400_000_000).text()).toContain('2.4B');
  });

  it('keeps k below a million and raw below a thousand', () => {
    expect(withTokens(18_134).text()).toContain('18.1k');
    expect(withTokens(787).text()).toContain('787');
  });
});

describe('mixed-model conversations', () => {
  // 52% of multi-turn conversations span several models, and they can differ
  // 2x in price. A single-model label makes the totals irreconcilable.
  const mix = [
    { model: 'claude-opus-5', calls: 10, cost: 128.01 },
    { model: 'claude-fable-5', calls: 3, cost: 49.39 },
    { model: 'claude-opus-4-6', calls: 1, cost: 32.44 },
  ];

  it('lists every model with its own call count and cost', () => {
    const w = mountWith({ totalCost: 209.84, modelMix: mix });
    const text = w.find('.model-mix').text();
    expect(text).toContain('claude-opus-5');
    expect(text).toContain('claude-fable-5');
    expect(text).toContain('claude-opus-4-6');
    expect(text).toContain('49.3900');
  });

  it('announces how many models ran and what they reconcile to', () => {
    const w = mountWith({ totalCost: 209.84, modelMix: mix });
    const head = w.find('.model-mix-head').text();
    expect(head).toContain('3 models');
    // The per-model costs must visibly add up to the figure above them.
    expect(head).toContain('209.8400');
  });

  it('pluralizes call counts', () => {
    const w = mountWith({ totalCost: 209.84, modelMix: mix });
    const rows = w.findAll('.model-mix-calls').map((r) => r.text());
    expect(rows).toContain('10 calls');
    expect(rows).toContain('1 call');
    expect(rows).not.toContain('1 calls');
  });

  it('names it the metered split only on a seat', () => {
    expect(mountWith({ totalCost: 209.84, modelMix: mix, subscriptionBased: true })
      .find('.model-mix-head').text()).toContain('metered split');
    expect(mountWith({ totalCost: 209.84, modelMix: mix, subscriptionBased: false })
      .find('.model-mix-head').text()).toContain('cost split');
  });

  it('stays hidden when only one model ran', () => {
    const w = mountWith({ totalCost: 209.84, modelMix: [mix[0]] });
    expect(w.find('.model-mix').exists()).toBe(false);
  });
});

describe('SFC integrity', () => {
  it('mounts and renders the existing gauge unchanged', () => {
    const w = mountWith({
      totalCost: 1,
      totalUncachedCost: 2,
      contextStatus: {
        currentTokens: 50000, tokenLimit: 100000, model: 'claude-opus-5',
        breakdown: { systemTokens: 3000, toolTokens: 900, messagesTokens: 400, outputBufferTokens: 8000 },
      },
    });
    expect(w.find('.context-monitor').exists()).toBe(true);
    expect(w.find('.usage-bar').exists()).toBe(true);
    expect(w.text()).toContain('Request Size');
    expect(w.findAll('.seg').length).toBeGreaterThanOrEqual(4);
  });
});
