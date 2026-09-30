/**
 * Tools are dropped for a model its catalogue says cannot take them — for any
 * provider, not only Chutes. OpenRouter publishes `supported_parameters` per
 * model and, measured 2026-09-30, 67 of 464 live models reject `tools`; sending
 * them fails the whole request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiLikeAdapter } from '../llmAdapters.js';
import { getProviderConfig, registerDynamicPricing } from '../../ai/providerConfigs.js';

const TOOLS = [{ type: 'function', function: { name: 'web_search', parameters: { type: 'object', properties: {} } } }];
const adapterFor = (provider, model) => new OpenAiLikeAdapter({ chat: { completions: { create: vi.fn() } } }, model, { provider });

afterEach(() => vi.restoreAllMocks());

describe('_prepareTools', () => {
  it('drops tools for an OpenRouter model whose catalogue says it cannot take them', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerDynamicPricing('openrouter', 'test-vendor/no-tools-model', { supportsTools: false });
    expect(adapterFor('openrouter', 'test-vendor/no-tools-model')._prepareTools(TOOLS)).toEqual([]);
  });

  it('sends tools for a model that takes them, and when support is unknown', () => {
    registerDynamicPricing('openrouter', 'test-vendor/tools-model', { supportsTools: true });
    expect(adapterFor('openrouter', 'test-vendor/tools-model')._prepareTools(TOOLS)).toEqual(TOOLS);
    expect(adapterFor('openrouter', 'test-vendor/never-seen')._prepareTools(TOOLS)).toEqual(TOOLS);
  });

  it('keeps the existing Chutes behaviour', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerDynamicPricing('chutes', 'test/no-tools-TEE', { supportsTools: false });
    expect(adapterFor('chutes', 'test/no-tools-TEE')._prepareTools(TOOLS)).toEqual([]);
  });

  it('leaves providers that take no tools at all to the upstream gate (their request is unchanged)', () => {
    expect(getProviderConfig('cursor-cli').capabilities.text.supportsTools).toBe(false);
    expect(adapterFor('cursor-cli', 'cursor-grok-4.5-high')._prepareTools(TOOLS)).toEqual(TOOLS);
  });
});

describe('OpenRouter catalogue → capability flags', () => {
  const transform = getProviderConfig('openrouter').modelTransform;

  it('reads tool and image support from the live response shape', () => {
    const out = transform({
      id: 'a/b', name: 'B', pricing: {},
      supported_parameters: ['max_tokens', 'temperature'],
      architecture: { input_modalities: ['text', 'image'] },
    });
    expect(out).toMatchObject({ supportsTools: false, supportsVision: true });
    expect(transform({ id: 'a/c', name: 'C', pricing: {}, supported_parameters: ['tools', 'tool_choice'] }).supportsTools).toBe(true);
  });

  it('emits nothing when OpenRouter sent nothing — unknown is not "no"', () => {
    const out = transform({ id: 'a/d', name: 'D', pricing: {} });
    expect('supportsTools' in out).toBe(false);
    expect('supportsVision' in out).toBe(false);
  });
});
