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
import {
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_FETCH_ACTIONS,
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
