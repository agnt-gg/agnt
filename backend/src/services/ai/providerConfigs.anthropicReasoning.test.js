/**
 * Direct Anthropic / Claude Code reasoning control.
 *
 * REGRESSION: the gate was /^claude-(opus|sonnet)-4-…/, so every Claude 5
 * model (opus-5, sonnet-5, opus-5-5, sonnet-5-5) had no reasoning selector AND
 * had any effort silently dropped on the wire — the transport asked the same
 * regex. `max` was unreachable on every model, and "Off" was offered on
 * always-thinking models that answer `thinking: disabled` with HTTP 400.
 *
 * Expected values are Anthropic's documented matrix
 * (platform.claude.com/docs build-with-claude/effort + /thinking).
 */
import { describe, it, expect } from 'vitest';
import {
  getReasoningControl,
  getAnthropicReasoningEfforts,
  getProviderConfig,
  registerDynamicPricingFromModels,
} from './providerConfigs.js';
import { anthropicReasoningEfforts, parseAnthropicModelId } from './descriptor/reasoningPredicates.js';
import { buildAnthropicReasoningConfig } from '../orchestrator/transports/_shared.js';

const optionValues = (provider, id) => getReasoningControl(provider, id)?.options.map((o) => o.value) ?? null;

const WITH_OFF_XHIGH_MAX = ['default', 'off', 'low', 'medium', 'high', 'xhigh', 'max'];
const XHIGH_MAX_NO_OFF = ['default', 'low', 'medium', 'high', 'xhigh', 'max'];
const WITH_OFF_MAX = ['default', 'off', 'low', 'medium', 'high', 'max'];

describe('the documented matrix, from the generation rule alone (no catalog)', () => {
  it.each([
    // REGRESSION: the four Claude 5 models that showed nothing.
    ['claude-opus-5', WITH_OFF_XHIGH_MAX],
    ['claude-sonnet-5', WITH_OFF_XHIGH_MAX],
    ['claude-opus-5-5', XHIGH_MAX_NO_OFF],
    ['claude-sonnet-5-5', XHIGH_MAX_NO_OFF],
    // Always-thinking families: no Off.
    ['claude-fable-5', XHIGH_MAX_NO_OFF],
    ['claude-fable-5-1', XHIGH_MAX_NO_OFF],
    ['claude-mythos-5', XHIGH_MAX_NO_OFF],
    ['claude-mythos-preview', ['default', 'low', 'medium', 'high', 'max']],
    // 4.x keeps what it had, plus a real max.
    ['claude-opus-4-8', WITH_OFF_XHIGH_MAX],
    ['claude-opus-4-7', WITH_OFF_XHIGH_MAX],
    ['claude-opus-4-6', WITH_OFF_MAX],
    ['claude-sonnet-4-6', WITH_OFF_MAX],
  ])('%s', (id, expected) => {
    expect(optionValues('claude-code', id)).toEqual(expected);
    expect(optionValues('anthropic', id)).toEqual(expected);
  });

  it.each([
    'claude-opus-4-5-20251101', // effort only with budget_tokens; rejects adaptive
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-20250514', // date suffix must not parse as minor 20250514
    'claude-3-7-sonnet-latest',
    'gpt-5.5',
  ])('%s has no adaptive effort control', (id) => {
    expect(getReasoningControl('claude-code', id)).toBeNull();
  });

  it('is a generation rule: the next release is covered without an edit', () => {
    expect(anthropicReasoningEfforts('claude-opus-6')).toEqual(['low', 'medium', 'high', 'max', 'xhigh']);
    expect(anthropicReasoningEfforts('claude-sonnet-4-10')).toContain('none');
    expect(parseAnthropicModelId('claude-opus-4-20250514')).toEqual({ line: 'opus', major: 4, minor: 0 });
  });

  it('labels xhigh "Very High" once a real Max exists', () => {
    const labels = Object.fromEntries(getReasoningControl('claude-code', 'claude-opus-5').options.map((o) => [o.value, o.label]));
    expect(labels).toMatchObject({ xhigh: 'Very High', max: 'Max' });
  });
});

describe('the wire honours exactly what the selector offers', () => {
  it('REGRESSION: an effort chosen for a Claude 5 model is actually sent', () => {
    expect(buildAnthropicReasoningConfig('claude-opus-5', 'high')).toEqual({
      thinking: { type: 'adaptive' },
      outputConfig: { effort: 'high' },
    });
    expect(buildAnthropicReasoningConfig('claude-sonnet-5-5', 'max')?.outputConfig).toEqual({ effort: 'max' });
  });

  it('never sends `disabled` to a model that rejects it', () => {
    expect(buildAnthropicReasoningConfig('claude-opus-5-5', 'off')).toBeNull();
    expect(buildAnthropicReasoningConfig('claude-fable-5', 'off')).toBeNull();
    expect(buildAnthropicReasoningConfig('claude-opus-5', 'off')).toEqual({ thinking: { type: 'disabled' } });
  });

  it('drops a level the model does not accept rather than failing the turn', () => {
    expect(buildAnthropicReasoningConfig('claude-opus-4-6', 'xhigh')).toBeNull();
    expect(buildAnthropicReasoningConfig('claude-haiku-4-5-20251001', 'high')).toBeNull();
  });

  it('every option in every selector produces a request (or the server default)', () => {
    for (const id of ['claude-opus-5', 'claude-opus-5-5', 'claude-fable-5', 'claude-opus-4-6']) {
      for (const { value } of getReasoningControl('anthropic', id).options) {
        const config = buildAnthropicReasoningConfig(id, value);
        if (value === 'default') continue;
        expect(config, `${id} / ${value}`).not.toBeNull();
        if (value !== 'off') expect(config.outputConfig.effort).toBe(value);
      }
    }
  });
});

describe("Anthropic's own catalog is authoritative once fetched", () => {
  const catalogEntry = (id, efforts, { adaptive = true } = {}) => ({
    id,
    display_name: id,
    max_input_tokens: 200000,
    max_tokens: 64000,
    capabilities: {
      effort: {
        supported: efforts.length > 0,
        ...Object.fromEntries(efforts.map((e) => [e, { supported: true }])),
        minimal: { supported: false },
      },
      thinking: { supported: true, types: { adaptive: { supported: adaptive }, enabled: { supported: true } } },
    },
  });

  const ingest = (provider, raw) => {
    const transform = getProviderConfig(provider).modelTransform;
    registerDynamicPricingFromModels(provider, [transform(raw)]);
  };

  it('a model no rule recognises is controllable the day Anthropic lists it', () => {
    expect(getReasoningControl('anthropic', 'claude-haiku-9-catalogtest')).toBeNull();
    ingest('anthropic', catalogEntry('claude-haiku-9-catalogtest', ['low', 'medium', 'high']));
    // No Off: the catalog cannot say thinking may be disabled, so it is withheld.
    expect(optionValues('anthropic', 'claude-haiku-9-catalogtest')).toEqual(['default', 'low', 'medium', 'high']);
  });

  it('applies across anthropic and claude-code, which serve the same catalog', () => {
    ingest('claude-code', catalogEntry('claude-haiku-9-crosstest', ['low', 'high']));
    expect(optionValues('anthropic', 'claude-haiku-9-crosstest')).toEqual(['default', 'low', 'high']);
    expect(buildAnthropicReasoningConfig('claude-haiku-9-crosstest', 'high')?.outputConfig).toEqual({ effort: 'high' });
  });

  it('published grades override the rule; Off still comes from the rule', () => {
    ingest('anthropic', catalogEntry('claude-opus-5-1-overridetest', ['low', 'high']));
    expect(getAnthropicReasoningEfforts('claude-opus-5-1-overridetest')).toEqual(['low', 'high', 'none']);
    expect(optionValues('anthropic', 'claude-opus-5-1-overridetest')).toEqual(['default', 'off', 'low', 'high']);
  });

  it('a model without adaptive thinking is not advertised, even with efforts', () => {
    const transformed = getProviderConfig('anthropic').modelTransform(
      catalogEntry('claude-opus-4-5-20251101', ['low', 'medium', 'high'], { adaptive: false })
    );
    expect(transformed.reasoning).toBeUndefined();
  });

  it('a model whose catalog row carries no capabilities is unchanged', () => {
    const transformed = getProviderConfig('anthropic').modelTransform({ id: 'claude-x', display_name: 'X' });
    expect(transformed).not.toHaveProperty('reasoning');
  });
});
