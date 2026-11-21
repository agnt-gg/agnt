/**
 * Gemini thinking-level control: what the selector offers and what the request
 * carries must be the same list.
 *
 * Gemini 4 publishes a per-model `thinkingLevel` set
 * (ai.google.dev/gemini-api/docs/thinking, 2026-11-20):
 *
 *   gemini-4-neon, gemini-4-hydrogen   low, medium, high, xhigh
 *   gemini-4-carbon, gemini-4-argon    low, medium, high
 *
 * None accepts `minimal`. The selector and the request builder both gated on
 * startsWith('gemini-3'), so every Gemini 4 model had no control and the
 * chosen level was never sent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  getReasoningControl,
  getGeminiThinkingLevels,
  getModelMetadataForClient,
  registerDynamicPricingFromModels,
} from './providerConfigs.js';
import { isGemini4OrLaterModel, geminiBaselineThinkingLevels } from './descriptor/reasoningPredicates.js';
import { buildGeminiThinkingConfig } from '../orchestrator/transports/_shared.js';

/** OpenRouter catalog row shape, as returned by /api/v1/models. */
const catalogRow = (id, supportedEfforts) => ({
  id,
  contextLength: 1048576,
  pricing: { prompt: '0.000003', completion: '0.000015' },
  reasoning: { mandatory: true, default_enabled: true, supported_efforts: supportedEfforts },
});

const values = (control) => (control?.options || []).map((o) => o.value);
const labelOf = (control, value) => control?.options.find((o) => o.value === value)?.label;

beforeAll(() => {
  registerDynamicPricingFromModels('openrouter', [
    catalogRow('google/gemini-4-neon', ['xhigh', 'high', 'medium', 'low']),
    catalogRow('google/gemini-4-carbon', ['high', 'medium', 'low']),
  ]);
});

describe('isGemini4OrLaterModel', () => {
  it('matches Gemini 4 and every later generation', () => {
    for (const id of ['gemini-4-neon', 'gemini-4-hydrogen', 'gemini-4.1-carbon', 'gemini-5-pro', 'gemini-12-x', 'models/gemini-4-neon', 'GEMINI-4-ARGON']) {
      expect(isGemini4OrLaterModel(id), id).toBe(true);
    }
  });

  it('leaves older generations and router slugs alone', () => {
    for (const id of ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-pro', 'gemini-4o', 'google/gemini-4-neon', '', null]) {
      expect(isGemini4OrLaterModel(id), String(id)).toBe(false);
    }
  });

  it('has a generation baseline only for Gemini 4+', () => {
    expect(geminiBaselineThinkingLevels('gemini-5-pro')).toEqual(['low', 'medium', 'high']);
    expect(geminiBaselineThinkingLevels('gemini-3.8-flash')).toBeNull();
  });
});

describe('getGeminiThinkingLevels', () => {
  it('uses the published per-model list, weakest first', () => {
    expect(getGeminiThinkingLevels('gemini-4-neon')).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(getGeminiThinkingLevels('gemini-4-carbon')).toEqual(['low', 'medium', 'high']);
  });

  it('accepts the models/ prefix the API uses', () => {
    expect(getGeminiThinkingLevels('models/gemini-4-neon')).toEqual(['low', 'medium', 'high', 'xhigh']);
  });

  it('falls back to the generation baseline when nothing is published', () => {
    expect(getGeminiThinkingLevels('gemini-4-argon')).toEqual(['low', 'medium', 'high']);
  });

  it('returns null outside the thinking-level contract', () => {
    expect(getGeminiThinkingLevels('gemini-3.8-flash')).toBeNull();
    expect(getGeminiThinkingLevels('gemini-2.5-pro')).toBeNull();
  });
});

describe('getReasoningControl for Gemini 4', () => {
  it('offers xhigh (labelled Max) only where the model publishes it', () => {
    const neon = getReasoningControl('gemini', 'gemini-4-neon');
    expect(values(neon)).toEqual(['default', 'low', 'medium', 'high', 'xhigh']);
    expect(labelOf(neon, 'xhigh')).toBe('Max');

    expect(values(getReasoningControl('gemini', 'gemini-4-carbon'))).toEqual(['default', 'low', 'medium', 'high']);
  });

  it('never offers Off: no Gemini 4 model accepts minimal', () => {
    for (const id of ['gemini-4-neon', 'gemini-4-carbon', 'gemini-4-argon', 'gemini-4-hydrogen']) {
      expect(values(getReasoningControl('gemini', id)), id).not.toContain('off');
    }
  });

  it('applies to Antigravity, which shares the Gemini request path', () => {
    expect(values(getReasoningControl('antigravity', 'gemini-4-neon'))).toEqual(['default', 'low', 'medium', 'high', 'xhigh']);
  });

  it('reaches the client metadata the selector reads', () => {
    expect(values(getModelMetadataForClient('gemini', 'gemini-4-neon')?.reasoningControl)).toContain('xhigh');
  });

  it('leaves the Gemini 3 control unchanged', () => {
    expect(values(getReasoningControl('gemini', 'gemini-3.8-flash'))).toEqual(['default', 'off', 'low', 'medium', 'high']);
    expect(values(getReasoningControl('gemini', 'gemini-3.1-pro-preview'))).toEqual(['default', 'low', 'medium', 'high']);
  });
});

describe('buildGeminiThinkingConfig', () => {
  it('sends the selected level for Gemini 4', () => {
    expect(buildGeminiThinkingConfig('gemini-4-neon', 'xhigh')).toEqual({ thinkingLevel: 'xhigh' });
    expect(buildGeminiThinkingConfig('gemini-4-hydrogen', 'low')).toEqual({ thinkingLevel: 'low' });
    expect(buildGeminiThinkingConfig('gemini-4-carbon', 'medium')).toEqual({ thinkingLevel: 'medium' });
  });

  it('maps the legacy on toggle to high', () => {
    expect(buildGeminiThinkingConfig('gemini-4-argon', 'on')).toEqual({ thinkingLevel: 'high' });
  });

  it('sends nothing for default, letting the server choose', () => {
    expect(buildGeminiThinkingConfig('gemini-4-neon', 'default')).toBeNull();
    expect(buildGeminiThinkingConfig('gemini-4-neon', undefined)).toBeNull();
  });

  it('drops a level the model does not accept instead of sending it', () => {
    // Sticky selections: xhigh picked on neon, then the model switched.
    expect(buildGeminiThinkingConfig('gemini-4-carbon', 'xhigh')).toBeNull();
    expect(buildGeminiThinkingConfig('gemini-4-argon', 'xhigh')).toBeNull();
    // Off would be 'minimal', which Gemini 4 rejects.
    expect(buildGeminiThinkingConfig('gemini-4-neon', 'off')).toBeNull();
    expect(buildGeminiThinkingConfig('gemini-4-neon', 'max')).toBeNull();
  });

  it('every option the selector offers is sent as-is', () => {
    for (const id of ['gemini-4-neon', 'gemini-4-carbon', 'gemini-4-argon']) {
      for (const value of values(getReasoningControl('gemini', id)).filter((v) => v !== 'default')) {
        expect(buildGeminiThinkingConfig(id, value), `${id}:${value}`).toEqual({ thinkingLevel: value });
      }
    }
  });

  it('leaves Gemini 3 and 2.5 behaviour unchanged', () => {
    expect(buildGeminiThinkingConfig('gemini-3.8-flash', 'off')).toEqual({ thinkingLevel: 'minimal' });
    expect(buildGeminiThinkingConfig('gemini-3.1-pro-preview', 'high')).toEqual({ thinkingLevel: 'high' });
    expect(buildGeminiThinkingConfig('gemini-2.5-flash', 'low')).toEqual({ thinkingBudget: 1024 });
    expect(buildGeminiThinkingConfig('gemini-2.5-pro', 'high')).toEqual({ thinkingBudget: 32768 });
  });
});
