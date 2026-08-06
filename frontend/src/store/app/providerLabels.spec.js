/**
 * Provider labels vs provider identifiers.
 *
 * `displayName` in BUILT_IN_PROVIDERS looks like a label and is not one. It
 * keys PROVIDER_FETCH_ACTIONS, the allModels map, state.providers and the
 * localStorage model cache, and resolveProviderKey matches against it. Renaming
 * one to improve a label silently breaks model fetching for that provider.
 *
 * PROVIDER_DISPLAY_NAMES is the label layer — every consumer uses it for
 * `label:`, `placeholder:` or rendered text. That is where a rename belongs.
 *
 * These tests pin both halves so the next person to "finish the job" by editing
 * displayName gets a failure instead of a bug report.
 */

import { describe, it, expect } from 'vitest';
import aiProviderStore, {
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_FETCH_ACTIONS,
  providerLabel,
  resolveProviderKey,
} from './aiProvider.js';

describe('the ChatGPT subscription provider is labelled ChatGPT', () => {
  it('shows as "ChatGPT", not "OpenAI-Codex"', () => {
    // Users arrive with a ChatGPT account and look for that word. Next to a
    // provider called "OpenAI", the name "OpenAI-Codex" read as a second API
    // product they had not bought.
    expect(PROVIDER_DISPLAY_NAMES['openai-codex']).toBe('ChatGPT');
  });

  it('is labelled the same whether looked up by key or by display name', () => {
    // Call sites look it up both ways (OnboardingModal tries id then name).
    // If only one were overridden the label would change in some screens and
    // not others, which is worse than not renaming it at all.
    expect(PROVIDER_DISPLAY_NAMES['OpenAI-Codex']).toBe('ChatGPT');
  });

  it('is still clearly distinct from the API-key OpenAI provider', () => {
    expect(PROVIDER_DISPLAY_NAMES['openai-codex']).not.toBe(
      PROVIDER_DISPLAY_NAMES.openai ?? 'OpenAI',
    );
  });
});

describe('every relabelled provider, not just the first one', () => {
  /**
   * Derived rather than listed, so a fifth override is covered the day it is
   * added. Any provider whose label differs from its `displayName` has crossed
   * the layer this file exists to keep separate, and has to satisfy both halves
   * of the contract: new label on top, untouched identifier underneath.
   */
  const relabelled = aiProviderStore.state.providers
    .map((displayName) => ({ displayName, key: resolveProviderKey(displayName) }))
    // An entry in the label map that DIFFERS from the identifier is what makes
    // a provider relabelled. Comparing providerLabel() to displayName instead
    // catches every provider, because the label falls back to the lowercase
    // key when no override exists.
    .filter(({ displayName, key }) => {
      const label = PROVIDER_DISPLAY_NAMES[key];
      return Boolean(label) && label !== displayName;
    });

  it('anti-vacuity: there is something to check', () => {
    expect(relabelled.length).toBeGreaterThanOrEqual(5);
  });

  it('does not sweep in providers that were never relabelled', () => {
    // The filter's failure mode is catching everything, which would make the
    // assertions below look thorough while testing an unrelated population.
    const names = relabelled.map((r) => r.displayName);
    expect(names).not.toContain('Anthropic');
    expect(names).not.toContain('Groq');
    expect(names).toContain('OpenAI-Codex');
  });

  it.each(relabelled)('$displayName is labelled the same by key and by name', ({ displayName, key }) => {
    // Call sites look providers up both ways. If only one spelling were
    // overridden the label would change on some screens and not others, which
    // is worse than not renaming at all.
    expect(PROVIDER_DISPLAY_NAMES[key]).toBe(PROVIDER_DISPLAY_NAMES[displayName]);
  });

  it.each(relabelled)('$displayName keeps a fetch action keyed by its identifier', ({ displayName }) => {
    // Generated from displayName. Relabelling by editing displayName instead
    // of the override map re-keys this to a name nothing generated, and the
    // model list silently stops loading.
    const suffix = displayName.replace(/[-.]/g, '');
    expect(PROVIDER_FETCH_ACTIONS[displayName]).toBe(`aiProvider/fetch${suffix}Models`);
  });

  it.each(relabelled)('$displayName drops the identifier hyphen from what is read', ({ key }) => {
    // "Claude-Code" and "Gemini-CLI" are key spellings. On a screen offering a
    // subscription a hyphenated identifier reads as internal tooling.
    expect(providerLabel(key)).not.toMatch(/-/);
  });
});

describe('the identifier underneath must not move', () => {
  it('resolves the display-name spelling to the canonical key', () => {
    // Hardcoded at call sites, e.g. fetchOpenAICodexModels dispatches
    // fetchProviderModels({ provider: 'OpenAI-Codex' }).
    expect(resolveProviderKey('OpenAI-Codex')).toBe('openai-codex');
    expect(resolveProviderKey('openai-codex')).toBe('openai-codex');
  });

  it('still maps to the fetch action that actually exists', () => {
    // Generated from displayName. Rename displayName to 'ChatGPT' and this
    // becomes aiProvider/fetchChatGPTModels — an action nothing defines, so
    // the model list silently stops loading.
    expect(PROVIDER_FETCH_ACTIONS['OpenAI-Codex']).toBe('aiProvider/fetchOpenAICodexModels');
  });

  it('a label override does not leak into key resolution', () => {
    // 'ChatGPT' is a label, not an identifier. It must not become a second
    // accepted spelling for the provider key, or the two layers start to blur
    // again and the next rename breaks something new.
    expect(resolveProviderKey('ChatGPT')).toBe('ChatGPT');
  });
});
