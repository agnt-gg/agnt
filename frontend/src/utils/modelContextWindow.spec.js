import { describe, expect, it } from 'vitest';
import { contextWindowFromMetadata } from './modelContextWindow.js';

const METADATA = {
  Anthropic: {
    'claude-opus-5-5': { contextWindow: 1000000 },
    'claude-sonnet-4-6': { contextWindow: 200000 },
  },
  'Kimi-Code': {
    k3: { contextWindow: 1048576 },
    'k3-256k': { contextWindow: 262144 },
  },
  Cerebras: { 'qwen-3.8-27b': {} },
};

describe('contextWindowFromMetadata', () => {
  it("reads a live model's window from the backend metadata (was absent from the hand map)", () => {
    expect(contextWindowFromMetadata(METADATA, 'Anthropic', 'claude-opus-5-5')).toBe(1000000);
  });

  it('REGRESSION: a sibling variant never inherits a shorter id\'s window', () => {
    // The old map's startsWith gave k3-256k the 1M window of k3.
    expect(contextWindowFromMetadata(METADATA, 'Kimi-Code', 'k3-256k')).toBe(262144);
    expect(contextWindowFromMetadata({ 'Kimi-Code': { k3: { contextWindow: 1048576 } } }, 'Kimi-Code', 'k3-256k')).toBe(0);
  });

  it.each(['claude-sonnet-4-6-20260101', 'claude-sonnet-4-6@20260101', 'claude-sonnet-4-6-2026-01-01', 'claude-sonnet-4-6-latest'])(
    'a dated or aliased build %s resolves to its base model', (id) => {
      expect(contextWindowFromMetadata(METADATA, 'Anthropic', id)).toBe(200000);
    },
  );

  it('is 0 (unknown) rather than a guess for missing, empty or unloaded metadata', () => {
    expect(contextWindowFromMetadata(METADATA, 'Cerebras', 'qwen-3.8-27b')).toBe(0);
    expect(contextWindowFromMetadata(METADATA, 'Anthropic', 'claude-unknown')).toBe(0);
    expect(contextWindowFromMetadata(METADATA, 'Groq', 'anything')).toBe(0);
    expect(contextWindowFromMetadata({}, 'Anthropic', 'claude-opus-5-5')).toBe(0);
    expect(contextWindowFromMetadata(undefined, undefined, undefined)).toBe(0);
  });

  it('only looks inside the selected provider', () => {
    expect(contextWindowFromMetadata(METADATA, 'OpenRouter', 'claude-opus-5-5')).toBe(0);
  });
});
