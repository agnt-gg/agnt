/**
 * CONTRACT: the default model must be one the provider actually serves.
 *
 * Every provider in providerConfigs is `staticModels: false` — the real
 * catalogue is fetched from the vendor at run time — so the hardcoded
 * `fallbackVisionModels` / `recommendedModels` arrays are a guess about an open
 * world. Verified live on 2026-08-09, two of those guesses were unusable:
 *
 *   groq       meta-llama/llama-4-scout-17b-16e-instruct  -> 404 model_not_found
 *   togetherai meta-llama/Llama-4-Maverick-17B-128E-...   -> 400 non-serverless
 *
 * Neither had a failing test, because nothing related "the default we pick" to
 * "what the vendor lists". These do.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const lastModels = { store: {} };
vi.mock('../../../services/ai/lastModelsCache.js', () => ({
  getLastSuccessfulModels: (key) => lastModels.store[String(key).toLowerCase()] || null,
}));

const {
  defaultModelFor,
  resolveBrowserUseProvider,
  describeModelAvailabilityError,
} = await import('./browserUseProviders.js');

beforeEach(() => { lastModels.store = {}; });

const asModels = (...ids) => ids.map((id) => ({ id, name: id }));

describe('default model prefers what the vendor actually lists', () => {
  it('skips a stale static default the catalogue does not contain', () => {
    // Groq's real catalogue, captured live. The static vision pick is absent.
    lastModels.store.groq = asModels(
      'openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3.6-27b',
    );
    const model = defaultModelFor('groq');
    expect(model).not.toMatch(/llama-4-scout/);
    expect(['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3.6-27b']).toContain(model);
  });

  it('keeps a static default the catalogue confirms', () => {
    lastModels.store.openai = asModels('gpt-4.1', 'gpt-5.2', 'gpt-4o');
    // gpt-5.2 is openai's first fallbackVisionModel and it is really listed.
    expect(defaultModelFor('openai')).toBe('gpt-5.2');
  });

  it('never picks a model that cannot hold a conversation', () => {
    // A catalogue of nothing but non-chat models: whisper, TTS, guards.
    lastModels.store.groq = asModels(
      'whisper-large-v3', 'whisper-large-v3-turbo',
      'meta-llama/llama-prompt-guard-2-22m', 'playai-tts',
    );
    const model = defaultModelFor('groq');
    expect(model).not.toMatch(/whisper|guard|tts/i);
  });

  it('reads the cache under the display name too', () => {
    // lastModelsCache is written as `this.name.toLowerCase()`, so multi-word
    // providers land under 'together ai', not 'togetherai'. Reading by key
    // alone silently misses exactly the providers whose defaults were stale.
    lastModels.store['together ai'] = asModels('deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-235B');
    expect(defaultModelFor('togetherai')).toBe('deepseek-ai/DeepSeek-V3');
  });

  it('falls back to the static list when nothing has ever been fetched', () => {
    expect(lastModels.store).toEqual({});
    // Unverified, but it is the only information available and refusing to
    // start would be worse than trying the documented default.
    expect(defaultModelFor('openai')).toBeTruthy();
  });

  it('still gives every provider some default', () => {
    for (const key of ['openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'zai', 'claude-code']) {
      expect(defaultModelFor(key), `${key} has no default`).toBeTruthy();
    }
  });
});

describe('when the chosen model is rejected anyway', () => {
  // Being listed in a catalogue does not prove an account can call the model,
  // and no metadata we receive closes that gap — Together's rejected model was
  // priced and listed. So the failure has to carry the fix.
  const shapes = [
    ['groq', 'The model `meta-llama/llama-4-scout` does not exist or you do not have access to it.'],
    ['togetherai', 'Unable to access non-serverless model meta-llama/Llama-4-Scout-17B-16E-Instruct.'],
    ['openai', '{"error":{"code":"model_not_found"}}'],
    ['zai', 'model_not_available'],
  ];

  for (const [provider, message] of shapes) {
    it(`recognises the ${provider} shape and names the fix`, () => {
      const guidance = describeModelAvailabilityError(message, 'Together AI');
      expect(guidance).toBeTruthy();
      expect(guidance).toMatch(/Set the Model field/);
      expect(guidance).toContain('Together AI');
    });
  }

  it('leaves unrelated failures alone rather than mislabelling them', () => {
    expect(describeModelAvailabilityError('Insufficient Balance', 'DeepSeek')).toBeNull();
    expect(describeModelAvailabilityError('429 rate limit exceeded', 'Groq')).toBeNull();
    expect(describeModelAvailabilityError('', 'OpenAI')).toBeNull();
    expect(describeModelAvailabilityError(undefined, 'OpenAI')).toBeNull();
  });
});

describe('per-provider compatibility kwargs', () => {
  it('omits frequency_penalty for Grok', () => {
    // Verified live: xAI 400s with
    // "Model grok-4-0709 does not support parameter frequencyPenalty",
    // and browser-use's ChatOpenAI sends frequency_penalty=0.3 by default.
    // null means "omit" — upstream guards every param with `is not None`.
    expect(resolveBrowserUseProvider('grokai').chatKwargs).toEqual({ frequency_penalty: null });
  });

  it('leaves every other provider on upstream defaults', () => {
    for (const key of ['openai', 'zai', 'minimax', 'togetherai', 'kimi']) {
      expect(resolveBrowserUseProvider(key).chatKwargs, `${key} should not need compat kwargs`).toBeNull();
    }
  });
});
