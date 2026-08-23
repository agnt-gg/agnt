/**
 * Reasoning controls built from what the PROVIDER published, not from a
 * hand-maintained vendor-prefix allowlist.
 *
 * WHY THIS EXISTS (measured 2026-08-23 against the live OpenRouter catalog)
 * ------------------------------------------------------------------------
 * `getReasoningControl` recognised OpenRouter reasoning models by slug prefix:
 * openai/gpt-5*, openai/o<N>, anthropic/claude-{opus-4,sonnet-4,3.7}*,
 * google/gemini-{3,2.5}*, x-ai/*. Anything else got no control at all, and
 * `isReasoningModel` reported it as `reasoning: false`.
 *
 * That is an allowlist, and it degraded silently. Of 141 live models that
 * publish a `supported_efforts` list, the prefixes matched 81. The 60 misses
 * included anthropic/claude-opus-5, deepseek/deepseek-v4-*, z-ai/glm-5.3,
 * moonshotai/kimi-k2.7-code, qwen/qwen3.8-max and stealth/ox-alpha.
 *
 * stealth/ox-alpha is the worst case and the one Nathan hit: its card says
 * `reasoning.mandatory: true` with `default_effort: "max"`, so thinking cannot
 * be switched off and effort is the ONLY lever on latency — and that lever was
 * unreachable. Every turn paid maximum thinking time (15-100s per round).
 *
 * The fix reads the catalog, but ONLY as a fallback after the predicates, and
 * the direction of that precedence is load-bearing. 15 models disagree the
 * other way: claude-sonnet-4.5, claude-opus-4.5 and x-ai/grok-4.20 publish NO
 * effort list because OpenRouter controls them with a token budget
 * (`supports_max_tokens`), yet their hand-written control works today. A
 * catalog-first rule would have deleted it. Both directions are pinned below.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  getReasoningControl,
  isReasoningModel,
  getModelMetadata,
  getModelMetadataForClient,
  registerDynamicPricingFromModels,
} from './providerConfigs.js';
import { buildOpenAiLikeReasoningExtraBody } from '../orchestrator/llmAdapters.js';

/** The exact wire shape OpenRouter returns, captured from /api/v1/models. */
const catalogRow = (id, reasoning, extra = {}) => ({
  id,
  contextLength: 131072,
  pricing: { prompt: '0', completion: '0' },
  reasoning,
  ...extra,
});

const values = (control) => (control?.options || []).map((o) => o.value);
const labelOf = (control, value) => control.options.find((o) => o.value === value)?.label;

beforeAll(() => {
  registerDynamicPricingFromModels('openrouter', [
    // Verbatim from the live catalog, 2026-08-23.
    catalogRow('stealth/ox-alpha', {
      mandatory: true,
      default_enabled: true,
      supported_efforts: ['max', 'high', 'low'],
      default_effort: 'max',
    }),
    // Optional reasoning: the vendor lists `none`, so Off is real.
    catalogRow('pubtest/optional-thinker', {
      mandatory: false,
      supported_efforts: ['high', 'medium', 'low', 'none'],
      default_effort: 'medium',
    }),
    // Both xhigh AND max present — the labels must stay distinguishable.
    catalogRow('pubtest/full-ladder', {
      mandatory: false,
      supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low', 'none'],
    }),
    // xhigh as the top grade with no max above it.
    catalogRow('pubtest/xhigh-top', {
      mandatory: false,
      supported_efforts: ['xhigh', 'medium', 'low'],
    }),
    // Carries the object but publishes no efforts — 148 live models look like
    // this. Says nothing about controllability.
    catalogRow('pubtest/no-efforts', { mandatory: false }),
    // Budget-controlled, exactly like anthropic/* on OpenRouter.
    catalogRow('pubtest/budget-only', { mandatory: false, supports_max_tokens: true }),
    // A prefix-matched model whose published list is NARROWER than the shipped
    // control. Used to prove the predicate still wins.
    catalogRow('openai/gpt-5.2', { mandatory: false, supported_efforts: ['high'] }),
    // Same payload registered under a NON-OpenRouter provider.
    catalogRow('pubtest/groq-shaped', { mandatory: false, supported_efforts: ['high', 'low'] }),

    // PREFIX-MATCHED models the catalog marks mandatory. Live shapes.
    // gemini-2.5-pro publishes no effort list at all; o4-mini-high publishes
    // one. Both 400 on effort:'none'.
    catalogRow('google/gemini-2.5-pro', { mandatory: true }),
    catalogRow('openai/o4-mini-high', { mandatory: true, supported_efforts: ['high'] }),
  ]);

  registerDynamicPricingFromModels('groq', [
    catalogRow('pubtest/groq-shaped', { mandatory: false, supported_efforts: ['high', 'low'] }),
  ]);
});

describe('ingest: a reasoning OBJECT is captured, a missing one stays unknown', () => {
  it('normalizes supported_efforts into stored metadata', () => {
    const meta = getModelMetadata('openrouter', 'stealth/ox-alpha');
    expect(meta.reasoningEfforts).toEqual(['max', 'high', 'low']);
    expect(meta.reasoningMandatory).toBe(true);
    expect(meta.reasoningDefaultEffort).toBe('max');
  });

  it('flips the reasoning flag that the metadata endpoint reports', () => {
    // GET /api/models/openrouter/metadata/stealth%2Fox-alpha returned
    // `"reasoning": false` while the model's own card said mandatory:true.
    expect(isReasoningModel('openrouter', 'stealth/ox-alpha')).toBe(true);
  });

  it('leaves reasoning UNKNOWN when no efforts are published', () => {
    // Not `false`. Absence of an effort list is not absence of reasoning —
    // budget-controlled models publish exactly this and reason anyway.
    const meta = getModelMetadata('openrouter', 'pubtest/no-efforts');
    expect(meta.reasoning).toBeUndefined();
    expect(meta.reasoningEfforts).toBeUndefined();
  });

  it('ships the control to the client alongside the metadata', () => {
    const forClient = getModelMetadataForClient('openrouter', 'stealth/ox-alpha');
    expect(forClient.reasoningControl).toBeTruthy();
    expect(forClient.reasoningControl.kind).toBe('effort');
  });
});

describe('control: built from the published effort list', () => {
  it('gives stealth/ox-alpha a real effort dial', () => {
    const control = getReasoningControl('openrouter', 'stealth/ox-alpha');
    expect(control, 'the model Nathan could not turn down').toBeTruthy();
    expect(values(control)).toEqual(['default', 'low', 'high', 'max']);
  });

  it('never offers Off when the vendor says reasoning is mandatory', () => {
    // ox-alpha's reasoning cannot be disabled. Offering the switch would send
    // effort:'none' and earn a rejection.
    const control = getReasoningControl('openrouter', 'stealth/ox-alpha');
    expect(values(control)).not.toContain('off');
  });

  it('offers Off exactly when the vendor lists `none`', () => {
    const control = getReasoningControl('openrouter', 'pubtest/optional-thinker');
    expect(values(control)).toEqual(['default', 'off', 'low', 'medium', 'high']);
  });

  it('orders grades weakest-to-strongest regardless of catalog order', () => {
    // The catalog lists strongest-first and inconsistently; a selector has to
    // read one way every time.
    const control = getReasoningControl('openrouter', 'pubtest/full-ladder');
    expect(values(control)).toEqual(['default', 'off', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('keeps xhigh and max distinguishable when both exist', () => {
    const control = getReasoningControl('openrouter', 'pubtest/full-ladder');
    expect(labelOf(control, 'xhigh')).toBe('Very High');
    expect(labelOf(control, 'max')).toBe('Max');
    expect(labelOf(control, 'xhigh')).not.toBe(labelOf(control, 'max'));
  });

  it('keeps calling a lone xhigh "Max", matching the shipped lists', () => {
    const control = getReasoningControl('openrouter', 'pubtest/xhigh-top');
    expect(labelOf(control, 'xhigh')).toBe('Max');
  });

  it('returns null when nothing was published', () => {
    expect(getReasoningControl('openrouter', 'pubtest/no-efforts')).toBeNull();
    expect(getReasoningControl('openrouter', 'pubtest/budget-only')).toBeNull();
    expect(getReasoningControl('openrouter', 'pubtest/never-seen-at-all')).toBeNull();
  });

  it('is scoped to OpenRouter and does not leak into other providers', () => {
    // Groq resolves its own models and returns null by design. Catalog data
    // registered under another provider must not conjure a control there.
    expect(getReasoningControl('groq', 'pubtest/groq-shaped')).toBeNull();
    expect(getReasoningControl('openrouter', 'pubtest/groq-shaped')).toBeTruthy();
  });
});

describe('precedence: the catalog fills gaps, it never overrides', () => {
  it('a shipped predicate control wins over a narrower published list', () => {
    // The catalog claims gpt-5.2 supports only ['high']. The hand-tuned list
    // is broader and correct; letting the catalog win would silently remove
    // options that work.
    const control = getReasoningControl('openrouter', 'openai/gpt-5.2');
    expect(values(control)).toEqual(['default', 'off', 'low', 'medium', 'high', 'xhigh']);
  });

  it('budget-controlled Anthropic models keep their control despite no efforts', () => {
    // THE REGRESSION A CATALOG-FIRST RULE WOULD HAVE CAUSED. These publish no
    // supported_efforts because OpenRouter maps effort onto a token budget.
    for (const model of [
      'anthropic/claude-sonnet-4.5',
      'anthropic/claude-opus-4.5',
      'anthropic/claude-3.7-sonnet',
    ]) {
      const control = getReasoningControl('openrouter', model);
      expect(control, `${model} lost its shipped reasoning control`).toBeTruthy();
      expect(values(control)).toContain('high');
    }
  });

  it('x-ai keeps its shipped control', () => {
    expect(getReasoningControl('openrouter', 'x-ai/grok-4.20')).toBeTruthy();
  });
});

describe('a mandatory-reasoning model is never offered an Off it will refuse', () => {
  /*
   * Verified live against OpenRouter, 2026-08-23. Sending
   * `reasoning: { effort: 'none' }` to each of these returns
   *   HTTP 400 "Reasoning is mandatory for this endpoint and cannot be disabled."
   * while the same request against a model that lists `none` returns 200.
   *
   * 45 prefix-matched models are marked mandatory, so "Off" was a guaranteed
   * failed request on every one of them — including google/gemini-2.5-pro,
   * which this provider recommends by default.
   */
  it('prunes Off from a predicate control when the catalog says mandatory', () => {
    const control = getReasoningControl('openrouter', 'google/gemini-2.5-pro');
    expect(control, 'the model must keep its control').toBeTruthy();
    expect(values(control)).toEqual(['default', 'low', 'medium', 'high']);
    expect(values(control)).not.toContain('off');
  });

  it('prunes Off even when no effort list is published', () => {
    // `mandatory` answers a different question than `supported_efforts`, so it
    // must be recorded independently of one.
    expect(getModelMetadata('openrouter', 'google/gemini-2.5-pro').reasoningMandatory).toBe(true);
    expect(getModelMetadata('openrouter', 'google/gemini-2.5-pro').reasoningEfforts).toBeUndefined();
  });

  it('prunes Off from the OpenAI prefix control too', () => {
    expect(values(getReasoningControl('openrouter', 'openai/o4-mini-high'))).not.toContain('off');
  });

  it('leaves every other option intact', () => {
    // Pruning must remove the impossible option, not degrade the control.
    const control = getReasoningControl('openrouter', 'openai/o4-mini-high');
    expect(control.kind).toBe('effort');
    expect(control.defaultValue).toBe('default');
    expect(values(control)).toEqual(['default', 'low', 'medium', 'high', 'xhigh']);
  });

  it('fails safe: no catalog entry means the control is untouched', () => {
    // Offline or cold cache must behave exactly as it did before this change.
    const control = getReasoningControl('openrouter', 'openai/gpt-5.1');
    expect(values(control)).toContain('off');
  });

  it('keeps Off for a model the catalog says is optional', () => {
    expect(values(getReasoningControl('openrouter', 'openai/gpt-5.2'))).toContain('off');
  });
});

describe('wire parity: every option offered is an option sent', () => {
  const catalogDriven = [
    'stealth/ox-alpha',
    'pubtest/optional-thinker',
    'pubtest/full-ladder',
    'pubtest/xhigh-top',
  ];

  it.each(catalogDriven)('%s sends a payload for every non-default option', (model) => {
    const control = getReasoningControl('openrouter', model);
    expect(control).toBeTruthy();

    for (const option of control.options) {
      if (option.value === 'default') continue; // null means "send nothing" by contract
      const wire = buildOpenAiLikeReasoningExtraBody('openrouter', model, option.value);
      expect(
        wire,
        `UI offers "${option.value}" for ${model} but the adapter sends nothing`
      ).not.toBeNull();
      expect(wire.reasoning).toBeTruthy();
    }
  });

  it('sends the published effort string verbatim', () => {
    // The whole point: the vendor told us which strings it accepts, so we hand
    // them back unchanged rather than translating through an internal vocab.
    expect(buildOpenAiLikeReasoningExtraBody('openrouter', 'stealth/ox-alpha', 'max'))
      .toEqual({ reasoning: { effort: 'max' } });
    expect(buildOpenAiLikeReasoningExtraBody('openrouter', 'stealth/ox-alpha', 'low'))
      .toEqual({ reasoning: { effort: 'low' } });
  });

  it('maps Off to the vendor spelling `none`', () => {
    expect(buildOpenAiLikeReasoningExtraBody('openrouter', 'pubtest/optional-thinker', 'off'))
      .toEqual({ reasoning: { effort: 'none' } });
  });

  it('sends nothing for default', () => {
    expect(buildOpenAiLikeReasoningExtraBody('openrouter', 'stealth/ox-alpha', 'default')).toBeNull();
  });
});

describe('the reverse direction: an effort NOT offered is never sent', () => {
  /*
   * The selected reasoning value is sticky — it lives in the store and
   * survives switching provider and model. So a value picked on one model
   * arrives attached to a different one, and the OpenRouter branch used to
   * forward whatever it was handed.
   *
   * Wire parity was only ever asserted one way ("every option offered sends
   * something"). This is the other way, and it is the direction that produces
   * bad requests rather than dead switches.
   */
  it('drops a carried-over effort the model never advertised', () => {
    // ox-alpha publishes max/high/low. medium/xhigh/minimal are not its to
    // interpret, and the result of sending one is undefined.
    for (const stale of ['medium', 'xhigh', 'minimal']) {
      expect(
        buildOpenAiLikeReasoningExtraBody('openrouter', 'stealth/ox-alpha', stale),
        `${stale} is not offered for ox-alpha and must not reach the wire`,
      ).toBeNull();
    }
  });

  it("drops the legacy 'on' toggle when the model has no medium", () => {
    // 'on' means "think", and it resolved to medium unconditionally. On
    // ox-alpha that invented an effort; sending nothing yields the vendor
    // default, which for this model is 'max' — thinking, as asked.
    expect(buildOpenAiLikeReasoningExtraBody('openrouter', 'stealth/ox-alpha', 'on')).toBeNull();
  });

  it("still maps 'on' to medium where medium IS offered", () => {
    expect(buildOpenAiLikeReasoningExtraBody('openrouter', 'openai/gpt-5.2', 'on'))
      .toEqual({ reasoning: { effort: 'medium' } });
  });

  it('never sends effort none to a mandatory-reasoning model', () => {
    // Pruning 'off' from the control fixed what the UI SHOWS. It does not stop
    // an 'off' already sitting in the store from arriving here, and this is
    // the request that earns HTTP 400 "Reasoning is mandatory for this
    // endpoint and cannot be disabled."
    expect(buildOpenAiLikeReasoningExtraBody('openrouter', 'google/gemini-2.5-pro', 'off')).toBeNull();
    expect(buildOpenAiLikeReasoningExtraBody('openrouter', 'openai/o4-mini-high', 'off')).toBeNull();
    expect(buildOpenAiLikeReasoningExtraBody('openrouter', 'stealth/ox-alpha', 'off')).toBeNull();
  });

  it('still sends every effort the model DOES advertise', () => {
    // The clamp must not become a mute button.
    expect(buildOpenAiLikeReasoningExtraBody('openrouter', 'stealth/ox-alpha', 'max'))
      .toEqual({ reasoning: { effort: 'max' } });
    expect(buildOpenAiLikeReasoningExtraBody('openrouter', 'stealth/ox-alpha', 'high'))
      .toEqual({ reasoning: { effort: 'high' } });
    expect(buildOpenAiLikeReasoningExtraBody('openrouter', 'pubtest/optional-thinker', 'off'))
      .toEqual({ reasoning: { effort: 'none' } });
  });
});
