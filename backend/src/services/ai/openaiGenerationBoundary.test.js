/**
 * The GPT-6 regression.
 *
 * `gpt-6-astra` appeared in the Codex model list and AGNT stopped being able to
 * talk to it at all. The cause was not one bug but one ASSUMPTION, written as
 * `startsWith('gpt-5')` in seven places: a prefix test that silently doubles as
 * a prediction that OpenAI will never ship another generation.
 *
 * The failure was invisible in exactly the way that matters. llmAdapters threw
 * while CONSTRUCTING the openai-codex adapter, so the provider never came up,
 * the failover chain quietly served openrouter/gpt-5.2 instead, and the user
 * saw a normal-looking answer from a model they did not choose.
 *
 * Worse, the cache layer had ALREADY been written generation-aware
 * (promptCacheTtl.OPENAI_GPT56_OR_LATER matches [6-9]), so gpt-6-astra was
 * billed as a modern model while being undispatchable as one. Two layers, one
 * boundary, disagreeing.
 *
 * These tests pin the boundary itself rather than the individual call sites,
 * so the next generation cannot reintroduce it.
 */
import { describe, it, expect } from 'vitest';
import {
  isOpenAIGen5OrLater,
  isOpenAIGen6OrLater,
  isOpenAIResponsesReasoningModel,
  isOpenRouterOpenAIReasoningModel,
  getReasoningControl,
  getModelMetadata,
  getModelCost,
} from './providerConfigs.js';
import { OPENAI_GPT56_OR_LATER } from '../../utils/promptCacheTtl.js';
import {
  requiresResponsesApi,
  getOpenAIReasoningValues,
  buildResponsesReasoningConfig,
} from '../orchestrator/transports/_shared.js';

// The exact model that broke, plus the generations after it.
const FUTURE_MODELS = ['gpt-6', 'gpt-6-astra', 'gpt-6.2', 'gpt-7', 'gpt-9-foo', 'gpt-10', 'gpt-10.1'];

// Must NOT be swept in by a sloppy generation regex.
const OLDER_MODELS = ['gpt-4', 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-3.5-turbo', 'gpt-image-1'];

describe('OpenAI generation boundary', () => {
  describe('gen-5-or-later admits every shipping GPT-5 id (no behaviour lost)', () => {
    it.each([
      'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.1', 'gpt-5.2', 'gpt-5.2-codex',
      'gpt-5.3-codex-spark', 'gpt-5.4', 'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-luna',
    ])('%s', (model) => {
      expect(isOpenAIGen5OrLater(model)).toBe(true);
    });
  });

  describe('gen-5-or-later admits GPT-6+ — the regression', () => {
    it.each(FUTURE_MODELS)('%s', (model) => {
      expect(isOpenAIGen5OrLater(model)).toBe(true);
    });
  });

  describe('gen-5-or-later still excludes pre-GPT-5', () => {
    it.each(OLDER_MODELS)('%s', (model) => {
      expect(isOpenAIGen5OrLater(model)).toBe(false);
    });
  });

  it('separates the two boundaries: gpt-5 is gen5 but NOT gen6', () => {
    // This distinction is load-bearing. The un-decimalled gpt-5 uses the legacy
    // 'minimal' reasoning contract; sweeping it into the gen6 branch would
    // hand it an effort value the Responses API rejects.
    expect(isOpenAIGen5OrLater('gpt-5')).toBe(true);
    expect(isOpenAIGen6OrLater('gpt-5')).toBe(false);
    expect(isOpenAIGen6OrLater('gpt-5.6-sol')).toBe(false);
    expect(isOpenAIGen6OrLater('gpt-6-astra')).toBe(true);
  });
});

describe('transport dispatch (the gate that actually broke)', () => {
  it('routes gpt-6-astra to the Responses API', () => {
    // llmAdapters throws for openai-codex when this is false, which is how a
    // single unrecognised model took the whole provider offline.
    expect(requiresResponsesApi('gpt-6-astra')).toBe(true);
  });

  it.each(FUTURE_MODELS)('routes %s to the Responses API', (model) => {
    expect(requiresResponsesApi(model)).toBe(true);
  });

  it.each(['gpt-5', 'gpt-5.2-codex', 'gpt-5.6-sol', 'o1', 'o3-mini', 'o4-mini'])(
    'still routes %s to the Responses API',
    (model) => {
      expect(requiresResponsesApi(model)).toBe(true);
    },
  );

  it.each(OLDER_MODELS)('keeps %s on chat/completions', (model) => {
    expect(requiresResponsesApi(model)).toBe(false);
  });
});

describe('reasoning contract follows the model across generations', () => {
  it('gives gpt-6-astra its documented effort set, not an empty one', () => {
    // An empty set makes buildResponsesReasoningConfig return null, so the
    // request ships with no effort at all — the model just looks dumber than
    // advertised, with nothing in the logs to say why.
    //
    // "reasoning.effort supports low, medium, high, xhigh, and max"
    // — developers.openai.com/api/docs/models/gpt-6-astra (2026-09-04)
    const values = getOpenAIReasoningValues('gpt-6-astra');
    expect([...values].sort()).toEqual(['high', 'low', 'max', 'medium', 'xhigh']);
  });

  it('does not offer gpt-6-astra an effort level its API never listed', () => {
    // 'none' and 'minimal' belong to earlier contracts. Offering either would
    // put a control in the UI that the wire silently drops.
    const values = getOpenAIReasoningValues('gpt-6-astra');
    expect(values.has('none')).toBe(false);
    expect(values.has('minimal')).toBe(false);
  });

  it('keeps max out of the GPT-5 families that never had it', () => {
    expect(getOpenAIReasoningValues('gpt-5.6-sol').has('max')).toBe(false);
    expect(getOpenAIReasoningValues('gpt-5.2-codex').has('max')).toBe(false);
    expect(getOpenAIReasoningValues('gpt-5').has('max')).toBe(false);
  });

  it('leaves the legacy gpt-5 contract alone', () => {
    expect([...getOpenAIReasoningValues('gpt-5')].sort()).toEqual(
      ['high', 'low', 'medium', 'minimal'],
    );
  });

  it.each(['openai', 'openai-codex'])('surfaces the full effort ladder for gpt-6-astra on %s', (provider) => {
    const control = getReasoningControl(provider, 'gpt-6-astra');
    expect(control).not.toBeNull();
    expect(control.kind).toBe('effort');
    const offered = control.options.map((o) => o.value);
    // Every level the API accepts must be reachable, and nothing else.
    expect(offered).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(offered).not.toContain('off');
  });

  it('never lets the UI and the wire disagree about gpt-6-astra', () => {
    // The drift this whole descriptor exists to prevent: a button that sends
    // an effort the transport would refuse to forward.
    const wire = getOpenAIReasoningValues('gpt-6-astra');
    const offered = getReasoningControl('openai', 'gpt-6-astra')
      .options.map((o) => o.value)
      .filter((v) => v !== 'default');
    for (const value of offered) {
      expect(wire.has(value), `UI offers "${value}" but the transport drops it`).toBe(true);
    }
  });

  it('treats gpt-6-astra as a reasoning model', () => {
    expect(isOpenAIResponsesReasoningModel('gpt-6-astra')).toBe(true);
  });

  it('carries the same fix through the OpenRouter slug form', () => {
    expect(isOpenRouterOpenAIReasoningModel('openai/gpt-6-astra')).toBe(true);
    expect(isOpenRouterOpenAIReasoningModel('openai/gpt-5.2')).toBe(true);
    expect(isOpenRouterOpenAIReasoningModel('openai/o3')).toBe(true);
    expect(isOpenRouterOpenAIReasoningModel('openai/gpt-4o')).toBe(false);
    // A vendor prefix must not be enough on its own.
    expect(isOpenRouterOpenAIReasoningModel('anthropic/claude-opus-5')).toBe(false);
  });
});

describe('an effort Astra cannot express degrades safely', () => {
  // A stale 'off' can still arrive from a preference saved while a GPT-5
  // model was selected. Astra has no 'none', so the only two options are
  // "send something it rejects" (a 400 mid-conversation) or "send nothing and
  // take the provider default". The builder returns null, and the adapter's
  // documented `|| { effort: 'medium' }` fallback covers it — a live request
  // instead of a hard failure.
  it.each(['off', 'none', 'minimal'])('drops the unsupported effort %s', (value) => {
    expect(buildResponsesReasoningConfig('gpt-6-astra', value)).toBeNull();
  });

  it('still forwards every effort Astra does accept', () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(buildResponsesReasoningConfig('gpt-6-astra', effort)).toEqual({ effort });
    }
  });

  it('leaves the GPT-5 off-switch working', () => {
    // Proof the gen-6 branch did not capture models that DO support 'none'.
    expect(buildResponsesReasoningConfig('gpt-5.6-sol', 'off')).toEqual({ effort: 'none' });
  });
});

describe('gpt-6-astra metadata', () => {
  // Sourced 2026-09-04 from developers.openai.com/api/docs/models/gpt-6-astra:
  // 1,050,000 context · 128,000 max output · $10 in / $1 cached / $50 out.
  it('is priced, so cost tracking does not silently read $0', () => {
    const cost = getModelCost('openai', 'gpt-6-astra', 1_000_000, 1_000_000);
    expect(cost).not.toBeNull();
    expect(cost.inputCost).toBeCloseTo(10.0, 10);
    expect(cost.outputCost).toBeCloseTo(50.0, 10);
  });

  it('caps the api.openai.com window at the 272K long-context cliff', () => {
    // Crossing 272K re-prices the ENTIRE request at 2x input / 1.5x output,
    // so the usable window stops at the cliff — same rule as gpt-5.6-sol.
    const meta = getModelMetadata('openai', 'gpt-6-astra');
    expect(meta.contextWindow).toBe(272_000);
    expect(meta.maxOutputTokens).toBe(128_000);
    expect(meta.supportsVision).toBe(true);
    expect(meta.supportsTools).toBe(true);
    expect(meta.reasoning).toBe(true);
  });

  it('gives Codex the full 1.05M window it is explicitly exempted into', () => {
    // "GPT-6 Astra usage in Codex does not incur additional long-context
    // multipliers above 272K input tokens." — ChatGPT Rate Card, 2026-09-04.
    // Inheriting OpenAI's cliff-capped row here would discard 778,000 tokens
    // of a window that costs nothing extra on this surface.
    const meta = getModelMetadata('openai-codex', 'gpt-6-astra');
    expect(meta.contextWindow).toBe(1_050_000);
  });

  it('charges the same rates on both surfaces — only the window differs', () => {
    const api = getModelMetadata('openai', 'gpt-6-astra');
    const codex = getModelMetadata('openai-codex', 'gpt-6-astra');
    expect(codex.inputCostPer1M).toBe(api.inputCostPer1M);
    expect(codex.outputCostPer1M).toBe(api.outputCostPer1M);
    expect(codex.contextWindow).toBeGreaterThan(api.contextWindow);
  });

  it('publishes the cached-read rate rather than guessing at it', () => {
    expect(getModelMetadata('openai', 'gpt-6-astra').inputCacheReadCostPer1M).toBe(1.0);
  });
});

describe('pricing and dispatch agree about which models are modern', () => {
  // The original defect: promptCacheTtl already knew gpt-6 existed and billed
  // it accordingly, while the transport layer did not know and refused to
  // dispatch it. Any model the cache layer calls modern must be dispatchable.
  it.each(['gpt-6', 'gpt-6-astra', 'gpt-7', 'gpt-5.6-sol', 'gpt-5.6-luna'])(
    '%s is dispatchable if it is billed as GPT-5.6+',
    (model) => {
      if (OPENAI_GPT56_OR_LATER.test(model)) {
        expect(requiresResponsesApi(model)).toBe(true);
      }
    },
  );
});
